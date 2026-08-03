import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import type { DrizzleDb } from "../client.js";
import type { ExpertReferralCodeCrypto } from "./expert-referral-repository.js";
import { createTransactionOwnedExpertReferralRepository } from "./expert-referral-repository.js";
import { createTransactionOwnedExpertReferralControlRepository } from "./expert-referral-control-repository.js";
import { PostgresExpertResidencyProviderInboxRepository } from "./expert-residency-provider-inbox-repository.js";
import { canonicalAdminPayloadHash, PostgresAdminApprovalRepository, type AdminPayload, type ApprovalAdminAction, type ConsumedAdminApproval } from "./admin-approval-repository.js";
import { withSerializableRetry } from "./message-repository.js";
import { withTrustedExpertReferralTransaction, type TrustedExpertReferralTransaction } from "./expert-referral-transaction-capability.js";

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
class ApprovalDenied extends Error {}
const exactResult = (result: Record<string, unknown>, keys: readonly string[]): void => {
  if (Object.keys(result).length !== keys.length || keys.some((key) => !(key in result))) throw new Error("invalid_admin_result");
};
const resultText = (result: Record<string, unknown>, key: string): string => {
  const value = result[key]; if (typeof value !== "string" || value.length < 1 || value.length > 128) throw new Error("invalid_admin_result"); return value;
};
const resultNumber = (result: Record<string, unknown>, key: string): number => {
  const value = result[key]; if (typeof value !== "number" || !Number.isSafeInteger(value)) throw new Error("invalid_admin_result"); return value;
};
const resultUuid = (result: Record<string, unknown>, key: string): string => {
  const value = resultText(result,key); if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(value)) throw new Error("invalid_admin_result"); return value;
};
function safeExecutionResult(command: ExpertReferralAdminRepositoryCommand, result: Record<string, unknown>): Record<string, string | number> {
  const action = command.action;
  if (action === "expert_referral.batch_generate") {
    const count = number(command.payload,"count");
    if ("codes" in result) { exactResult(result, ["batchId", "codes"]); if (!Array.isArray(result.codes) || result.codes.length !== count) throw new Error("invalid_admin_result"); }
    else { exactResult(result, ["batchId", "count"]); if (resultNumber(result,"count") !== count) throw new Error("admin_replay_conflict"); }
    return { batchId: resultUuid(result,"batchId"), count };
  }
  if (action === "expert_referral.code_revoke") { exactResult(result,["id","status"]); if (resultUuid(result,"id") !== command.objectId || resultText(result,"status") !== "revoked") throw new Error("invalid_admin_result"); return { id: command.objectId, status: "revoked" }; }
  if (action === "expert_referral.issuance_override") { exactResult(result,["overrideId"]); if (resultUuid(result,"overrideId") !== command.objectId) throw new Error("invalid_admin_result"); return { overrideId: command.objectId }; }
  if (action === "expert_referral.abuse_hold_open" || action === "expert_referral.abuse_hold_close") { exactResult(result,["id","expertId","status"]); const status = action.endsWith("_open") ? "open" : "closed"; if (resultUuid(result,"expertId") !== command.objectId || resultText(result,"status") !== status) throw new Error("invalid_admin_result"); return { id: resultUuid(result,"id"), expertId: command.objectId, status }; }
  if (action === "expert_residency.tariff_create") { exactResult(result,["tariffVersionId"]); if (resultUuid(result,"tariffVersionId") !== command.objectId) throw new Error("invalid_admin_result"); return { tariffVersionId: command.objectId }; }
  if (action === "expert_residency.tariff_retire") { exactResult(result,["tariffVersionId","activeTo"]); if (resultUuid(result,"tariffVersionId") !== command.objectId || resultText(result,"activeTo") !== text(command.payload,"retiredAt")) throw new Error("invalid_admin_result"); return { tariffVersionId: command.objectId, activeTo: text(command.payload,"retiredAt") }; }
  if (action === "expert_referral.hold_replay") { exactResult(result,["kind","reason"]); const kind=resultText(result,"kind"), reason=resultText(result,"reason"); if (!["granted","not_granted"].includes(kind) || !["not_pending","snapshot_incomplete","gate_closed","debt_repaid","already_replayed","feature_enabled"].includes(reason)) throw new Error("invalid_admin_result"); return { kind, reason }; }
  exactResult(result,["version"]); const version=resultNumber(result,"version"); if (version !== number(command.payload,"expectedVersion") + 1) throw new Error("invalid_admin_result"); return { version };
}

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

  async execute(command: ExpertReferralAdminRepositoryCommand): Promise<({ allowed: true; replayed: boolean } & Record<string, unknown>) | { allowed: false; reasonCode: "approval_denied" }> {
    return withSerializableRetry(() => withTrustedExpertReferralTransaction(this.db, async (tx, capability) => {
      await tx.execute(sql`savepoint expert_referral_admin_unit`);
      try {
        const replay = await this.findReplay(tx, command);
        if (replay !== null) {
          await tx.execute(sql`release savepoint expert_referral_admin_unit`);
          return { allowed: true as const, replayed: true as const, ...replay };
        }
        const approval = await this.consume(tx, command, command.approvalId, command.nonce);
        if (approval === null) throw new ApprovalDenied();
        const result = await this.mutate(tx, capability, command, approval);
        const safeResult = safeExecutionResult(command, result);
        await tx.execute(sql`insert into expert_referral_admin_execution_results (approval_id,second_approval_id,action,object_id,payload_hash,nonce_hash,second_nonce_hash,requester_session_id_hash,expected_version,safe_result) values (${approval.approvalId}::uuid,${command.secondApprovalId ?? null}::uuid,${command.action},${command.objectId}::uuid,${canonicalAdminPayloadHash(command.payload as AdminPayload)},${`sha256:${digest(command.nonce)}`},${command.secondNonce === undefined ? null : `sha256:${digest(command.secondNonce)}`},${command.sessionIdHash},${command.action === "expert_referral.feature_switch" ? number(command.payload,"expectedVersion") : null},${JSON.stringify(safeResult)}::jsonb)`);
        await this.appendAudit(tx, command, approval.requesterId, "allowed", "approved_dual_control");
        await tx.execute(sql`release savepoint expert_referral_admin_unit`);
        return { allowed: true as const, replayed: false as const, ...result };
      } catch (error) {
        if (!(error instanceof ApprovalDenied)) throw error;
        await tx.execute(sql`rollback to savepoint expert_referral_admin_unit`);
        await tx.execute(sql`release savepoint expert_referral_admin_unit`);
        const replay = await this.findReplay(tx, command);
        if (replay !== null) return { allowed: true as const, replayed: true as const, ...replay };
        const actor = await tx.execute<{ actorId: string }>(sql`select admin_id as "actorId" from admin_sessions where session_id_hash=${command.sessionIdHash}`);
        await this.appendAudit(tx, command, actor.rows[0]?.actorId ?? "00000000-0000-0000-0000-000000000000", "denied", "approval_denied");
        return { allowed: false as const, reasonCode: "approval_denied" as const };
      }
    }));
  }

  private async findReplay(tx: Tx, command: ExpertReferralAdminRepositoryCommand): Promise<Record<string, string | number> | null> {
    const approvals = new PostgresAdminApprovalRepository(tx as unknown as DrizzleDb);
    const approval = await approvals.validateConsumedApprovalReplay({ approvalId: command.approvalId, sessionIdHash: command.sessionIdHash, action: command.action, objectType: types[command.action], objectId: command.objectId, payload: command.payload as AdminPayload, nonce: command.nonce });
    if (approval === null) return null;
    if (command.action === "expert_referral.issuance_override") {
      if (command.secondApprovalId === undefined || command.secondNonce === undefined || command.secondApprovalId === command.approvalId) return null;
      const second = await approvals.validateConsumedApprovalReplay({ approvalId: command.secondApprovalId, sessionIdHash: command.sessionIdHash, action: command.action, objectType: types[command.action], objectId: command.objectId, payload: command.payload as AdminPayload, nonce: command.secondNonce });
      if (second === null || second.requesterId !== approval.requesterId || second.approverId === approval.approverId || second.approverId === approval.requesterId) return null;
    } else if (command.secondApprovalId !== undefined || command.secondNonce !== undefined) return null;
    const stored = await tx.execute<{ action: Action; secondApprovalId: string | null; objectId: string; payloadHash: string; nonceHash: string; secondNonceHash: string | null; sessionIdHash: string; safeResult: Record<string, unknown> }>(sql`select action,second_approval_id as "secondApprovalId",object_id as "objectId",payload_hash as "payloadHash",nonce_hash as "nonceHash",second_nonce_hash as "secondNonceHash",requester_session_id_hash as "sessionIdHash",safe_result as "safeResult" from expert_referral_admin_execution_results where approval_id=${command.approvalId}::uuid`);
    const row = stored.rows[0];
    if (row === undefined) return null;
    if (row.action !== command.action || row.secondApprovalId !== (command.secondApprovalId ?? null) || row.objectId !== command.objectId || row.payloadHash !== canonicalAdminPayloadHash(command.payload as AdminPayload) || row.nonceHash !== `sha256:${digest(command.nonce)}` || row.secondNonceHash !== (command.secondNonce === undefined ? null : `sha256:${digest(command.secondNonce)}`) || row.sessionIdHash !== command.sessionIdHash) throw new Error("admin_replay_conflict");
    return safeExecutionResult(command, row.safeResult);
  }

  private async appendAudit(tx: Tx, command: ExpertReferralAdminRepositoryCommand, actorId: string, decision: "allowed" | "denied", reasonCode: string): Promise<void> {
    await tx.execute(sql`insert into audit_events (actor_type,actor_id,authenticated_session_id_hash,action,object_type,object_id,decision,reason_code,correlation_id,occurred_at,metadata_hash) values ('admin',${actorId}::uuid,${command.sessionIdHash},${`${command.action}.${decision}`},${types[command.action]},${command.objectId}::uuid,${decision},${reasonCode},${command.correlationId},clock_timestamp(),${digest(`${command.approvalId}:${command.action}:${command.objectId}:${decision}:${reasonCode}`)})`);
  }

  private consume(tx: Tx, command: ExpertReferralAdminRepositoryCommand, approvalId: string, nonce: string): Promise<ConsumedAdminApproval | null> {
    return new PostgresAdminApprovalRepository(tx as unknown as DrizzleDb).consumeApproval({ approvalId, sessionIdHash: command.sessionIdHash, action: command.action, objectType: types[command.action], objectId: command.objectId, payload: command.payload as AdminPayload, nonce });
  }

  private async mutate(tx: Tx, capability: TrustedExpertReferralTransaction, command: ExpertReferralAdminRepositoryCommand, approval: ConsumedAdminApproval): Promise<Record<string, unknown>> {
    const db = tx as unknown as DrizzleDb;
    const p = command.payload;
    if (command.action === "expert_referral.batch_generate") {
      const batch = await createTransactionOwnedExpertReferralRepository(tx, this.codeCrypto, capability).issueBatch({ inviterExpertId: command.objectId, count: number(p, "count"), issuedByAdminId: approval.requesterId, approvalId: approval.approvalId, adminSessionIdHash: command.sessionIdHash, ...(typeof p.overrideId === "string" ? { overrideId: p.overrideId } : {}) });
      return { batchId: batch.batchId, codes: batch.codes.map((code) => code.plaintext) };
    }
    if (command.action === "expert_referral.code_revoke") return createTransactionOwnedExpertReferralRepository(tx, this.codeCrypto, capability).revokeCode({ codeId: command.objectId, approvalId: approval.approvalId, adminSessionIdHash: command.sessionIdHash });
    if (command.action === "expert_referral.issuance_override") {
      if (command.secondApprovalId === undefined || command.secondNonce === undefined) throw new Error("invalid_admin_command");
      const second = await this.consume(tx, command, command.secondApprovalId, command.secondNonce);
      if (second === null || second.requesterId !== approval.requesterId || second.approverId === approval.approverId || second.approverId === approval.requesterId) throw new ApprovalDenied();
      const inserted = await tx.execute<{ id: string }>(sql`insert into expert_referral_issuance_overrides (id,inviter_expert_id,additional_quota,reason_code,valid_from,valid_until,requester_id,approver_one_id,approver_two_id,approval_one_id,approval_two_id,requester_session_id_hash) values (${command.objectId}::uuid,${text(p,"inviterExpertId")}::uuid,${number(p,"additionalQuota")},${text(p,"reasonCode")},${new Date(text(p,"validFrom"))},${new Date(text(p,"validUntil"))},${approval.requesterId}::uuid,${approval.approverId}::uuid,${second.approverId}::uuid,${approval.approvalId}::uuid,${second.approvalId}::uuid,${command.sessionIdHash}) returning id`);
      return { overrideId: inserted.rows[0]!.id };
    }
    const controls = createTransactionOwnedExpertReferralControlRepository(tx, capability);
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
