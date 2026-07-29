import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
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

  it("charges same external message IDs independently across providers", async () => {
    const userId = await testDb.createUserWithPackage(2);
    const repo = new PostgresMessageRepository(testDb.db);
    await repo.acceptInbound({ provider: "selarti", externalEventId: "evt-provider-a", externalMessageId: "same-id", userId, messageClass: "ordinary_inbound", occurredAt: new Date(), correlationId: "corr-provider-a" });
    await repo.acceptInbound({ provider: "other", externalEventId: "evt-provider-b", externalMessageId: "same-id", userId, messageClass: "ordinary_inbound", occurredAt: new Date(), correlationId: "corr-provider-b" });
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
      repo.compensate({ originalDebitKey: "inbound:selarti:msg-rebuild", idempotencyKey: "comp-1" }),
      repo.compensate({ originalDebitKey: "inbound:selarti:msg-rebuild", idempotencyKey: "comp-1" }),
    ]);
    expect(await testDb.packageBalance(userId)).toBe(2);
    expect(await testDb.rebuildPackageBalance(userId)).toBe(2);
    expect(await testDb.mutableBalanceColumnCount()).toBe(0);
  });

  it("returns the stored event for an exact duplicate and rejects a mismatched replay", async () => {
    const userId = await testDb.createUserWithPackage(1);
    const repo = new PostgresMessageRepository(testDb.db);
    const first = await repo.acceptInbound({
      provider: "selarti", externalEventId: "evt-stored", externalMessageId: "msg-stored", userId,
      messageClass: "ordinary_inbound", occurredAt: new Date("2026-07-28T10:00:00.000Z"), correlationId: "corr-stored",
    });
    const duplicate = await repo.acceptInbound({
      provider: "selarti", externalEventId: "evt-stored", externalMessageId: "msg-stored", userId,
      messageClass: "ordinary_inbound", occurredAt: new Date("2026-07-28T10:00:00.000Z"), correlationId: "corr-stored",
    });
    if (first.kind !== "accepted") throw new Error("Expected first claim to be accepted");
    expect(duplicate).toEqual({ kind: "duplicate", messageEventId: first.messageEventId });
    await expect(repo.acceptInbound({
      provider: "selarti", externalEventId: "evt-stored", externalMessageId: "msg-replayed", userId,
      messageClass: "ordinary_inbound", occurredAt: new Date("2026-07-28T10:00:00.000Z"), correlationId: "corr-stored",
    })).rejects.toThrow("payload does not match");
  });

  it("debits only a newly delivered outbound message and writes audit plus outbox atomically", async () => {
    const userId = await testDb.createUserWithPackage(1);
    const repo = new PostgresMessageRepository(testDb.db);
    const outboxBefore = await testDb.db.execute<{ count: string }>(sql`
      select count(*)::text as count from integration_outbox
    `);
    const command = {
      provider: "selarti" as const, externalDeliveryEventId: "delivery-1", providerMessageId: "outbound-1",
      userId, deliveryStatus: "delivered" as const, occurredAt: new Date("2026-07-28T10:00:00.000Z"), correlationId: "corr-outbound",
    };
    const first = await repo.recordOutboundDelivery(command);
    const duplicate = await repo.recordOutboundDelivery(command);
    if (first.kind !== "accepted") throw new Error("Expected first delivery to be accepted");
    expect(first.kind).toBe("accepted");
    expect(duplicate).toEqual({ kind: "duplicate", messageEventId: first.messageEventId });
    expect(await testDb.packageBalance(userId)).toBe(0);
    const facts = await testDb.db.execute<{ audit: string; outbox: string }>(sql`
      select
        (select count(*)::text from audit_events where correlation_id = 'corr-outbound') as audit,
        (select count(*)::text from integration_outbox) as outbox
    `);
    expect(facts.rows[0]).toEqual({
      audit: "1",
      outbox: String(Number(outboxBefore.rows[0]?.count ?? "0") + 1),
    });
    expect(await testDb.outboxDeliveryForCorrelation("corr-outbound")).toMatchObject({
      topic: "message.accounted",
      correlationId: "corr-outbound",
      reconciliationKey: expect.stringMatching(/^message:/),
      payload: {
        messageEventId: first.messageEventId,
        provider: "selarti",
        direction: "outbound",
      },
    });
  });

  it.each(["system", "safety", "error"] as const)("records one package-less free fact for %s", async (messageClass) => {
    const userId = await testDb.createUser();
    const repo = new PostgresMessageRepository(testDb.db);
    const result = await repo.acceptInbound({
      provider: "selarti", externalEventId: `evt-${messageClass}`, externalMessageId: `msg-${messageClass}`,
      userId, messageClass, occurredAt: new Date("2026-07-28T10:00:00.000Z"), correlationId: `corr-${messageClass}`,
    });
    expect(result).toMatchObject({ kind: "accepted", packageId: null, ledgerBalance: 0 });
    const freeFacts = await testDb.db.execute<{ count: string }>(sql`
      select count(*)::text as count from message_ledger_entries where entry_kind = 'free' and package_id is null
    `);
    expect(Number(freeFacts.rows[0]?.count)).toBeGreaterThan(0);
  });

  it("accepts ordinary content without a package but records audit and outbox", async () => {
    const userId = await testDb.createUser();
    const result = await new PostgresMessageRepository(testDb.db).acceptInbound({
      provider: "selarti", externalEventId: "evt-no-package", externalMessageId: "msg-no-package", userId,
      messageClass: "ordinary_inbound", occurredAt: new Date("2026-07-28T10:00:00.000Z"), correlationId: "corr-no-package",
    });
    expect(result).toMatchObject({ kind: "accepted", packageId: null, ledgerBalance: 0 });
    const counts = await testDb.db.execute<{ audit: string; outbox: string }>(sql`
      select (select count(*)::text from audit_events where correlation_id = 'corr-no-package') as audit,
        (select count(*)::text from integration_outbox) as outbox
    `);
    expect(counts.rows[0]?.audit).toBe("1");
    expect(Number(counts.rows[0]?.outbox)).toBeGreaterThan(0);
  });

  it("uses paid, earliest expiry, grant time, then id as the package order", async () => {
    const userId = await testDb.createUser();
    const makePackage = async (key: string, kind: string, expiresAt: Date | null, grantedAt: Date) => {
      const packageRow = await testDb.db.execute<{ id: string }>(sql`
        insert into message_packages (user_id, granted_messages, grant_idempotency_key, kind, expires_at, granted_at)
        values (${userId}::uuid, 1, ${key}, ${kind}, ${expiresAt}, ${grantedAt}) returning id
      `);
      const id = packageRow.rows[0]?.id;
      if (id === undefined) throw new Error("Expected package");
      await testDb.db.execute(sql`
        insert into message_ledger_entries (package_id, entry_kind, delta, idempotency_key)
        values (${id}::uuid, 'grant', 1, ${`grant-${key}`})
      `);
      return id;
    };
    await makePackage("intro", "intro", new Date("2026-07-29T00:00:00.000Z"), new Date("2026-07-01T00:00:00.000Z"));
    const expected = await makePackage("paid-early", "paid", new Date("2026-07-30T00:00:00.000Z"), new Date("2026-07-02T00:00:00.000Z"));
    await makePackage("paid-null", "paid", null, new Date("2026-07-01T00:00:00.000Z"));
    const result = await new PostgresMessageRepository(testDb.db).acceptInbound({
      provider: "selarti", externalEventId: "evt-order", externalMessageId: "msg-order", userId,
      messageClass: "ordinary_inbound", occurredAt: new Date("2026-07-28T10:00:00.000Z"), correlationId: "corr-order",
    });
    expect(result).toMatchObject({ kind: "accepted", packageId: expected });
  });

  it("rolls back inbox, audit, and outbox when message-event uniqueness rejects a new provider event", async () => {
    const userId = await testDb.createUserWithPackage(2);
    const repo = new PostgresMessageRepository(testDb.db);
    await repo.acceptInbound({
      provider: "selarti", externalEventId: "evt-atomic-a", externalMessageId: "msg-atomic", userId,
      messageClass: "ordinary_inbound", occurredAt: new Date("2026-07-28T10:00:00.000Z"), correlationId: "corr-atomic-a",
    });
    const before = await testDb.db.execute<{ outbox: string }>(sql`select count(*)::text as outbox from integration_outbox`);
    await expect(repo.acceptInbound({
      provider: "selarti", externalEventId: "evt-atomic-b", externalMessageId: "msg-atomic", userId,
      messageClass: "ordinary_inbound", occurredAt: new Date("2026-07-28T10:00:00.000Z"), correlationId: "corr-atomic-b",
    })).rejects.toThrow();
    const rows = await testDb.db.execute<{ inbox: string; audit: string; outbox: string }>(sql`
      select (select count(*)::text from integration_inbox where external_event_id = 'evt-atomic-b') as inbox,
        (select count(*)::text from audit_events where correlation_id = 'corr-atomic-b') as audit,
        (select count(*)::text from integration_outbox) as outbox
    `);
    expect(rows.rows[0]).toMatchObject({ inbox: "0", audit: "0", outbox: before.rows[0]?.outbox });
  });

  it("distinguishes compensation replay from original and idempotency-key conflicts", async () => {
    const userId = await testDb.createUserWithPackage(2);
    const repo = new PostgresMessageRepository(testDb.db);
    await repo.acceptInbound({ provider: "selarti", externalEventId: "evt-comp-a", externalMessageId: "msg-comp-a", userId, messageClass: "ordinary_inbound", occurredAt: new Date(), correlationId: "corr-comp-a" });
    await repo.acceptInbound({ provider: "selarti", externalEventId: "evt-comp-b", externalMessageId: "msg-comp-b", userId, messageClass: "ordinary_inbound", occurredAt: new Date(), correlationId: "corr-comp-b" });
    await repo.compensate({ originalDebitKey: "inbound:selarti:msg-comp-a", idempotencyKey: "comp-key" });
    await expect(repo.compensate({ originalDebitKey: "inbound:selarti:msg-comp-a", idempotencyKey: "other-key" })).rejects.toThrow("already compensated");
    await expect(repo.compensate({ originalDebitKey: "inbound:selarti:msg-comp-b", idempotencyKey: "comp-key" })).rejects.toThrow("Compensation key belongs to another debit");
    const raced = await Promise.allSettled([
      repo.compensate({ originalDebitKey: "inbound:selarti:msg-comp-b", idempotencyKey: "comp-key" }),
      repo.compensate({ originalDebitKey: "inbound:selarti:msg-comp-b", idempotencyKey: "other-key-b" }),
    ]);
    expect(raced.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(raced.filter((result) => result.status === "rejected")).toHaveLength(1);
  });
});
