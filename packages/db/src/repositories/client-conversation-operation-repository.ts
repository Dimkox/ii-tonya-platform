import { sql } from "drizzle-orm";
import type { DrizzleDb } from "../client.js";
import type { ClaimedConversationOperation, ClientConversationOperationClaimDetails } from "../../../application/src/client-conversation-authority.js";
export type { ClientConversationOperationClaimDetails } from "../../../application/src/client-conversation-authority.js";

export interface ConversationOperationClaimRepository {
  claim(): Promise<Readonly<{ claim: ClaimedConversationOperation; details: ClientConversationOperationClaimDetails }> | null>;
  cleanupExpired(): Promise<{ expired: number }>;
  reconcile(): Promise<{ reconciled: number }>;
}
export interface DispatchClaimInput { readonly ownerId: string; readonly limit: number; }
export interface RuntimeLeaseInput { readonly instanceId: string; readonly buildSha: string; }
export interface EncryptedOperationRow extends ClientConversationOperationClaimDetails { readonly [key: string]: unknown;
  readonly payloadKeyId: string; readonly payloadNonce: Buffer; readonly payloadCiphertext: Buffer; readonly payloadTag: Buffer; readonly payloadExpiresAt: Date;
}
const bounded = (n: number) => Number.isSafeInteger(n) && n > 0 && n <= 1000;

export class PostgresClientConversationOperationRepository implements ConversationOperationClaimRepository {
  constructor(private readonly db: DrizzleDb, private readonly crypto: unknown, private readonly authority: { readonly issuer: { issue(input: ClientConversationOperationClaimDetails): ClaimedConversationOperation } }) {}
  async claimDispatch(input: DispatchClaimInput): Promise<readonly EncryptedOperationRow[]> {
    if (!input.ownerId || !bounded(input.limit)) throw new Error("client_conversation_claim_invalid");
    return this.db.transaction(async (tx) => {
      await tx.execute(sql`set local statement_timeout='2000ms'`);
      await tx.execute(sql`set local lock_timeout='2000ms'`);
      await tx.execute(sql`set local idle_in_transaction_session_timeout='2000ms'`);
      const result = await tx.execute<EncryptedOperationRow>(sql`with candidates as (select id from client_conversation_operations where status in ('pending','retry_wait') and (status='pending' or next_attempt_at <= transaction_timestamp()) and payload_expires_at >= transaction_timestamp()+interval '30 seconds' order by payload_expires_at,id for update skip locked limit ${input.limit}) update client_conversation_operations o set status='processing',claim_owner_id=${input.ownerId},claim_token=gen_random_uuid(),claim_fence=o.claim_fence+1,attempt=o.attempt+1,lease_until=least(transaction_timestamp()+interval '5 minutes',o.payload_expires_at),next_attempt_at=null,updated_at=transaction_timestamp() from candidates c where o.id=c.id returning o.*`);
      return result.rows;
    });
  }
  async claim(): Promise<null> { return null; }
  async recoverExpired(input: { readonly limit: number }): Promise<{ recovered: number }> {
    if (!bounded(input.limit)) throw new Error("client_conversation_limit_invalid");
    const result = await this.db.execute(sql`update client_conversation_operations set status='unknown_outcome',claim_fence=claim_fence+1,claim_owner_id=null,claim_token=null,lease_until=null,reconciliation_owner_id=null,reconciliation_claim_token=null,reconciliation_lease_until=null,updated_at=transaction_timestamp() where id in (select id from client_conversation_operations where status in ('processing','reconciling') and coalesce(lease_until,reconciliation_lease_until)<transaction_timestamp() for update skip locked limit ${input.limit})`);
    return { recovered: result.rowCount ?? 0 };
  }
  async cleanupExpired(input: { readonly limit: number } = { limit: 100 }): Promise<{ expired: number }> {
    if (!bounded(input.limit)) throw new Error("client_conversation_limit_invalid");
    const result = await this.db.execute(sql`with expired as (select id from client_conversation_operations where status not in ('succeeded','denied','dead_letter','privacy_expired') and payload_expires_at<=transaction_timestamp() and (status not in ('processing','reconciling') or coalesce(lease_until,reconciliation_lease_until)<transaction_timestamp()) for update skip locked limit ${input.limit}) update client_conversation_operations o set status='privacy_expired',terminal_reason='payload_expired',claim_fence=o.claim_fence+1,claim_owner_id=null,claim_token=null,lease_until=null,reconciliation_owner_id=null,reconciliation_claim_token=null,reconciliation_lease_until=null,next_attempt_at=null,payload_envelope_version=null,payload_key_id=null,payload_nonce=null,payload_ciphertext=null,payload_tag=null,updated_at=transaction_timestamp() from expired where o.id=expired.id`);
    return { expired: result.rowCount ?? 0 };
  }
  async heartbeatRuntime(input: RuntimeLeaseInput): Promise<void> {
    if (!/^[0-9a-f]{40}$/u.test(input.buildSha) || !input.instanceId) throw new Error("client_conversation_runtime_lease_invalid");
    await this.db.execute(sql`insert into client_conversation_runtime_leases (capability,instance_id,contract_version,build_sha,heartbeat_at,lease_until) select capability,${input.instanceId},1,${input.buildSha},transaction_timestamp(),transaction_timestamp()+interval '30 seconds' from (values ('dispatch_v1'),('cleanup_v1')) as capabilities(capability) on conflict (capability,instance_id) do update set contract_version=1,build_sha=excluded.build_sha,heartbeat_at=excluded.heartbeat_at,lease_until=excluded.lease_until`);
  }
  async reconcile(): Promise<{ reconciled: number }> { return { reconciled: 0 }; }
  protected issue(details: ClientConversationOperationClaimDetails): ClaimedConversationOperation { return this.authority.issuer.issue(details); }
}
export type ConversationOperationTool = ClientConversationOperationClaimDetails["toolKind"];
