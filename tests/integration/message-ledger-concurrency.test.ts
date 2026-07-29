import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PostgresMessageRepository } from "../../packages/db/src/index.js";
import {
  startTestPostgres,
  type TestDatabase,
} from "../../packages/db/src/testkit/postgres.js";

let testDb: TestDatabase;

beforeAll(async () => {
  testDb = await startTestPostgres();
  await testDb.migrate();
}, 120_000);

afterAll(async () => testDb?.stop(), 60_000);

describe("message ledger transaction", () => {
  it("records a retried provider message and debit exactly once", async () => {
    const userId = await testDb.createUserWithPackage(3);
    const repo = new PostgresMessageRepository(testDb.db);
    const command = {
      provider: "selarti",
      externalEventId: "evt-1",
      externalMessageId: "msg-1",
      userId,
      messageClass: "ordinary_inbound" as const,
      occurredAt: new Date("2026-07-28T10:00:00.000Z"),
      correlationId: "corr-1",
    };
    const [first, retry] = await Promise.all([repo.acceptInbound(command), repo.acceptInbound(command)]);
    expect([first.kind, retry.kind].sort()).toEqual(["accepted", "duplicate"]);
    expect(await testDb.packageBalance(userId)).toBe(2);
    expect(await testDb.ledgerEntryCount("msg-1")).toBe(1);
  });

  it("never drives a one-message balance below zero under parallel messages", async () => {
    const userId = await testDb.createUserWithPackage(1);
    const repo = new PostgresMessageRepository(testDb.db);
    const results = await Promise.all(["a", "b"].map((suffix) => repo.acceptInbound({
      provider: "selarti",
      externalEventId: `evt-${suffix}`,
      externalMessageId: `msg-${suffix}`,
      userId,
      messageClass: "ordinary_inbound",
      occurredAt: new Date("2026-07-28T10:00:00.000Z"),
      correlationId: `corr-${suffix}`,
    })));
    expect(results.filter((result) => result.kind === "accepted" && result.packageId !== null)).toHaveLength(1);
    expect(await testDb.packageBalance(userId)).toBe(0);
  });

  it("rebuilds balance from facts and applies a compensation exactly once", async () => {
    const userId = await testDb.createUserWithPackage(2);
    const repo = new PostgresMessageRepository(testDb.db);
    await repo.acceptInbound({
      provider: "selarti",
      externalEventId: "evt-rebuild",
      externalMessageId: "msg-rebuild",
      userId,
      messageClass: "ordinary_inbound",
      occurredAt: new Date("2026-07-28T10:00:00.000Z"),
      correlationId: "corr-rebuild",
    });
    await Promise.all([
      repo.compensate({ originalDebitKey: "inbound:msg-rebuild", idempotencyKey: "comp-1" }),
      repo.compensate({ originalDebitKey: "inbound:msg-rebuild", idempotencyKey: "comp-1" }),
    ]);
    expect(await testDb.packageBalance(userId)).toBe(2);
    expect(await testDb.rebuildPackageBalance(userId)).toBe(2);
    expect(await testDb.mutableBalanceColumnCount()).toBe(0);
  });
});
