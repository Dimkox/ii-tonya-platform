import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import type { DrizzleDb } from "../client.js";
import {
  ClientConversationOperationCryptoError,
  frameClientConversationOperation,
  type ClientConversationToolProposal,
} from "../../../application/src/client-conversation-operation-crypto.js";
import type {
  ClaimedConversationOperation,
  ClientConversationOperationClaimDetails,
  ClientConversationFrozenInput,
} from "../../../application/src/client-conversation-authority.js";

export type { ClientConversationOperationClaimDetails } from "../../../application/src/client-conversation-authority.js";
export type DispatchClaimInput = Readonly<{ ownerId: string; limit: number }>;
export type RuntimeLeaseInput = Readonly<{
  instanceId: string;
  buildSha: string;
}>;
export type OperationClaimPhase = "dispatch" | "reconciliation";
export type OperationResult =
  | Readonly<{ kind: "applied"; downstreamReceiptDigest: string }>
  | Readonly<{
      kind: "rejected";
      code: "not_found" | "conflict" | "feature_disabled";
    }>;
export type OperationClaim = Readonly<{
  phase: OperationClaimPhase;
  claim: ClaimedConversationOperation;
  operationId: string;
  claimOwnerId: string;
  claimToken: string;
  claimFence: number;
  toolKind: "show_catalog" | "start_booking";
  requiredScope: "client_catalog:read" | "client_booking:write";
  payloadExpiresAt: string;
}>;
export type FencedWriteResult = "committed" | "stale";
export interface ConversationOperationClaimRepository {
  claimDispatch(input: DispatchClaimInput): Promise<readonly OperationClaim[]>;
  claimReconciliation(
    input: DispatchClaimInput,
  ): Promise<readonly OperationClaim[]>;
  cleanupExpired(input?: {
    readonly limit: number;
  }): Promise<{ expired: number }>;
  recoverExpired(input: {
    readonly limit: number;
  }): Promise<{ recovered: number }>;
}

type Row = {
  id: string;
  messageEventId: string;
  bindingId: string | null;
  requiredScope: string;
  toolKind: string;
  proposalDigest: string;
  payloadEnvelopeVersion: number;
  payloadKeyId: string;
  payloadNonce: Buffer;
  payloadCiphertext: Buffer;
  payloadTag: Buffer;
  payloadExpiresAt: Date;
  claimOwnerId: string;
  claimToken: string;
  claimFence: number;
};
const limitOk = (n: number) => Number.isSafeInteger(n) && n > 0 && n <= 1000;
const digestPattern = /^[0-9a-f]{64}$/u;
const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const frozen = (
  p: ClientConversationToolProposal,
): ClientConversationFrozenInput =>
  p.kind === "show_catalog"
    ? {
        ...(p.serviceCode === undefined ? {} : { serviceCode: p.serviceCode }),
        ...(p.language === undefined ? {} : { language: p.language }),
      }
    : { choiceHandle: p.choiceHandle };
const iso = (value: Date | string) =>
  value instanceof Date ? value.toISOString() : new Date(value).toISOString();
const resultDigest = (c: OperationClaim, code: string, receipt: string) => {
  const lp = (v: string) => {
    const b = Buffer.from(v);
    const l = Buffer.alloc(4);
    l.writeUInt32BE(b.length);
    return Buffer.concat([l, b]);
  };
  return createHash("sha256")
    .update(
      Buffer.concat([
        Buffer.from("ii-tonya/client-conversation-result/v1\\0"),
        lp(c.operationId),
        lp(c.toolKind),
        lp(code),
        lp(receipt),
      ]),
    )
    .digest("hex");
};

export class PostgresClientConversationOperationRepository {
  constructor(
    private readonly db: DrizzleDb,
    private readonly crypto: {
      decrypt(input: {
        operationId: string;
        messageEventId: string;
        bindingId: string;
        toolKind: "show_catalog" | "start_booking";
        requiredScope: "client_catalog:read" | "client_booking:write";
        proposalDigest: string;
        payloadExpiresAt: string;
        envelopeVersion: number;
        keyId: string;
        nonce: Buffer;
        ciphertext: Buffer;
        tag: Buffer;
      }): Promise<ClientConversationToolProposal>;
    },
    private readonly authority: {
      issuer: {
        issue(
          input: ClientConversationOperationClaimDetails,
        ): ClaimedConversationOperation;
      };
    },
  ) {}
  private async tx<T>(f: (db: DrizzleDb) => Promise<T>): Promise<T> {
    return this.db.transaction(async (t) => {
      await t.execute(sql`set local statement_timeout='2000ms'`);
      await t.execute(sql`set local lock_timeout='2000ms'`);
      await t.execute(
        sql`set local idle_in_transaction_session_timeout='2000ms'`,
      );
      return f(t as unknown as DrizzleDb);
    });
  }
  private async validate(
    t: DrizzleDb,
    r: Row,
    phase: OperationClaimPhase,
  ): Promise<OperationClaim | null> {
    try {
      if (
        !r.bindingId ||
        !uuidPattern.test(r.id) ||
        !uuidPattern.test(r.messageEventId) ||
        !uuidPattern.test(r.claimToken)
      )
        throw new Error("invalid_operation");
      const p = await this.crypto.decrypt({
        operationId: r.id,
        messageEventId: r.messageEventId,
        bindingId: r.bindingId,
        toolKind: r.toolKind as "show_catalog" | "start_booking",
        requiredScope: r.requiredScope as
          "client_catalog:read" | "client_booking:write",
        proposalDigest: r.proposalDigest,
        payloadExpiresAt: iso(r.payloadExpiresAt),
        envelopeVersion: r.payloadEnvelopeVersion,
        keyId: r.payloadKeyId,
        nonce: r.payloadNonce,
        ciphertext: r.payloadCiphertext,
        tag: r.payloadTag,
      });
      const framed = frameClientConversationOperation({
        operationId: r.id,
        messageEventId: r.messageEventId,
        bindingId: r.bindingId,
        keyId: r.payloadKeyId,
        payloadExpiresAt: iso(r.payloadExpiresAt),
        proposal: p,
      });
      if (framed.proposalDigest !== r.proposalDigest)
        throw new Error("crypto_invalid");
      const details = {
        operationId: r.id,
        claimToken: r.claimToken,
        claimOwnerId: r.claimOwnerId,
        claimFence: Number(r.claimFence),
        toolKind: p.kind,
        requiredScope: framed.requiredScope,
        frozenInput: frozen(p),
      };
      const claim = this.authority.issuer.issue(details);
      return {
        phase,
        claim,
        operationId: r.id,
        claimOwnerId: r.claimOwnerId,
        claimToken: r.claimToken,
        claimFence: Number(r.claimFence),
        toolKind: p.kind,
        requiredScope: framed.requiredScope,
        payloadExpiresAt: iso(r.payloadExpiresAt),
      };
    } catch (e) {
      const reason =
        e instanceof ClientConversationOperationCryptoError ||
        (e instanceof Error && e.message === "crypto_invalid")
          ? "crypto_invalid"
          : "invalid_operation";
      await t.execute(
        sql`update client_conversation_operations set status='dead_letter',terminal_reason=${reason},claim_fence=claim_fence+1,claim_owner_id=null,claim_token=null,lease_until=null,reconciliation_owner_id=null,reconciliation_claim_token=null,reconciliation_lease_until=null,payload_envelope_version=null,payload_key_id=null,payload_nonce=null,payload_ciphertext=null,payload_tag=null,updated_at=transaction_timestamp() where id=${r.id}::uuid and claim_owner_id=${r.claimOwnerId} and claim_token=${r.claimToken}::uuid and claim_fence=${r.claimFence} and status=${phase === "dispatch" ? "processing" : "reconciling"}`,
      );
      await t.execute(
        sql`insert into client_conversation_operation_cases(operation_id,case_kind,reason)values(${r.id}::uuid,'operator_case',${reason})on conflict(operation_id,case_kind)do nothing`,
      );
      return null;
    }
  }
  async claimDispatch(
    i: DispatchClaimInput,
  ): Promise<readonly OperationClaim[]> {
    if (!i.ownerId || !limitOk(i.limit))
      throw new Error("client_conversation_claim_invalid");
    return this.tx(async (t) => {
      const q = await t.execute<Row>(
        sql`with c as(select id from client_conversation_operations where status in('pending','retry_wait') and(status='pending'or next_attempt_at<=transaction_timestamp())and payload_expires_at>=transaction_timestamp()+interval '30 seconds' and attempt<5 order by payload_expires_at,id for update skip locked limit ${i.limit})update client_conversation_operations o set status='processing',claim_owner_id=${i.ownerId},claim_token=gen_random_uuid(),claim_fence=o.claim_fence+1,attempt=o.attempt+1,lease_until=least(transaction_timestamp()+interval '5 minutes',o.payload_expires_at),next_attempt_at=null,updated_at=transaction_timestamp()from c where o.id=c.id returning o.id,o.message_event_id as "messageEventId",o.binding_id as "bindingId",o.required_scope as "requiredScope",o.tool_kind as "toolKind",o.proposal_digest as "proposalDigest",o.payload_envelope_version as "payloadEnvelopeVersion",o.payload_key_id as "payloadKeyId",o.payload_nonce as "payloadNonce",o.payload_ciphertext as "payloadCiphertext",o.payload_tag as "payloadTag",o.payload_expires_at as "payloadExpiresAt",o.claim_owner_id as "claimOwnerId",o.claim_token as "claimToken",o.claim_fence as "claimFence"`,
      );
      const out: OperationClaim[] = [];
      for (const r of q.rows) {
        const c = await this.validate(t, r, "dispatch");
        if (c) out.push(c);
      }
      return out;
    });
  }
  async claimReconciliation(
    i: DispatchClaimInput,
  ): Promise<readonly OperationClaim[]> {
    if (!i.ownerId || !limitOk(i.limit))
      throw new Error("client_conversation_claim_invalid");
    return this.tx(async (t) => {
      const q = await t.execute<Row>(
        sql`with c as(select id from client_conversation_operations where status='unknown_outcome' and reconciliation_attempt<5 and payload_expires_at>=transaction_timestamp()+interval '30 seconds' order by payload_expires_at,id for update skip locked limit ${i.limit})update client_conversation_operations o set status='reconciling',reconciliation_owner_id=${i.ownerId},reconciliation_claim_token=gen_random_uuid(),claim_fence=o.claim_fence+1,reconciliation_attempt=o.reconciliation_attempt+1,reconciliation_lease_until=least(transaction_timestamp()+interval '5 minutes',o.payload_expires_at),updated_at=transaction_timestamp()from c where o.id=c.id returning o.id,o.message_event_id as "messageEventId",o.binding_id as "bindingId",o.required_scope as "requiredScope",o.tool_kind as "toolKind",o.proposal_digest as "proposalDigest",o.payload_envelope_version as "payloadEnvelopeVersion",o.payload_key_id as "payloadKeyId",o.payload_nonce as "payloadNonce",o.payload_ciphertext as "payloadCiphertext",o.payload_tag as "payloadTag",o.payload_expires_at as "payloadExpiresAt",o.reconciliation_owner_id as "claimOwnerId",o.reconciliation_claim_token as "claimToken",o.claim_fence as "claimFence"`,
      );
      const out: OperationClaim[] = [];
      for (const r of q.rows) {
        const c = await this.validate(t, r, "reconciliation");
        if (c) out.push(c);
      }
      return out;
    });
  }
  private async fenced(
    c: OperationClaim,
    action:
      "succeeded" | "denied" | "retry_wait" | "unknown_outcome" | "dead_letter",
    reason?: string,
    digest?: string,
  ) {
    return this.tx(async (t) => {
      const lease =
        c.phase === "dispatch"
          ? sql`claim_owner_id=${c.claimOwnerId} and claim_token=${c.claimToken}::uuid and status='processing' and lease_until>transaction_timestamp()`
          : sql`reconciliation_owner_id=${c.claimOwnerId} and reconciliation_claim_token=${c.claimToken}::uuid and status='reconciling' and reconciliation_lease_until>transaction_timestamp()`;
      const terminal =
        action === "succeeded" ||
        action === "denied" ||
        action === "dead_letter";
      const q = await t.execute(
        sql`update client_conversation_operations set status=${action},terminal_reason=${action === "succeeded" ? null : action === "denied" ? "grant_denied" : action === "dead_letter" ? reason : null},result_digest=${digest ?? null},next_attempt_at=${action === "retry_wait" ? sql`least(transaction_timestamp()+interval '30 seconds',payload_expires_at-interval '1 second')` : null},claim_owner_id=null,claim_token=null,lease_until=null,reconciliation_owner_id=null,reconciliation_claim_token=null,reconciliation_lease_until=null,payload_envelope_version=${terminal ? null : sql`payload_envelope_version`},payload_key_id=${terminal ? null : sql`payload_key_id`},payload_nonce=${terminal ? null : sql`payload_nonce`},payload_ciphertext=${terminal ? null : sql`payload_ciphertext`},payload_tag=${terminal ? null : sql`payload_tag`},updated_at=transaction_timestamp() where id=${c.operationId}::uuid and claim_fence=${c.claimFence} and payload_expires_at>transaction_timestamp()and ${lease}`,
      );
      if (
        (q.rowCount ?? 0) === 1 &&
        (action === "denied" || action === "dead_letter")
      )
        await t.execute(
          sql`insert into client_conversation_operation_cases(operation_id,case_kind,reason)values(${c.operationId}::uuid,'operator_case',${action === "denied" ? "grant_denied" : reason!})on conflict(operation_id,case_kind)do nothing`,
        );
      return (q.rowCount ?? 0) === 1 ? "committed" : "stale";
    });
  }
  async recordResult(c: OperationClaim, r: OperationResult) {
    const receipt = r.kind === "applied" ? r.downstreamReceiptDigest : "";
    if (r.kind === "applied" && !digestPattern.test(receipt))
      return "stale" as const;
    return this.fenced(
      c,
      "succeeded",
      undefined,
      resultDigest(c, r.kind === "applied" ? "applied" : r.code, receipt),
    );
  }
  async recordGrantDenied(c: OperationClaim) {
    return this.fenced(c, "denied");
  }
  async recordRetryWait(c: OperationClaim) {
    const row = await this.db.execute<{
      attempt: number;
      reconciliationAttempt: number;
    }>(
      sql`select attempt,reconciliation_attempt as "reconciliationAttempt" from client_conversation_operations where id=${c.operationId}::uuid and claim_fence=${c.claimFence}`,
    );
    const exhausted =
      Number(row.rows[0]?.attempt ?? 0) >= 5 ||
      Number(row.rows[0]?.reconciliationAttempt ?? 0) >= 5;
    return this.fenced(
      c,
      exhausted ? "dead_letter" : "retry_wait",
      exhausted ? "attempts_exhausted" : undefined,
    );
  }
  async recordUnknownOutcome(c: OperationClaim) {
    return this.fenced(c, "unknown_outcome");
  }
  async recordDeadLetter(
    c: OperationClaim,
    reason: "invalid_operation" | "crypto_invalid" | "attempts_exhausted",
  ) {
    return this.fenced(c, "dead_letter", reason);
  }
  async recoverExpired(i: { readonly limit: number }) {
    if (!limitOk(i.limit)) throw new Error("client_conversation_limit_invalid");
    return this.tx(async (t) => {
      const q = await t.execute(
        sql`with x as(select id from client_conversation_operations where status in('processing','reconciling')and coalesce(lease_until,reconciliation_lease_until)<transaction_timestamp()for update skip locked limit ${i.limit})update client_conversation_operations o set status='unknown_outcome',claim_fence=claim_fence+1,claim_owner_id=null,claim_token=null,lease_until=null,reconciliation_owner_id=null,reconciliation_claim_token=null,reconciliation_lease_until=null,updated_at=transaction_timestamp()from x where o.id=x.id`,
      );
      return { recovered: q.rowCount ?? 0 };
    });
  }
  async cleanupExpired(i: { readonly limit: number } = { limit: 100 }) {
    if (!limitOk(i.limit)) throw new Error("client_conversation_limit_invalid");
    return this.tx(async (t) => {
      const q = await t.execute<{ id: string }>(
        sql`with x as(select id from client_conversation_operations where status not in('succeeded','denied','dead_letter','privacy_expired')and payload_expires_at<=transaction_timestamp()and(status not in('processing','reconciling')or coalesce(lease_until,reconciliation_lease_until)<transaction_timestamp())for update skip locked limit ${i.limit})update client_conversation_operations o set status='privacy_expired',terminal_reason='payload_expired',claim_fence=claim_fence+1,claim_owner_id=null,claim_token=null,lease_until=null,reconciliation_owner_id=null,reconciliation_claim_token=null,reconciliation_lease_until=null,next_attempt_at=null,payload_envelope_version=null,payload_key_id=null,payload_nonce=null,payload_ciphertext=null,payload_tag=null,updated_at=transaction_timestamp()from x where o.id=x.id returning o.id`,
      );
      for (const row of q.rows) {
        await t.execute(
          sql`insert into client_conversation_operation_cases(operation_id,case_kind,reason)values(${row.id}::uuid,'operator_case','payload_expired'),(${row.id}::uuid,'deletion_receipt','payload_expired')on conflict(operation_id,case_kind)do nothing`,
        );
      }
      return { expired: q.rowCount ?? 0 };
    });
  }
  async heartbeatRuntime(i: RuntimeLeaseInput) {
    if (!i.instanceId || !/^[0-9a-f]{40}$/u.test(i.buildSha))
      throw new Error("client_conversation_runtime_lease_invalid");
    await this.db.execute(
      sql`insert into client_conversation_runtime_leases(capability,instance_id,contract_version,build_sha,heartbeat_at,lease_until)select capability,${i.instanceId},1,${i.buildSha},transaction_timestamp(),transaction_timestamp()+interval '30 seconds'from(values('dispatch_v1'),('cleanup_v1'))v(capability)on conflict(capability,instance_id)do update set contract_version=1,build_sha=excluded.build_sha,heartbeat_at=excluded.heartbeat_at,lease_until=excluded.lease_until`,
    );
  }
}
export type ConversationOperationTool =
  ClientConversationOperationClaimDetails["toolKind"];
