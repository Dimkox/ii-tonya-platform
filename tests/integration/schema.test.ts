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
});
