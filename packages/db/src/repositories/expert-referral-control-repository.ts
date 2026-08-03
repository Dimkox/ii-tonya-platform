import { sql } from "drizzle-orm";
import type { DrizzleDb } from "../client.js";
import { withSerializableRetry } from "./message-repository.js";

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
      "EXPERT_NOT_FOUND" | "FEATURE_CONTROL_CONFLICT" | "ABUSE_HOLD_NOT_FOUND",
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
        }>(sql`
          select id, expert_id as "expertId", status
          from expert_referral_abuse_holds
          where opened_approval_id = ${command.approvalId}::uuid
          for update
        `);
        const repeatedRow = repeated.rows[0];
        if (repeatedRow !== undefined) {
          if (repeatedRow.expertId !== command.expertId) {
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
          return {
            id: existing.rows[0].id,
            expertId: command.expertId,
            status: "open" as const,
          };
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
        const repeated = await tx.execute<{ id: string; expertId: string }>(sql`
          select id, expert_id as "expertId"
          from expert_referral_abuse_holds
          where closed_approval_id = ${command.approvalId}::uuid
          for update
        `);
        const repeatedRow = repeated.rows[0];
        if (repeatedRow !== undefined) {
          if (repeatedRow.expertId !== command.expertId) {
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
