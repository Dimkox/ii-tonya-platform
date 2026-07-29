import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import {
  startTestPostgres,
  type TestDatabase,
} from "../../packages/db/src/testkit/postgres.js";

let testDb: TestDatabase | undefined;

type DatabaseErrorEvidence = {
  code?: unknown;
  constraint?: unknown;
  message?: unknown;
  cause?: unknown;
};

function databaseErrorChain(error: unknown): DatabaseErrorEvidence[] {
  const chain: DatabaseErrorEvidence[] = [];
  const seen = new Set<unknown>();
  let current = error;
  while (typeof current === "object" && current !== null && !seen.has(current)) {
    seen.add(current);
    const evidence = current as DatabaseErrorEvidence;
    chain.push(evidence);
    current = evidence.cause;
  }
  return chain;
}

async function applySqlMigration(
  db: TestDatabase["db"],
  path: string,
): Promise<void> {
  const statements = readFileSync(path, "utf8")
    .split("--> statement-breakpoint")
    .map((statement) => statement.trim())
    .filter((statement) => statement.length > 0);
  for (const statement of statements) {
    await db.execute(sql.raw(statement));
  }
}

async function applyLegacyBaseline(db: TestDatabase["db"]): Promise<void> {
  for (const path of [
    "packages/db/migrations/0000_mvp.sql",
    "packages/db/migrations/0001_message-package-metadata.sql",
    "packages/db/migrations/0002_atomic-message-accounting.sql",
  ]) {
    await applySqlMigration(db, path);
  }
}

async function seedLegacyReservation(
  db: TestDatabase["db"],
  slotCount: number,
): Promise<void> {
  await db.execute(sql.raw(`
    insert into users (id) values
      ('00000000-0000-4000-8000-000000000001'),
      ('00000000-0000-4000-8000-000000000002');
    insert into experts (id, user_id, active, verified) values (
      '00000000-0000-4000-8000-000000000003',
      '00000000-0000-4000-8000-000000000002',
      true,
      true
    );
    insert into expert_services (
      id, expert_id, name, active, duration_minutes
    ) values (
      '00000000-0000-4000-8000-000000000004',
      '00000000-0000-4000-8000-000000000003',
      'Legacy service',
      true,
      60
    );
    insert into slots (
      id, expert_service_id, provider, external_slot_id,
      starts_at, ends_at, capacity
    ) values (
      '00000000-0000-4000-8000-000000000005',
      '00000000-0000-4000-8000-000000000004',
      'legacy',
      'legacy-slot-1',
      '2026-08-02T10:00:00.000Z',
      '2026-08-02T11:00:00.000Z',
      1
    );
    ${slotCount === 2 ? `
    insert into slots (
      id, expert_service_id, provider, external_slot_id,
      starts_at, ends_at, capacity
    ) values (
      '00000000-0000-4000-8000-000000000006',
      '00000000-0000-4000-8000-000000000004',
      'legacy',
      'legacy-slot-2',
      '2026-08-03T10:00:00.000Z',
      '2026-08-03T11:00:00.000Z',
      1
    );` : ""}
    insert into reservations (
      id, user_id, expert_service_id, status, idempotency_key,
      reserved_until, version, created_at, updated_at
    ) values (
      '00000000-0000-4000-8000-000000000007',
      '00000000-0000-4000-8000-000000000001',
      '00000000-0000-4000-8000-000000000004',
      'reserved',
      'legacy-reservation',
      '2026-08-01T10:00:00.000Z',
      1,
      '2026-07-28T10:00:00.000Z',
      '2026-07-28T10:00:00.000Z'
    );
  `));
}

async function expectDatabaseError(
  operation: () => Promise<unknown>,
  expected: { code: string; constraint?: string },
): Promise<void> {
  let caught: unknown;
  try {
    await operation();
  } catch (error) {
    caught = error;
  }
  expect(caught, "database operation should fail").toBeDefined();
  const chain = databaseErrorChain(caught);
  expect(
    chain.some((error) =>
      error.code === expected.code
      && (expected.constraint === undefined || error.constraint === expected.constraint)),
    `expected SQLSTATE ${expected.code}${expected.constraint ? ` / ${expected.constraint}` : ""}`,
  ).toBe(true);
}

beforeAll(async () => {
  testDb = await startTestPostgres();
  await migrate(testDb.db, { migrationsFolder: "packages/db/migrations" });
}, 120_000);

afterAll(async () => testDb?.stop(), 60_000);

describe("MVP schema", () => {
  it("creates the authoritative MVP and operational-support tables", async () => {
    const rows = await testDb!.db.execute<{ table_name: string }>(sql`
      select table_name from information_schema.tables
      where table_schema = 'public' order by table_name
    `);
    const names = rows.rows.map((row) => row.table_name);
    expect(names).toEqual([
      "admin_approvals", "audit_events", "channel_identities", "client_profiles",
      "consents", "conversation_messages", "conversations", "dead_letters",
      "delivery_attempts", "expert_services", "experts", "feedback",
      "human_escalations", "integration_inbox", "integration_outbox",
      "message_events", "message_ledger_entries", "message_packages",
      "notifications", "package_balances", "privacy_deletion_jobs",
      "privacy_processor_attempts", "projection_checkpoints", "prompt_versions",
      "provider_cursors", "reconciliation_mismatches", "reconciliation_runs",
      "reservations", "safety_incidents", "slots", "users",
    ]);
  });

  it("uses an append-only ledger-derived balance with no mutable remainder column", async () => {
    await testDb!.seedUserAndPackage({ externalMessageId: "m-1", grantedMessages: 2 });
    expect(await testDb!.packageGrantedMessages()).toBe(2);
    await expect(testDb!.insertDuplicateExternalMessage("m-1")).rejects.toThrow();
    expect(await testDb!.columnExists("message_packages", "remaining_messages")).toBe(false);
    expect(await testDb!.packageBalance()).toBe(2);
    await testDb!.appendLedgerFact({ kind: "debit", delta: -1, idempotencyKey: "debit-1" });
    expect(await testDb!.packageBalance()).toBe(1);
    await expectDatabaseError(
      () => testDb!.updateLedgerFact("debit-1", 0),
      { code: "55000" },
    );
    await expectDatabaseError(
      () => testDb!.deleteLedgerFact("debit-1"),
      { code: "55000" },
    );
  });

  it("allows grants across clients/packages while rejecting only same-scope corrections", async () => {
    const clientA = await testDb!.createUser();
    const clientB = await testDb!.createUser();
    const packageA1 = await testDb!.createLedgerPackage(clientA, "grant-a1");
    const packageA2 = await testDb!.createLedgerPackage(clientA, "grant-a2");
    const packageB1 = await testDb!.createLedgerPackage(clientB, "grant-b1");

    const grantA1 = await testDb!.appendGrantFact(packageA1, 500, "ledger-grant-a1");
    const grantA2 = await testDb!.appendGrantFact(packageA2, 1000, "ledger-grant-a2");
    const grantB1 = await testDb!.appendGrantFact(packageB1, 500, "ledger-grant-b1");
    expect([grantA1, grantA2, grantB1]).toHaveLength(3);
    await expectDatabaseError(
      () => testDb!.appendGrantFact(packageA1, 500, "ledger-grant-a1-again"),
      { code: "23505", constraint: "message_ledger_grant_once_per_package" },
    );

    const debitA = await testDb!.appendMessageDebit(packageA1, "message-a", "debit-a");
    const debitB = await testDb!.appendMessageDebit(packageB1, "message-b", "debit-b");
    await testDb!.appendCompensation(packageA1, debitA, "comp-a");
    await testDb!.appendCompensation(packageB1, debitB, "comp-b");
    await expectDatabaseError(
      () => testDb!.appendCompensation(packageA1, debitA, "comp-a-again"),
      { code: "23505", constraint: "message_ledger_compensation_once_per_original" },
    );

    await testDb!.appendRevocation(packageA1, grantA1, "revoke-a1");
    await testDb!.appendRevocation(packageB1, grantB1, "revoke-b1");
    await expectDatabaseError(
      () => testDb!.appendRevocation(packageA1, grantA1, "revoke-a1-again"),
      { code: "23505", constraint: "message_ledger_revocation_once_per_package_grant" },
    );
    expect(await testDb!.ledgerFactCount([packageA1, packageA2, packageB1])).toBe(9);
  });

  it("upgrades an unambiguous legacy reservation through migration 0003", async () => {
    const legacyDb = await startTestPostgres();
    try {
      await applyLegacyBaseline(legacyDb.db);
      await seedLegacyReservation(legacyDb.db, 1);
      await applySqlMigration(
        legacyDb.db,
        "packages/db/migrations/0003_booking-concurrency.sql",
      );

      const result = await legacyDb.db.execute<{
        slotId: string | null;
        expertId: string | null;
        observedAt: Date | null;
      }>(sql`
        select
          r.slot_id as "slotId",
          r.expert_id as "expertId",
          s.observed_at as "observedAt"
        from reservations r
        join slots s on s.id = r.slot_id
        where r.id = '00000000-0000-4000-8000-000000000007'::uuid
      `);
      expect(result.rows[0]).toEqual({
        slotId: "00000000-0000-4000-8000-000000000005",
        expertId: "00000000-0000-4000-8000-000000000003",
        observedAt: null,
      });
      const columns = await legacyDb.db.execute<{
        columnName: string;
        isNullable: string;
      }>(sql`
        select column_name as "columnName", is_nullable as "isNullable"
        from information_schema.columns
        where table_schema = 'public'
          and table_name = 'reservations'
          and column_name in ('slot_id', 'expert_id')
        order by column_name
      `);
      expect(columns.rows).toEqual([
        { columnName: "expert_id", isNullable: "NO" },
        { columnName: "slot_id", isNullable: "NO" },
      ]);
      const constraints = await legacyDb.db.execute<{ constraintName: string }>(sql`
        select constraint_name as "constraintName"
        from information_schema.table_constraints
        where table_schema = 'public'
          and table_name = 'reservations'
          and constraint_name in (
            'reservations_slot_id_slots_id_fk',
            'reservations_expert_id_experts_id_fk'
          )
        order by constraint_name
      `);
      expect(constraints.rows.map((row) => row.constraintName)).toEqual([
        "reservations_expert_id_experts_id_fk",
        "reservations_slot_id_slots_id_fk",
      ]);
    } finally {
      await legacyDb.stop();
    }
  }, 120_000);

  it("fails an ambiguous legacy slot mapping with an actionable migration error", async () => {
    const legacyDb = await startTestPostgres();
    try {
      await applyLegacyBaseline(legacyDb.db);
      await seedLegacyReservation(legacyDb.db, 2);

      let caught: unknown;
      try {
        await applySqlMigration(
          legacyDb.db,
          "packages/db/migrations/0003_booking-concurrency.sql",
        );
      } catch (error) {
        caught = error;
      }
      const chain = databaseErrorChain(caught);
      expect(chain.some((error) =>
        error.code === "P0001"
        && String(error.message).includes("booking_slot_backfill_ambiguous")
      )).toBe(true);
    } finally {
      await legacyDb.stop();
    }
  }, 120_000);
});
