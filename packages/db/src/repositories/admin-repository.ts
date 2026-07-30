import { sql } from "drizzle-orm";
import type { DrizzleDb } from "../client.js";

type Transaction = Parameters<Parameters<DrizzleDb["transaction"]>[0]>[0];

export interface GrantAdminPackageCommand { readonly userId: string; readonly units: 100 | 500 | 1000 | 1500 | 2000; readonly kind: "admin" | "intro"; readonly expiresAt: Date | null; readonly idempotencyKey: string; }
export interface RevokeAdminPackageCommand { readonly packageId: string; readonly idempotencyKey: string; }
export interface AdminPackageRepository { grantPackage(command: GrantAdminPackageCommand): Promise<{ packageId: string }>; revokePackage(command: RevokeAdminPackageCommand): Promise<{ delta: number; originalEntryId: string }>; }
export interface ExecuteApprovedGrantCommand extends GrantAdminPackageCommand { readonly approvalId: string; readonly requesterId: string; readonly requesterSessionIdHash: string; readonly payloadHash: string; readonly action: "package.grant" | "package.intro_grant"; readonly correlationId: string; readonly occurredAt: Date; }
const one = <T>(rows: readonly T[], message: string): T => { const row = rows[0]; if (row === undefined) throw new Error(message); return row; };

export class PostgresAdminRepository implements AdminPackageRepository {
  constructor(private readonly db: DrizzleDb) {}
  async grantPackage(command: GrantAdminPackageCommand): Promise<{ packageId: string }> {
    return this.db.transaction(async (tx) => {
      const packageRow = one((await tx.execute<{ id: string }>(sql`
        insert into message_packages (user_id, granted_messages, grant_idempotency_key, kind, expires_at)
        values (${command.userId}::uuid, ${command.units}, ${command.idempotencyKey}, ${command.kind}, ${command.expiresAt})
        on conflict (grant_idempotency_key) do update set grant_idempotency_key = excluded.grant_idempotency_key
        returning id
      `)).rows, "Package was not created");
      await tx.execute(sql`
        insert into message_ledger_entries (package_id, entry_kind, delta, idempotency_key)
        values (${packageRow.id}::uuid, 'grant', ${command.units}, ${`grant:${command.idempotencyKey}`})
        on conflict (idempotency_key) do nothing
      `);
      return { packageId: packageRow.id };
    });
  }
  async revokePackage(command: RevokeAdminPackageCommand): Promise<{ delta: number; originalEntryId: string }> {
    return this.db.transaction(async (tx: Transaction) => {
      const grant = one((await tx.execute<{ id: string }>(sql`
        select l.id from message_packages p join message_ledger_entries l on l.package_id = p.id
        where p.id = ${command.packageId}::uuid and l.entry_kind = 'grant' for update of p, l
      `)).rows, "Package grant not found");
      const balance = one((await tx.execute<{ balance: number }>(sql`
        select coalesce(sum(delta), 0)::integer as balance from message_ledger_entries where package_id = ${command.packageId}::uuid
      `)).rows, "Package balance not found");
      const delta = -Math.max(0, Number(balance.balance));
      await tx.execute(sql`
        insert into message_ledger_entries (package_id, entry_kind, delta, original_entry_id, idempotency_key)
        values (${command.packageId}::uuid, 'revocation', ${delta}, ${grant.id}::uuid, ${command.idempotencyKey})
        on conflict (idempotency_key) do nothing
      `);
      return { delta, originalEntryId: grant.id };
    });
  }
  async executeApprovedGrant(command: ExecuteApprovedGrantCommand): Promise<{ allowed: true; packageId: string } | { allowed: false }> {
    return this.db.transaction(async (tx) => {
      const approval = (await tx.execute<{ id: string }>(sql`
        update admin_approvals
        set consumed_at = ${command.occurredAt}
        where id = ${command.approvalId}::uuid
          and action = ${command.action}
          and object_type = 'user'
          and object_id = ${command.userId}::uuid
          and requester_id = ${command.requesterId}::uuid
          and requester_session_id_hash = ${command.requesterSessionIdHash}
          and payload_hash = ${command.payloadHash}
          and consumed_at is null and expires_at > ${command.occurredAt}
          and approver_id is not null and approver_id <> requester_id
          and approver_session_id_hash is not null
          and requester_mfa_verified_at <= ${command.occurredAt}
          and requester_mfa_verified_at >= ${command.occurredAt} - interval '15 minutes'
          and approver_mfa_verified_at <= ${command.occurredAt}
          and approver_mfa_verified_at >= ${command.occurredAt} - interval '15 minutes'
        returning id
      `)).rows[0];
      if (approval === undefined) {
        await tx.execute(sql`
          insert into audit_events (actor_type, actor_id, authenticated_session_id_hash, action, object_type, object_id, decision, reason_code, correlation_id, occurred_at, metadata_hash)
          values ('admin', ${command.requesterId}::uuid, ${command.requesterSessionIdHash}, ${`${command.action}.denied`}, 'user', ${command.userId}::uuid, 'denied', 'approval_not_found', ${command.correlationId}, ${command.occurredAt}, ${command.payloadHash})
        `);
        return { allowed: false };
      }
      const packageRow = one((await tx.execute<{ id: string }>(sql`
        insert into message_packages (user_id, granted_messages, grant_idempotency_key, kind, expires_at)
        values (${command.userId}::uuid, ${command.units}, ${command.idempotencyKey}, ${command.kind}, ${command.expiresAt})
        on conflict (grant_idempotency_key) do update set grant_idempotency_key = excluded.grant_idempotency_key
        returning id
      `)).rows, "Package was not created");
      await tx.execute(sql`
        insert into message_ledger_entries (package_id, entry_kind, delta, idempotency_key)
        values (${packageRow.id}::uuid, 'grant', ${command.units}, ${`grant:${command.idempotencyKey}`})
        on conflict (idempotency_key) do nothing
      `);
      await tx.execute(sql`
        insert into audit_events (actor_type, actor_id, authenticated_session_id_hash, action, object_type, object_id, decision, reason_code, correlation_id, occurred_at, metadata_hash)
        values ('admin', ${command.requesterId}::uuid, ${command.requesterSessionIdHash}, ${`${command.action}.allowed`}, 'user', ${command.userId}::uuid, 'allowed', 'approved', ${command.correlationId}, ${command.occurredAt}, ${command.payloadHash})
      `);
      return { allowed: true, packageId: packageRow.id };
    });
  }
}
