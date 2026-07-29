import { PostgreSqlContainer } from "@testcontainers/postgresql";
import { drizzle } from "drizzle-orm/node-postgres";
import { sql } from "drizzle-orm";
import { Pool } from "pg";
import * as schema from "../schema/index.js";
import type { DrizzleDb } from "../client.js";

type LedgerKind = "debit" | "free";

export interface TestDatabase {
  db: DrizzleDb;
  reset(): Promise<void>;
  stop(): Promise<void>;
  createUser(): Promise<string>;
  createLedgerPackage(userId: string, grantIdempotencyKey: string): Promise<string>;
  seedUserAndPackage(input: { externalMessageId: string; grantedMessages: number }): Promise<void>;
  insertDuplicateExternalMessage(externalMessageId: string): Promise<void>;
  columnExists(table: string, column: string): Promise<boolean>;
  packageBalance(): Promise<number>;
  appendLedgerFact(input: { kind: LedgerKind; delta: number; idempotencyKey: string }): Promise<void>;
  updateLedgerFact(idempotencyKey: string, delta: number): Promise<void>;
  deleteLedgerFact(idempotencyKey: string): Promise<void>;
  appendGrantFact(packageId: string, delta: number, idempotencyKey: string): Promise<string>;
  appendMessageDebit(packageId: string, externalMessageId: string, idempotencyKey: string): Promise<string>;
  appendCompensation(packageId: string, originalEntryId: string, idempotencyKey: string): Promise<void>;
  appendRevocation(packageId: string, originalEntryId: string, idempotencyKey: string): Promise<void>;
  ledgerFactCount(packageIds: string[]): Promise<number>;
}

function oneId(rows: { id: string }[]): string {
  const id = rows[0]?.id;
  if (id === undefined) throw new Error("Expected one identifier");
  return id;
}

export async function startTestPostgres(): Promise<TestDatabase> {
  const container = await new PostgreSqlContainer("postgres:16-alpine").start();
  const pool = new Pool({ connectionString: container.getConnectionUri() });
  const db = drizzle(pool, { schema });
  let primaryPackageId: string | undefined;
  let primaryUserId: string | undefined;

  const createUser = async (): Promise<string> => oneId((await db.execute<{ id: string }>(sql`
    insert into users default values returning id
  `)).rows);

  const createLedgerPackage = async (userId: string, grantIdempotencyKey: string): Promise<string> => oneId((await db.execute<{ id: string }>(sql`
    insert into message_packages (user_id, granted_messages, grant_idempotency_key)
    values (${userId}::uuid, 1, ${grantIdempotencyKey}) returning id
  `)).rows);

  return {
    db: db as DrizzleDb,
    async reset() {
      await db.execute(sql`
        truncate table reconciliation_mismatches, delivery_attempts, dead_letters, integration_outbox,
          integration_inbox, projection_checkpoints, provider_cursors, reconciliation_runs,
          privacy_processor_attempts, privacy_deletion_jobs, admin_approvals, audit_events,
          human_escalations, safety_incidents, prompt_versions, conversation_messages, conversations,
          feedback, notifications, reservations, message_ledger_entries, message_events,
          message_packages, slots, expert_services, experts, consents, client_profiles,
          channel_identities, users cascade
      `);
      primaryPackageId = undefined;
      primaryUserId = undefined;
    },
    async stop() {
      await pool.end();
      await container.stop();
    },
    createUser,
    createLedgerPackage,
    async seedUserAndPackage({ externalMessageId, grantedMessages }) {
      primaryUserId = await createUser();
      primaryPackageId = await createLedgerPackage(primaryUserId, `package-${externalMessageId}`);
      await db.execute(sql`
        insert into message_events (user_id, provider, external_message_id, direction)
        values (${primaryUserId}::uuid, 'test', ${externalMessageId}, 'outbound')
      `);
      await db.execute(sql`
        insert into message_ledger_entries (package_id, entry_kind, delta, idempotency_key)
        values (${primaryPackageId}::uuid, 'grant', ${grantedMessages}, ${`grant-${externalMessageId}`})
      `);
    },
    async insertDuplicateExternalMessage(externalMessageId) {
      if (primaryUserId === undefined) throw new Error("Call seedUserAndPackage first");
      await db.execute(sql`
        insert into message_events (user_id, provider, external_message_id, direction)
        values (${primaryUserId}::uuid, 'test', ${externalMessageId}, 'outbound')
      `);
    },
    async columnExists(table, column) {
      const result = await db.execute<{ exists: boolean }>(sql`
        select exists(
          select 1 from information_schema.columns
          where table_schema = 'public' and table_name = ${table} and column_name = ${column}
        ) as exists
      `);
      return result.rows[0]?.exists ?? false;
    },
    async packageBalance() {
      if (primaryPackageId === undefined) throw new Error("Call seedUserAndPackage first");
      const result = await db.execute<{ balance: number }>(sql`
        select balance from package_balances where package_id = ${primaryPackageId}::uuid
      `);
      return Number(result.rows[0]?.balance ?? 0);
    },
    async appendLedgerFact({ kind, delta, idempotencyKey }) {
      if (primaryPackageId === undefined) throw new Error("Call seedUserAndPackage first");
      const event = oneId((await db.execute<{ id: string }>(sql`
        insert into message_events (user_id, provider, external_message_id, direction)
        values (${primaryUserId!}::uuid, 'test', ${idempotencyKey}, 'outbound') returning id
      `)).rows);
      await db.execute(sql`
        insert into message_ledger_entries (package_id, entry_kind, delta, message_event_id, idempotency_key)
        values (${primaryPackageId}::uuid, ${kind}, ${delta}, ${event}::uuid, ${idempotencyKey})
      `);
    },
    async updateLedgerFact(idempotencyKey, delta) {
      await db.execute(sql`update message_ledger_entries set delta = ${delta} where idempotency_key = ${idempotencyKey}`);
    },
    async deleteLedgerFact(idempotencyKey) {
      await db.execute(sql`delete from message_ledger_entries where idempotency_key = ${idempotencyKey}`);
    },
    async appendGrantFact(packageId, delta, idempotencyKey) {
      return oneId((await db.execute<{ id: string }>(sql`
        insert into message_ledger_entries (package_id, entry_kind, delta, idempotency_key)
        values (${packageId}::uuid, 'grant', ${delta}, ${idempotencyKey}) returning id
      `)).rows);
    },
    async appendMessageDebit(packageId, externalMessageId, idempotencyKey) {
      const user = oneId((await db.execute<{ id: string }>(sql`
        select user_id as id from message_packages where id = ${packageId}::uuid
      `)).rows);
      const event = oneId((await db.execute<{ id: string }>(sql`
        insert into message_events (user_id, provider, external_message_id, direction)
        values (${user}::uuid, 'test', ${externalMessageId}, 'outbound') returning id
      `)).rows);
      return oneId((await db.execute<{ id: string }>(sql`
        insert into message_ledger_entries (package_id, entry_kind, delta, message_event_id, idempotency_key)
        values (${packageId}::uuid, 'debit', -1, ${event}::uuid, ${idempotencyKey}) returning id
      `)).rows);
    },
    async appendCompensation(packageId, originalEntryId, idempotencyKey) {
      await db.execute(sql`
        insert into message_ledger_entries (package_id, entry_kind, delta, original_entry_id, idempotency_key)
        values (${packageId}::uuid, 'compensation', 1, ${originalEntryId}::uuid, ${idempotencyKey})
      `);
    },
    async appendRevocation(packageId, originalEntryId, idempotencyKey) {
      await db.execute(sql`
        insert into message_ledger_entries (package_id, entry_kind, delta, original_entry_id, idempotency_key)
        values (${packageId}::uuid, 'revocation', -1, ${originalEntryId}::uuid, ${idempotencyKey})
      `);
    },
    async ledgerFactCount(packageIds) {
      const result = await db.execute<{ count: string }>(sql`
        select count(*)::text as count from message_ledger_entries
        where package_id = any(${packageIds}::uuid[])
      `);
      return Number(result.rows[0]?.count ?? 0);
    },
  };
}
