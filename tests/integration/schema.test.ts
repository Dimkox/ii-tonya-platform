import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import {
  startTestPostgres,
  type TestDatabase,
} from "../../packages/db/src/testkit/postgres.js";

let testDb: TestDatabase | undefined;

beforeAll(async () => {
  testDb = await startTestPostgres();
  await migrate(testDb.db, { migrationsFolder: "packages/db/migrations" });
});

afterAll(async () => testDb?.stop());

describe("MVP schema", () => {
  it("creates the authoritative MVP and operational-support tables", async () => {
    const rows = await testDb!.db.execute<{ table_name: string }>(sql`
      select table_name from information_schema.tables
      where table_schema = 'public' order by table_name
    `);
    const names = rows.rows.map((row) => row.table_name);
    expect(names).toEqual(expect.arrayContaining([
      "audit_events", "channel_identities", "client_profiles", "consents",
      "experts", "expert_services", "feedback", "integration_inbox",
      "integration_outbox", "message_events", "message_ledger_entries",
      "message_packages", "notifications", "reservations", "slots", "users",
      "conversations", "conversation_messages", "prompt_versions",
      "safety_incidents", "human_escalations", "delivery_attempts",
      "dead_letters", "provider_cursors", "reconciliation_runs",
      "reconciliation_mismatches", "projection_checkpoints",
      "admin_approvals", "privacy_deletion_jobs", "privacy_processor_attempts",
    ]));
    expect(names).not.toEqual(expect.arrayContaining([
      "coupons", "payments", "referrals", "reminders", "reschedules", "waitlist",
    ]));
  });

  it("uses an append-only ledger-derived balance with no mutable remainder column", async () => {
    await testDb!.seedUserAndPackage({ externalMessageId: "m-1", grantedMessages: 2 });
    await expect(testDb!.insertDuplicateExternalMessage("m-1")).rejects.toThrow();
    expect(await testDb!.columnExists("message_packages", "remaining_messages")).toBe(false);
    expect(await testDb!.packageBalance()).toBe(2);
    await testDb!.appendLedgerFact({ kind: "debit", delta: -1, idempotencyKey: "debit-1" });
    expect(await testDb!.packageBalance()).toBe(1);
    await expect(testDb!.updateLedgerFact("debit-1", 0)).rejects.toThrow("append-only");
    await expect(testDb!.deleteLedgerFact("debit-1")).rejects.toThrow("append-only");
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
    await expect(testDb!.appendGrantFact(packageA1, 500, "ledger-grant-a1-again"))
      .rejects.toThrow("message_ledger_grant_once_per_package");

    const debitA = await testDb!.appendMessageDebit(packageA1, "message-a", "debit-a");
    const debitB = await testDb!.appendMessageDebit(packageB1, "message-b", "debit-b");
    await testDb!.appendCompensation(packageA1, debitA, "comp-a");
    await testDb!.appendCompensation(packageB1, debitB, "comp-b");
    await expect(testDb!.appendCompensation(packageA1, debitA, "comp-a-again"))
      .rejects.toThrow("message_ledger_compensation_once_per_original");

    await testDb!.appendRevocation(packageA1, grantA1, "revoke-a1");
    await testDb!.appendRevocation(packageB1, grantB1, "revoke-b1");
    await expect(testDb!.appendRevocation(packageA1, grantA1, "revoke-a1-again"))
      .rejects.toThrow("message_ledger_revocation_once_per_package_grant");
    expect(await testDb!.ledgerFactCount([packageA1, packageA2, packageB1])).toBe(9);
  });
});
