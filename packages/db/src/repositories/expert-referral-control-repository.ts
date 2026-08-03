import { sql } from "drizzle-orm";
import type { DrizzleDb } from "../client.js";
import { canonicalAdminPayloadHash } from "./admin-approval-repository.js";
import { withSerializableRetry } from "./message-repository.js";

export const EXPERT_REFERRAL_FEATURE_CONTROL_ID =
  "00000000-0000-0000-0000-000000000041";
export const EXPERT_REFERRAL_FEATURE_CONTROL_APPROVAL_ACTION =
  "expert_referral.feature_switch";
export const EXPERT_REFERRAL_FEATURE_CONTROL_APPROVAL_OBJECT_TYPE =
  "expert_referral_feature_control";

export type ExpertReferralTransaction = Parameters<
  Parameters<DrizzleDb["transaction"]>[0]
>[0];

export interface ExpertReferralFeatureControl {
  persisted: boolean;
  version: number;
  newCommandsEnabled: boolean;
  rewardGrantsEnabled: boolean;
}

interface StoredFeatureControl extends Record<string, unknown> {
  version: number;
  newCommandsEnabled: boolean;
  rewardGrantsEnabled: boolean;
}

export interface SetExpertReferralFeatureControlCommand {
  expectedVersion: number;
  newCommandsEnabled: boolean;
  rewardGrantsEnabled: boolean;
  approvalId: string;
  adminSessionIdHash: string;
}

export function expertReferralFeatureControlApprovalPayload(
  command: Pick<
    SetExpertReferralFeatureControlCommand,
    "expectedVersion" | "newCommandsEnabled" | "rewardGrantsEnabled"
  >,
) {
  return {
    expectedVersion: command.expectedVersion,
    newCommandsEnabled: command.newCommandsEnabled,
    rewardGrantsEnabled: command.rewardGrantsEnabled,
  } as const;
}

export interface ExpertEligibilityLock {
  expertId: string;
  active: boolean;
  verified: boolean;
  abuseCleared: boolean;
}

export interface OpenExpertAbuseHoldCommand {
  expertId: string;
  reasonCode: string;
  approvalId: string;
  adminSessionIdHash: string;
}

export interface CloseExpertAbuseHoldCommand {
  expertId: string;
  reasonCode: string;
  approvalId: string;
  adminSessionIdHash: string;
}

export interface ExpertAbuseHoldResult {
  id: string;
  expertId: string;
  status: "open" | "closed";
}

export class ExpertReferralControlError extends Error {
  constructor(
    readonly code:
      | "EXPERT_NOT_FOUND"
      | "FEATURE_CONTROL_CONFLICT"
      | "FEATURE_CONTROL_APPROVAL_INVALID"
      | "ABUSE_HOLD_NOT_FOUND",
    message: string,
  ) {
    super(message);
    this.name = "ExpertReferralControlError";
  }
}

export function effectiveFeatureControl(
  stored: StoredFeatureControl | undefined,
): ExpertReferralFeatureControl {
  if (stored === undefined) {
    return {
      persisted: false,
      version: 0,
      newCommandsEnabled: false,
      rewardGrantsEnabled: false,
    };
  }
  return { persisted: true, ...stored };
}

export function nextFeatureControlVersion(
  expectedVersion: number,
  stored: Pick<StoredFeatureControl, "version"> | undefined,
): number {
  const actualVersion = stored?.version ?? 0;
  if (expectedVersion !== actualVersion) {
    throw new ExpertReferralControlError(
      "FEATURE_CONTROL_CONFLICT",
      "Expert referral feature control version conflict",
    );
  }
  return actualVersion + 1;
}

function validateReasonCode(reasonCode: string): void {
  if (reasonCode.length < 1 || reasonCode.length > 128) {
    throw new RangeError("Expert referral abuse-hold reason is invalid");
  }
}

export class PostgresExpertReferralControlRepository {
  constructor(private readonly db: DrizzleDb) {}

  async lockFeatureControl(
    tx: ExpertReferralTransaction,
  ): Promise<ExpertReferralFeatureControl> {
    const result = await tx.execute<StoredFeatureControl>(sql`
      select
        version,
        new_commands_enabled as "newCommandsEnabled",
        reward_grants_enabled as "rewardGrantsEnabled"
      from expert_referral_feature_controls
      where control_key = 'expert_referrals'
      for update
    `);
    return effectiveFeatureControl(result.rows[0]);
  }

  async lockEligibility(
    tx: ExpertReferralTransaction,
    expertId: string,
  ): Promise<ExpertEligibilityLock> {
    const expert = await tx.execute<{
      id: string;
      active: boolean;
      verified: boolean;
    }>(sql`
      select id, active, verified
      from experts
      where id = ${expertId}::uuid
      for update
    `);
    const row = expert.rows[0];
    if (row === undefined) {
      throw new ExpertReferralControlError(
        "EXPERT_NOT_FOUND",
        "Expert is unavailable",
      );
    }
    const holds = await tx.execute<{ id: string }>(sql`
      select id
      from expert_referral_abuse_holds
      where expert_id = ${expertId}::uuid and status = 'open'
      for update
    `);
    return {
      expertId: row.id,
      active: row.active,
      verified: row.verified,
      abuseCleared: holds.rows.length === 0,
    };
  }

  async setFeatureControl(
    command: SetExpertReferralFeatureControlCommand,
  ): Promise<ExpertReferralFeatureControl> {
    return withSerializableRetry(() =>
      this.db.transaction(async (tx) => {
        await tx.execute(sql`set transaction isolation level serializable`);
        await tx.execute(
          sql`select pg_advisory_xact_lock(hashtextextended('expert-referral-feature-control', 0))`,
        );
        const current = await this.lockFeatureControl(tx);
        const version = nextFeatureControlVersion(
          command.expectedVersion,
          current.persisted ? current : undefined,
        );
        await this.consumeFeatureControlApproval(tx, command);
        if (!current.persisted) {
          await tx.execute(sql`
            insert into expert_referral_feature_controls (
              control_key, version, new_commands_enabled,
              reward_grants_enabled, updated_approval_id,
              updated_admin_session_id_hash, updated_at
            ) values (
              'expert_referrals', ${version}, ${command.newCommandsEnabled},
              ${command.rewardGrantsEnabled}, ${command.approvalId}::uuid,
              ${command.adminSessionIdHash}, transaction_timestamp()
            )
          `);
        } else {
          const updated = await tx.execute<{ version: number }>(sql`
            update expert_referral_feature_controls
            set version = ${version},
                new_commands_enabled = ${command.newCommandsEnabled},
                reward_grants_enabled = ${command.rewardGrantsEnabled},
                updated_approval_id = ${command.approvalId}::uuid,
                updated_admin_session_id_hash = ${command.adminSessionIdHash},
                updated_at = transaction_timestamp()
            where control_key = 'expert_referrals'
              and version = ${command.expectedVersion}
            returning version
          `);
          if (updated.rows.length !== 1) {
            throw new ExpertReferralControlError(
              "FEATURE_CONTROL_CONFLICT",
              "Expert referral feature control version conflict",
            );
          }
        }
        return {
          persisted: true,
          version,
          newCommandsEnabled: command.newCommandsEnabled,
          rewardGrantsEnabled: command.rewardGrantsEnabled,
        };
      }),
    );
  }

  async openAbuseHold(
    command: OpenExpertAbuseHoldCommand,
  ): Promise<ExpertAbuseHoldResult> {
    validateReasonCode(command.reasonCode);
    return withSerializableRetry(() =>
      this.db.transaction(async (tx) => {
        await tx.execute(sql`set transaction isolation level serializable`);
        await this.lockExpertForHold(tx, command.expertId);
        const repeated = await tx.execute<{
          id: string;
          expertId: string;
          status: "open" | "closed";
          reasonCode: string;
          adminSessionIdHash: string;
        }>(sql`
          select id, expert_id as "expertId", status,
            reason_code as "reasonCode",
            opened_admin_session_id_hash as "adminSessionIdHash"
          from expert_referral_abuse_holds
          where opened_approval_id = ${command.approvalId}::uuid
          for update
        `);
        const repeatedRow = repeated.rows[0];
        if (repeatedRow !== undefined) {
          if (
            repeatedRow.expertId !== command.expertId ||
            repeatedRow.reasonCode !== command.reasonCode ||
            repeatedRow.adminSessionIdHash !== command.adminSessionIdHash
          ) {
            throw new ExpertReferralControlError(
              "FEATURE_CONTROL_CONFLICT",
              "Expert referral abuse-hold command conflict",
            );
          }
          return {
            id: repeatedRow.id,
            expertId: repeatedRow.expertId,
            status: repeatedRow.status,
          };
        }
        const existing = await tx.execute<{ id: string }>(sql`
          select id
          from expert_referral_abuse_holds
          where expert_id = ${command.expertId}::uuid and status = 'open'
          for update
        `);
        if (existing.rows[0] !== undefined) {
          throw new ExpertReferralControlError(
            "FEATURE_CONTROL_CONFLICT",
            "Expert referral abuse-hold command conflict",
          );
        }
        const inserted = await tx.execute<{ id: string }>(sql`
          insert into expert_referral_abuse_holds (
            expert_id, reason_code, opened_approval_id,
            opened_admin_session_id_hash, opened_at
          ) values (
            ${command.expertId}::uuid, ${command.reasonCode},
            ${command.approvalId}::uuid, ${command.adminSessionIdHash},
            transaction_timestamp()
          ) returning id
        `);
        return {
          id: inserted.rows[0]!.id,
          expertId: command.expertId,
          status: "open" as const,
        };
      }),
    );
  }

  async closeAbuseHold(
    command: CloseExpertAbuseHoldCommand,
  ): Promise<ExpertAbuseHoldResult> {
    validateReasonCode(command.reasonCode);
    return withSerializableRetry(() =>
      this.db.transaction(async (tx) => {
        await tx.execute(sql`set transaction isolation level serializable`);
        await this.lockExpertForHold(tx, command.expertId);
        const repeated = await tx.execute<{
          id: string;
          expertId: string;
          reasonCode: string;
          adminSessionIdHash: string;
        }>(sql`
          select id, expert_id as "expertId",
            closed_reason_code as "reasonCode",
            closed_admin_session_id_hash as "adminSessionIdHash"
          from expert_referral_abuse_holds
          where closed_approval_id = ${command.approvalId}::uuid
          for update
        `);
        const repeatedRow = repeated.rows[0];
        if (repeatedRow !== undefined) {
          if (
            repeatedRow.expertId !== command.expertId ||
            repeatedRow.reasonCode !== command.reasonCode ||
            repeatedRow.adminSessionIdHash !== command.adminSessionIdHash
          ) {
            throw new ExpertReferralControlError(
              "FEATURE_CONTROL_CONFLICT",
              "Expert referral abuse-hold command conflict",
            );
          }
          return {
            id: repeatedRow.id,
            expertId: repeatedRow.expertId,
            status: "closed" as const,
          };
        }
        const open = await tx.execute<{ id: string }>(sql`
          select id
          from expert_referral_abuse_holds
          where expert_id = ${command.expertId}::uuid and status = 'open'
          for update
        `);
        const openRow = open.rows[0];
        if (openRow === undefined) {
          throw new ExpertReferralControlError(
            "ABUSE_HOLD_NOT_FOUND",
            "Expert referral abuse hold is unavailable",
          );
        }
        await tx.execute(sql`
          update expert_referral_abuse_holds
          set status = 'closed',
              closed_approval_id = ${command.approvalId}::uuid,
              closed_admin_session_id_hash = ${command.adminSessionIdHash},
              closed_reason_code = ${command.reasonCode},
              closed_at = transaction_timestamp()
          where id = ${openRow.id}::uuid and status = 'open'
        `);
        return {
          id: openRow.id,
          expertId: command.expertId,
          status: "closed" as const,
        };
      }),
    );
  }

  private async consumeFeatureControlApproval(
    tx: ExpertReferralTransaction,
    command: SetExpertReferralFeatureControlCommand,
  ): Promise<void> {
    const payloadHash = canonicalAdminPayloadHash(
      expertReferralFeatureControlApprovalPayload(command),
    );
    const consumed = await tx.execute<{ id: string }>(sql`
      with db_clock as (
        select clock_timestamp() as db_now
      ), valid_approval as (
        select a.id, c.db_now
        from admin_approvals a
        join admin_sessions requester_session
          on requester_session.session_id_hash = a.requester_session_id_hash
          and requester_session.admin_id = a.requester_id
        join admin_role_assignments requester_role
          on requester_role.admin_id = a.requester_id
          and requester_role.role = 'security_admin'
        join admin_sessions approver_session
          on approver_session.session_id_hash = a.approver_session_id_hash
          and approver_session.admin_id = a.approver_id
        join admin_role_assignments approver_role
          on approver_role.admin_id = a.approver_id
          and approver_role.role = 'security_admin'
        cross join db_clock c
        where a.id = ${command.approvalId}::uuid
          and a.action = ${EXPERT_REFERRAL_FEATURE_CONTROL_APPROVAL_ACTION}
          and a.object_type = ${EXPERT_REFERRAL_FEATURE_CONTROL_APPROVAL_OBJECT_TYPE}
          and a.object_id = ${EXPERT_REFERRAL_FEATURE_CONTROL_ID}::uuid
          and a.requester_session_id_hash = ${command.adminSessionIdHash}
          and a.payload_hash = ${payloadHash}
          and a.required_role = 'security_admin'
          and a.requester_mfa_verified_at = requester_session.mfa_verified_at
          and a.approver_id is not null
          and a.approver_id <> a.requester_id
          and a.approved_at is not null
          and a.consumed_at is null
          and a.expires_at > c.db_now
          and requester_session.revoked_at is null
          and requester_session.expires_at > c.db_now
          and requester_session.mfa_verified_at <= c.db_now
          and requester_session.mfa_verified_at >= c.db_now - interval '15 minutes'
          and approver_session.mfa_verified_at = a.approver_mfa_verified_at
          and approver_session.revoked_at is null
          and approver_session.expires_at > c.db_now
          and approver_session.mfa_verified_at <= c.db_now
          and approver_session.mfa_verified_at >= c.db_now - interval '15 minutes'
        for update of a
      )
      update admin_approvals a
      set consumed_at = valid_approval.db_now
      from valid_approval
      where a.id = valid_approval.id and a.consumed_at is null
      returning a.id
    `);
    if (consumed.rows.length !== 1) {
      throw new ExpertReferralControlError(
        "FEATURE_CONTROL_APPROVAL_INVALID",
        "Expert referral feature-control approval is invalid",
      );
    }
  }

  private async lockExpertForHold(
    tx: ExpertReferralTransaction,
    expertId: string,
  ): Promise<void> {
    const expert = await tx.execute<{ id: string }>(sql`
      select id from experts where id = ${expertId}::uuid for update
    `);
    if (expert.rows.length !== 1) {
      throw new ExpertReferralControlError(
        "EXPERT_NOT_FOUND",
        "Expert is unavailable",
      );
    }
  }
}
