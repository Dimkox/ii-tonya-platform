import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import type { DrizzleDb } from "../client.js";
import type { ExpertReferralCodeCrypto } from "./expert-referral-repository.js";
import { PostgresExpertReferralRepository } from "./expert-referral-repository.js";
import { PostgresExpertReferralControlRepository } from "./expert-referral-control-repository.js";
import { PostgresExpertResidencyProviderInboxRepository } from "./expert-residency-provider-inbox-repository.js";
import { PostgresAdminApprovalRepository, type AdminPayload, type ApprovalAdminAction, type ConsumedAdminApproval } from "./admin-approval-repository.js";

type Action = Extract<ApprovalAdminAction, `expert_${string}`>;
type Payload = Readonly<Record<string, string | number | boolean | undefined>>;
export interface ExpertReferralAdminRepositoryCommand {
  action: Action; objectId: string; approvalId: string; secondApprovalId?: string;
  nonce: string; secondNonce?: string; correlationId: string; payload: Payload;
  sessionIdHash: string; expectedVersion?: number;
  environmentCeilings: { expertReferral: boolean; expertResidencyBilling: boolean };
}
type Tx = Parameters<Parameters<DrizzleDb["transaction"]>[0]>[0];
const types: Record<Action, string> = {
  "expert_referral.batch_generate": "expert",
  "expert_referral.code_revoke": "expert_referral_code",
  "expert_referral.issuance_override": "expert_referral_issuance_override",
  "expert_referral.abuse_hold_open": "expert",
  "expert_referral.abuse_hold_close": "expert",
  "expert_residency.tariff_create": "expert_residency_tariff_version",
  "expert_residency.tariff_retire": "expert_residency_tariff_version",
  "expert_referral.hold_replay": "expert",
  "expert_referral.feature_switch": "expert_referral_feature_control",
};
const text = (p: Payload, key: string): string => { const value = p[key]; if (typeof value !== "string") throw new Error("invalid_admin_command"); return value; };
const number = (p: Payload, key: string): number => { const value = p[key]; if (typeof value !== "number") throw new Error("invalid_admin_command"); return value; };
const bool = (p: Payload, key: string): boolean => { const value = p[key]; if (typeof value !== "boolean") throw new Error("invalid_admin_command"); return value; };
const digest = (value: string) => createHash("sha256").update(value).digest("hex");

export class PostgresExpertReferralAdminRepository {
  constructor(private readonly db: DrizzleDb, private readonly codeCrypto: ExpertReferralCodeCrypto) {}

  async inventory(inviterExpertId: string) {
    const result = await this.db.execute<{ batchId: string; status: string; maskedSuffix: string; createdAt: Date }>(sql`
      select b.id as "batchId", b.status, c.masked_suffix as "maskedSuffix", b.created_at as "createdAt"
      from expert_referral_code_batches b join expert_referral_codes c on c.batch_id=b.id
      where b.inviter_expert_id=${inviterExpertId}::uuid order by b.created_at,b.id,c.id
    `);
    return result.rows.map(({ batchId, status, maskedSuffix, createdAt }) => ({ batchId, status, maskedSuffix, createdAt }));
  }

  async execute(command: ExpertReferralAdminRepositoryCommand): Promise<({ allowed: true; replayed: false } & Record<string, unknown>) | { allowed: false; reasonCode: "approval_denied" }> {
    return this.db.transaction(async (tx) => {
      await tx.execute(sql`set transaction isolation level serializable`);
      const approval = await this.consume(tx, command, command.approvalId, command.nonce);
      if (approval === null) return { allowed: false as const, reasonCode: "approval_denied" as const };
      const result = await this.mutate(tx, command, approval);
      await tx.execute(sql`insert into audit_events (actor_type,actor_id,authenticated_session_id_hash,action,object_type,object_id,decision,reason_code,correlation_id,occurred_at,metadata_hash) values ('admin',${approval.requesterId}::uuid,${command.sessionIdHash},${`${command.action}.allowed`},${types[command.action]},${command.objectId}::uuid,'allowed','approved_dual_control',${command.correlationId},clock_timestamp(),${digest(`${approval.approvalId}:${command.action}:${command.objectId}:allowed`)})`);
      return { allowed: true as const, replayed: false as const, ...result };
    });
  }

  private consume(tx: Tx, command: ExpertReferralAdminRepositoryCommand, approvalId: string, nonce: string): Promise<ConsumedAdminApproval | null> {
    return new PostgresAdminApprovalRepository(tx as unknown as DrizzleDb).consumeApproval({ approvalId, sessionIdHash: command.sessionIdHash, action: command.action, objectType: types[command.action], objectId: command.objectId, payload: command.payload as AdminPayload, nonce });
  }

  private async mutate(tx: Tx, command: ExpertReferralAdminRepositoryCommand, approval: ConsumedAdminApproval): Promise<Record<string, unknown>> {
    const db = tx as unknown as DrizzleDb;
    const p = command.payload;
    if (command.action === "expert_referral.batch_generate") {
      const batch = await new PostgresExpertReferralRepository(db, this.codeCrypto, { skipIsolationStatement: true }).issueBatch({ inviterExpertId: command.objectId, count: number(p, "count"), issuedByAdminId: approval.requesterId, approvalId: approval.approvalId, adminSessionIdHash: command.sessionIdHash, ...(typeof p.overrideId === "string" ? { overrideId: p.overrideId } : {}) });
      return { batchId: batch.batchId, codes: batch.codes.map((code) => code.plaintext) };
    }
    if (command.action === "expert_referral.code_revoke") return new PostgresExpertReferralRepository(db, this.codeCrypto, { skipIsolationStatement: true }).revokeCode({ codeId: command.objectId, approvalId: approval.approvalId, adminSessionIdHash: command.sessionIdHash });
    if (command.action === "expert_referral.issuance_override") {
      if (command.secondApprovalId === undefined || command.secondNonce === undefined) throw new Error("invalid_admin_command");
      const second = await this.consume(tx, command, command.secondApprovalId, command.secondNonce);
      if (second === null || second.requesterId !== approval.requesterId || second.approverId === approval.approverId || second.approverId === approval.requesterId) throw new Error("approval_denied");
      const inserted = await tx.execute<{ id: string }>(sql`insert into expert_referral_issuance_overrides (id,inviter_expert_id,additional_quota,reason_code,valid_from,valid_until,requester_id,approver_one_id,approver_two_id,approval_one_id,approval_two_id,requester_session_id_hash) values (${command.objectId}::uuid,${text(p,"inviterExpertId")}::uuid,${number(p,"additionalQuota")},${text(p,"reasonCode")},${new Date(text(p,"validFrom"))},${new Date(text(p,"validUntil"))},${approval.requesterId}::uuid,${approval.approverId}::uuid,${second.approverId}::uuid,${approval.approvalId}::uuid,${second.approvalId}::uuid,${command.sessionIdHash}) returning id`);
      return { overrideId: inserted.rows[0]!.id };
    }
    const controls = new PostgresExpertReferralControlRepository(db, { skipIsolationStatement: true });
    if (command.action === "expert_referral.abuse_hold_open") { const hold = await controls.openAbuseHold({ expertId: command.objectId, reasonCode: text(p,"reasonCode"), approvalId: approval.approvalId, adminSessionIdHash: command.sessionIdHash }); return { id: hold.id, expertId: hold.expertId, status: hold.status }; }
    if (command.action === "expert_referral.abuse_hold_close") { const hold = await controls.closeAbuseHold({ expertId: command.objectId, reasonCode: text(p,"reasonCode"), approvalId: approval.approvalId, adminSessionIdHash: command.sessionIdHash }); return { id: hold.id, expertId: hold.expertId, status: hold.status }; }
    if (command.action === "expert_residency.tariff_create") {
      const row = await tx.execute<{ id: string }>(sql`insert into expert_residency_tariff_versions (id,tariff_key,display_name,price_minor,currency,duration_seconds,active_from,active_to,approval_id,admin_session_id_hash) values (${command.objectId}::uuid,${text(p,"tariffKey")},${text(p,"displayName")},${number(p,"priceMinor")},'RUB',${number(p,"durationSeconds")},${new Date(text(p,"activeFrom"))},${new Date(text(p,"activeTo"))},${approval.approvalId}::uuid,${command.sessionIdHash}) returning id`);
      return { tariffVersionId: row.rows[0]!.id };
    }
    if (command.action === "expert_residency.tariff_retire") {
      const row = await tx.execute<{ id: string; activeTo: Date }>(sql`update expert_residency_tariff_versions set active_to=${new Date(text(p,"retiredAt"))} where id=${command.objectId}::uuid and active_from < ${new Date(text(p,"retiredAt"))} and active_to > ${new Date(text(p,"retiredAt"))} returning id,active_to as "activeTo"`);
      if (row.rows[0] === undefined) throw new Error("workflow_conflict");
      return { tariffVersionId: row.rows[0].id, activeTo: row.rows[0].activeTo.toISOString() };
    }
    if (command.action === "expert_referral.hold_replay") return new PostgresExpertResidencyProviderInboxRepository(db).replayHeldReward(command.objectId);
    if (bool(p,"newCommandsEnabled") && !command.environmentCeilings.expertReferral) throw new Error("environment_ceiling");
    if (bool(p,"rewardGrantsEnabled") && (!command.environmentCeilings.expertReferral || !command.environmentCeilings.expertResidencyBilling)) throw new Error("environment_ceiling");
    // Approval was consumed by the outer transaction; perform the optimistic write here to keep audit/session/mutation atomic.
    const expected = number(p,"expectedVersion");
    const updated = await tx.execute<{ version: number }>(sql`update expert_referral_feature_controls set version=version+1,new_commands_enabled=${bool(p,"newCommandsEnabled")},reward_grants_enabled=${bool(p,"rewardGrantsEnabled")},updated_approval_id=${approval.approvalId}::uuid,updated_admin_session_id_hash=${command.sessionIdHash},updated_at=transaction_timestamp() where control_key='expert_referrals' and version=${expected} returning version`);
    if (updated.rows[0] === undefined) {
      const inserted = expected === 0 ? await tx.execute<{ version: number }>(sql`insert into expert_referral_feature_controls (control_key,version,new_commands_enabled,reward_grants_enabled,updated_approval_id,updated_admin_session_id_hash) values ('expert_referrals',1,${bool(p,"newCommandsEnabled")},${bool(p,"rewardGrantsEnabled")},${approval.approvalId}::uuid,${command.sessionIdHash}) on conflict do nothing returning version`) : { rows: [] };
      if (inserted.rows[0] === undefined) { const error = new Error("feature_control_conflict") as Error & { code: string }; error.code="FEATURE_CONTROL_CONFLICT"; throw error; }
      return { version: inserted.rows[0].version };
    }
    return { version: updated.rows[0].version };
  }
}
