import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import type { DrizzleDb } from "../client.js";
import {
  canonicalAdminPayloadHash,
  type AdminPayload,
} from "./admin-approval-repository.js";
import { withSerializableRetry } from "./message-repository.js";

export type ExpertReferralTransaction = Parameters<
  DrizzleDb["transaction"]
>[0] extends (transaction: infer T) => unknown
  ? T
  : never;

export interface ExpertReferralFeatureControl {
  readonly persisted: boolean;
  readonly version: number;
  readonly newCommandsEnabled: boolean;
  readonly rewardGrantsEnabled: boolean;
}

export interface ExpertReferralEligibility {
  readonly expertId: string;
  readonly found: boolean;
  readonly active: boolean;
  readonly verified: boolean;
  readonly userActive: boolean;
  readonly uniqueIdentity: boolean;
  readonly abuseCleared: boolean;
}

export interface ExpertReferralAdminEvidence {
  readonly adminId: string;
  readonly approvalId: string;
  readonly sessionIdHash: string;
}

export interface UpdateExpertReferralFeatureControl extends ExpertReferralAdminEvidence {
  readonly expectedVersion: number;
  readonly newCommandsEnabled: boolean;
  readonly rewardGrantsEnabled: boolean;
}

export interface OpenExpertReferralAbuseHold extends ExpertReferralAdminEvidence {
  readonly expertId: string;
  readonly reasonCode: string;
}

export interface CloseExpertReferralAbuseHold extends ExpertReferralAdminEvidence {
  readonly expertId: string;
  readonly reasonCode: string;
}

export interface ExpertReferralAbuseHoldResult {
  readonly holdId: string;
  readonly expertId: string;
  readonly status: "open" | "closed";
  readonly version: number;
}

export class ExpertReferralControlError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "ExpertReferralControlError";
  }
}

interface FeatureRow extends Record<string, unknown> {
  version: number;
  newCommandsEnabled: boolean;
  rewardGrantsEnabled: boolean;
}

interface ActiveKeyVersionRow extends Record<string, unknown> {
  keyVersion: number;
}

interface EligibilityRow extends Record<string, unknown> {
  expertId: string;
  userId: string;
  active: boolean;
  verified: boolean;
  userActive: boolean;
  expertIdentityCount: number;
  channelIdentityCount: number;
  openHoldCount: number;
}

interface HoldRow extends Record<string, unknown> {
  holdId: string;
  expertId: string;
  status: "open" | "closed";
  version: number;
  openedApprovalId: string;
  closedApprovalId: string | null;
}

interface ApprovalEvidenceRow extends Record<string, unknown> {
  action: string;
  objectType: string;
  objectId: string;
  requesterId: string;
  requesterSessionIdHash: string;
  approverId: string | null;
  approved: boolean;
  consumed: boolean;
  approvalCurrent: boolean;
  sessionCurrent: boolean;
  sessionAdminId: string;
  requesterMfaMatches: boolean;
  payloadHash: string;
  requiredRole: string;
  requesterHasRole: boolean;
  approverSessionCurrent: boolean;
  approverSessionAdminId: string | null;
  approverMfaMatches: boolean;
  approverHasRole: boolean;
}

interface AuditReplayRow extends Record<string, unknown> {
  actorId: string;
  sessionIdHash: string;
  reasonCode: string;
  metadataHash: string;
}

export const EXPERT_REFERRAL_FEATURE_CONTROL_OBJECT_ID =
  "00000000-0000-4000-8000-000000000018";

export function expertReferralAuditHash(value: unknown): string {
  return `sha256:${createHash("sha256").update(JSON.stringify(value)).digest("hex")}`;
}

export async function validateAndConsumeExpertReferralAdminEvidence(
  tx: ExpertReferralTransaction,
  evidence: ExpertReferralAdminEvidence,
  expected: {
    action: string;
    objectType: string;
    objectId: string;
    payload: AdminPayload;
  },
): Promise<{ replay: boolean }> {
  const row = (
    await tx.execute<ApprovalEvidenceRow>(sql`
    select a.action, a.object_type as "objectType", a.object_id as "objectId",
      a.requester_id as "requesterId",
      a.requester_session_id_hash as "requesterSessionIdHash",
      a.approver_id as "approverId", a.approved_at is not null as approved,
      a.consumed_at is not null as consumed,
      a.expires_at > clock_timestamp() as "approvalCurrent",
      s.revoked_at is null and s.expires_at > clock_timestamp()
        and s.mfa_verified_at <= clock_timestamp()
        and s.mfa_verified_at >= clock_timestamp() - interval '15 minutes'
        as "sessionCurrent",
      s.admin_id as "sessionAdminId",
      s.mfa_verified_at = a.requester_mfa_verified_at as "requesterMfaMatches",
      a.payload_hash as "payloadHash",
      a.required_role as "requiredRole",
      exists(
        select 1 from admin_role_assignments requester_role
        where requester_role.admin_id = a.requester_id
          and requester_role.role = a.required_role
      ) as "requesterHasRole",
      approver_session.revoked_at is null
        and approver_session.expires_at > clock_timestamp()
        and approver_session.mfa_verified_at <= clock_timestamp()
        and approver_session.mfa_verified_at >= clock_timestamp() - interval '15 minutes'
        as "approverSessionCurrent",
      approver_session.admin_id as "approverSessionAdminId",
      approver_session.mfa_verified_at = a.approver_mfa_verified_at
        as "approverMfaMatches",
      exists(
        select 1 from admin_role_assignments approver_role
        where approver_role.admin_id = a.approver_id
          and approver_role.role = a.required_role
      ) as "approverHasRole"
    from admin_approvals a
    join admin_sessions s on s.session_id_hash = ${evidence.sessionIdHash}
    join admin_sessions approver_session
      on approver_session.session_id_hash = a.approver_session_id_hash
    where a.id = ${evidence.approvalId}::uuid
    for update of a, s, approver_session
  `)
  ).rows[0];
  if (
    row === undefined ||
    row.action !== expected.action ||
    row.objectType !== expected.objectType ||
    row.objectId !== expected.objectId ||
    row.requesterId !== evidence.adminId ||
    row.requesterSessionIdHash !== evidence.sessionIdHash ||
    row.sessionAdminId !== evidence.adminId ||
    !row.requesterMfaMatches ||
    !row.approved ||
    row.approverId === null ||
    row.approverId === row.requesterId ||
    !row.approvalCurrent ||
    !row.sessionCurrent ||
    !row.approverSessionCurrent ||
    row.approverSessionAdminId !== row.approverId ||
    !row.approverMfaMatches ||
    row.requiredRole !== "entitlement_admin" ||
    !row.requesterHasRole ||
    !row.approverHasRole ||
    row.payloadHash !== canonicalAdminPayloadHash(expected.payload)
  ) {
    throw new ExpertReferralControlError("admin_evidence_invalid");
  }
  if (row.consumed) return { replay: true };
  const consumed = await tx.execute(sql`
    update admin_approvals set consumed_at = clock_timestamp()
    where id = ${evidence.approvalId}::uuid and consumed_at is null
    returning id
  `);
  if (consumed.rows[0] === undefined) {
    throw new ExpertReferralControlError("admin_evidence_conflict");
  }
  return { replay: false };
}

export async function appendExpertReferralAuditEvent(
  tx: ExpertReferralTransaction,
  input: ExpertReferralAdminEvidence & {
    action: string;
    objectType: string;
    objectId: string;
    reasonCode: string;
    metadata: unknown;
  },
): Promise<void> {
  await tx.execute(sql`
    insert into audit_events (
      actor_type, actor_id, authenticated_session_id_hash, action,
      object_type, object_id, decision, reason_code, correlation_id,
      occurred_at, metadata_hash
    ) values (
      'admin', ${input.adminId}::uuid, ${input.sessionIdHash}, ${input.action},
      ${input.objectType}, ${input.objectId}::uuid, 'allow', ${input.reasonCode},
      ${`approval:${input.approvalId}`}, clock_timestamp(),
      ${expertReferralAuditHash(input.metadata)}
    )
  `);
}

export async function assertExpertReferralAuditReplay(
  tx: ExpertReferralTransaction,
  input: ExpertReferralAdminEvidence & {
    action: string;
    objectId: string;
    reasonCode: string;
    metadata: unknown;
    conflictCode: string;
  },
): Promise<void> {
  const rows = (
    await tx.execute<AuditReplayRow>(sql`
    select actor_id as "actorId",
      authenticated_session_id_hash as "sessionIdHash",
      reason_code as "reasonCode", metadata_hash as "metadataHash"
    from audit_events
    where action = ${input.action}
      and object_id = ${input.objectId}::uuid
      and correlation_id = ${`approval:${input.approvalId}`}
    for update
  `)
  ).rows;
  const row = rows[0];
  if (
    rows.length !== 1 ||
    row === undefined ||
    row.actorId !== input.adminId ||
    row.sessionIdHash !== input.sessionIdHash ||
    row.reasonCode !== input.reasonCode ||
    row.metadataHash !== expertReferralAuditHash(input.metadata)
  ) {
    throw new ExpertReferralControlError(input.conflictCode);
  }
}

const featureState = (
  row: FeatureRow | undefined,
): ExpertReferralFeatureControl =>
  row === undefined
    ? {
        persisted: false,
        version: 0,
        newCommandsEnabled: false,
        rewardGrantsEnabled: false,
      }
    : { persisted: true, ...row };

function requireReason(reasonCode: string): void {
  if (reasonCode.trim().length === 0 || reasonCode.length > 200) {
    throw new ExpertReferralControlError("invalid_abuse_hold_reason");
  }
}

export class PostgresExpertReferralControlRepository {
  constructor(private readonly db: DrizzleDb) {}

  readForCommand(): Promise<ExpertReferralFeatureControl> {
    return this.db.transaction((tx) => this.lockFeatureControl(tx));
  }

  async activeIssuedCodeKeyVersions(): Promise<readonly string[]> {
    const result = await this.db.execute<ActiveKeyVersionRow>(sql`
      select distinct hmac_key_version as "keyVersion"
      from expert_referral_codes
      where status = 'issued'
      order by hmac_key_version
    `);
    return result.rows.map((row) => `v${row.keyVersion}`);
  }

  async lockFeatureControl(
    tx: ExpertReferralTransaction,
  ): Promise<ExpertReferralFeatureControl> {
    const result = await tx.execute<FeatureRow>(sql`
      select version, new_commands_enabled as "newCommandsEnabled",
        reward_grants_enabled as "rewardGrantsEnabled"
      from expert_referral_feature_controls
      where feature_key = 'expert_referrals'
      for update
    `);
    return featureState(result.rows[0]);
  }

  async lockEligibility(
    tx: ExpertReferralTransaction,
    expertId: string,
  ): Promise<ExpertReferralEligibility> {
    await tx.execute(sql`
      select pg_advisory_xact_lock(hashtextextended(${`expert-referral:${expertId}`}, 0))
    `);
    const result = await tx.execute<EligibilityRow>(sql`
      select e.id as "expertId", e.user_id as "userId", e.active, e.verified,
        u.active as "userActive",
        (select count(*)::integer from experts same where same.user_id = e.user_id)
          as "expertIdentityCount",
        (select count(*)::integer from channel_identities ci where ci.user_id = e.user_id)
          as "channelIdentityCount",
        (select count(*)::integer from expert_referral_abuse_holds h
          where h.expert_id = e.id and h.status = 'open') as "openHoldCount"
      from experts e
      join users u on u.id = e.user_id
      where e.id = ${expertId}::uuid
      for update of e, u
    `);
    const row = result.rows[0];
    if (row === undefined) {
      return {
        expertId,
        found: false,
        active: false,
        verified: false,
        userActive: false,
        uniqueIdentity: false,
        abuseCleared: false,
      };
    }
    await tx.execute(sql`
      select id from channel_identities
      where user_id = ${row.userId}::uuid
      for update
    `);
    await tx.execute(sql`
      select id from expert_referral_abuse_holds
      where expert_id = ${expertId}::uuid and status = 'open'
      for update
    `);
    return {
      expertId: row.expertId,
      found: true,
      active: row.active,
      verified: row.verified,
      userActive: row.userActive,
      uniqueIdentity:
        row.expertIdentityCount === 1 && row.channelIdentityCount === 1,
      abuseCleared: row.openHoldCount === 0,
    };
  }

  updateFeatureControl(
    command: UpdateExpertReferralFeatureControl,
  ): Promise<ExpertReferralFeatureControl> {
    if (
      !Number.isInteger(command.expectedVersion) ||
      command.expectedVersion < 0
    ) {
      throw new ExpertReferralControlError("invalid_feature_control_version");
    }
    return withSerializableRetry(() =>
      this.db.transaction(async (tx) => {
        await tx.execute(sql`set transaction isolation level serializable`);
        await tx.execute(sql`
        select pg_advisory_xact_lock(hashtextextended('expert-referrals:feature-control', 0))
      `);
        const current = await this.lockFeatureControl(tx);
        if (current.version !== command.expectedVersion) {
          throw new ExpertReferralControlError(
            "feature_control_version_conflict",
          );
        }
        const evidence = await validateAndConsumeExpertReferralAdminEvidence(
          tx,
          command,
          {
            action: "expert_referral.feature_switch",
            objectType: "expert_referral_feature_control",
            objectId: EXPERT_REFERRAL_FEATURE_CONTROL_OBJECT_ID,
            payload: {
              expectedVersion: command.expectedVersion,
              newCommandsEnabled: command.newCommandsEnabled,
              rewardGrantsEnabled: command.rewardGrantsEnabled,
            },
          },
        );
        if (evidence.replay) {
          throw new ExpertReferralControlError(
            "feature_control_approval_replayed",
          );
        }
        let row: FeatureRow | undefined;
        if (!current.persisted) {
          row = (
            await tx.execute<FeatureRow>(sql`
          insert into expert_referral_feature_controls (
            feature_key, version, new_commands_enabled, reward_grants_enabled,
            approval_id, changed_by_admin_id, admin_session_id_hash
          ) values (
            'expert_referrals', 1, ${command.newCommandsEnabled},
            ${command.rewardGrantsEnabled}, ${command.approvalId}::uuid,
            ${command.adminId}::uuid, ${command.sessionIdHash}
          )
          returning version, new_commands_enabled as "newCommandsEnabled",
            reward_grants_enabled as "rewardGrantsEnabled"
        `)
          ).rows[0];
        } else {
          row = (
            await tx.execute<FeatureRow>(sql`
          update expert_referral_feature_controls
          set version = version + 1,
              new_commands_enabled = ${command.newCommandsEnabled},
              reward_grants_enabled = ${command.rewardGrantsEnabled},
              approval_id = ${command.approvalId}::uuid,
              changed_by_admin_id = ${command.adminId}::uuid,
              admin_session_id_hash = ${command.sessionIdHash},
              updated_at = clock_timestamp()
          where feature_key = 'expert_referrals'
            and version = ${command.expectedVersion}
          returning version, new_commands_enabled as "newCommandsEnabled",
            reward_grants_enabled as "rewardGrantsEnabled"
        `)
          ).rows[0];
        }
        if (row === undefined) {
          throw new ExpertReferralControlError(
            "feature_control_version_conflict",
          );
        }
        await appendExpertReferralAuditEvent(tx, {
          ...command,
          action: "expert_referral.feature_switch",
          objectType: "expert_referral_feature_control",
          objectId: EXPERT_REFERRAL_FEATURE_CONTROL_OBJECT_ID,
          reasonCode: "feature_control_updated",
          metadata: {
            previousVersion: current.version,
            version: row.version,
            newCommandsEnabled: row.newCommandsEnabled,
            rewardGrantsEnabled: row.rewardGrantsEnabled,
          },
        });
        return featureState(row);
      }),
    );
  }

  openAbuseHold(
    command: OpenExpertReferralAbuseHold,
  ): Promise<ExpertReferralAbuseHoldResult> {
    requireReason(command.reasonCode);
    return withSerializableRetry(() =>
      this.db.transaction(async (tx) => {
        await tx.execute(sql`set transaction isolation level serializable`);
        const eligibility = await this.lockEligibility(tx, command.expertId);
        if (!eligibility.found) {
          throw new ExpertReferralControlError("expert_not_found");
        }
        const evidence = await validateAndConsumeExpertReferralAdminEvidence(
          tx,
          command,
          {
            action: "expert_referral.abuse_hold_open",
            objectType: "expert",
            objectId: command.expertId,
            payload: { reasonCode: command.reasonCode },
          },
        );
        const replay = (
          await tx.execute<HoldRow>(sql`
        select id as "holdId", expert_id as "expertId", status, version,
          opened_approval_id as "openedApprovalId",
          closed_approval_id as "closedApprovalId"
        from expert_referral_abuse_holds
        where opened_approval_id = ${command.approvalId}::uuid
        for update
      `)
        ).rows[0];
        if (replay !== undefined) {
          if (replay.expertId !== command.expertId || !evidence.replay) {
            throw new ExpertReferralControlError(
              "abuse_hold_approval_conflict",
            );
          }
          await assertExpertReferralAuditReplay(tx, {
            ...command,
            action: "expert_referral.abuse_hold_open",
            objectId: replay.holdId,
            reasonCode: command.reasonCode,
            metadata: {
              expertId: command.expertId,
              reasonCode: command.reasonCode,
            },
            conflictCode: "abuse_hold_replay_conflict",
          });
          return {
            holdId: replay.holdId,
            expertId: replay.expertId,
            status: replay.status,
            version: replay.version,
          };
        }
        const existing = (
          await tx.execute<{ holdId: string }>(sql`
        select id as "holdId" from expert_referral_abuse_holds
        where expert_id = ${command.expertId}::uuid and status = 'open'
        for update
      `)
        ).rows[0];
        if (existing !== undefined) {
          throw new ExpertReferralControlError("abuse_hold_already_open");
        }
        const inserted = (
          await tx.execute<HoldRow>(sql`
        insert into expert_referral_abuse_holds (
          expert_id, reason_code, opened_approval_id, opened_by_admin_id,
          opened_admin_session_id_hash
        ) values (
          ${command.expertId}::uuid, ${command.reasonCode},
          ${command.approvalId}::uuid, ${command.adminId}::uuid,
          ${command.sessionIdHash}
        )
        returning id as "holdId", expert_id as "expertId", status, version,
          opened_approval_id as "openedApprovalId",
          closed_approval_id as "closedApprovalId"
      `)
        ).rows[0];
        if (inserted === undefined) throw new Error("abuse_hold_insert_failed");
        await appendExpertReferralAuditEvent(tx, {
          ...command,
          action: "expert_referral.abuse_hold_open",
          objectType: "expert_referral_abuse_hold",
          objectId: inserted.holdId,
          reasonCode: command.reasonCode,
          metadata: {
            expertId: command.expertId,
            reasonCode: command.reasonCode,
          },
        });
        return {
          holdId: inserted.holdId,
          expertId: inserted.expertId,
          status: inserted.status,
          version: inserted.version,
        };
      }),
    );
  }

  closeAbuseHold(
    command: CloseExpertReferralAbuseHold,
  ): Promise<ExpertReferralAbuseHoldResult> {
    requireReason(command.reasonCode);
    return withSerializableRetry(() =>
      this.db.transaction(async (tx) => {
        await tx.execute(sql`set transaction isolation level serializable`);
        const eligibility = await this.lockEligibility(tx, command.expertId);
        if (!eligibility.found) {
          throw new ExpertReferralControlError("expert_not_found");
        }
        const evidence = await validateAndConsumeExpertReferralAdminEvidence(
          tx,
          command,
          {
            action: "expert_referral.abuse_hold_close",
            objectType: "expert",
            objectId: command.expertId,
            payload: { reasonCode: command.reasonCode },
          },
        );
        const replay = (
          await tx.execute<HoldRow>(sql`
        select id as "holdId", expert_id as "expertId", status, version,
          opened_approval_id as "openedApprovalId",
          closed_approval_id as "closedApprovalId"
        from expert_referral_abuse_holds
        where closed_approval_id = ${command.approvalId}::uuid
        for update
      `)
        ).rows[0];
        if (replay !== undefined) {
          if (replay.expertId !== command.expertId || !evidence.replay) {
            throw new ExpertReferralControlError(
              "abuse_hold_approval_conflict",
            );
          }
          await assertExpertReferralAuditReplay(tx, {
            ...command,
            action: "expert_referral.abuse_hold_close",
            objectId: replay.holdId,
            reasonCode: command.reasonCode,
            metadata: {
              expertId: command.expertId,
              reasonCode: command.reasonCode,
            },
            conflictCode: "abuse_hold_replay_conflict",
          });
          return {
            holdId: replay.holdId,
            expertId: replay.expertId,
            status: replay.status,
            version: replay.version,
          };
        }
        const closed = (
          await tx.execute<HoldRow>(sql`
        update expert_referral_abuse_holds
        set status = 'closed', closed_approval_id = ${command.approvalId}::uuid,
            closed_by_admin_id = ${command.adminId}::uuid,
            closed_admin_session_id_hash = ${command.sessionIdHash},
            closed_at = clock_timestamp(), version = version + 1
        where expert_id = ${command.expertId}::uuid and status = 'open'
        returning id as "holdId", expert_id as "expertId", status, version,
          opened_approval_id as "openedApprovalId",
          closed_approval_id as "closedApprovalId"
      `)
        ).rows[0];
        if (closed === undefined) {
          throw new ExpertReferralControlError("abuse_hold_not_open");
        }
        await appendExpertReferralAuditEvent(tx, {
          ...command,
          action: "expert_referral.abuse_hold_close",
          objectType: "expert_referral_abuse_hold",
          objectId: closed.holdId,
          reasonCode: command.reasonCode,
          metadata: {
            expertId: command.expertId,
            reasonCode: command.reasonCode,
          },
        });
        return {
          holdId: closed.holdId,
          expertId: closed.expertId,
          status: closed.status,
          version: closed.version,
        };
      }),
    );
  }
}
