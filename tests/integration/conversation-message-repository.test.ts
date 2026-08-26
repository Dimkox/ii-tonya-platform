import { sql } from "drizzle-orm";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import type { ConversationMessageRepository } from "../../packages/application/src/ports.js";
import {
  InboxPayloadMismatchError,
  PostgresMessageRepository,
} from "../../packages/db/src/index.js";
import {
  startTestPostgres,
  type TestDatabase,
} from "../../packages/db/src/testkit/postgres.js";

let testDb: TestDatabase;

beforeAll(async () => {
  testDb = await startTestPostgres();
  await testDb.migrate();
}, 120_000);

beforeEach(async () => testDb.reset());
afterAll(async () => testDb?.stop(), 60_000);

const inbound = (userId: string, suffix: string) => ({
  provider: "selarti",
  externalEventId: `conversation-event-${suffix}`,
  externalMessageId: `conversation-message-${suffix}`,
  userId,
  messageClass: "ordinary_inbound" as const,
  occurredAt: new Date("2026-07-28T10:00:00.000Z"),
  correlationId: `conversation-correlation-${suffix}`,
});

const answer = (text: string) => ({
  kind: "answer" as const,
  topic: "selarti.send" as const,
  payload: { text },
});

describe("conversation message repository", () => {
  it("prepares without debit, resumes pending, completes once, and replays the committed outcome", async () => {
    const userId = await testDb.createUserWithPackage(1);
    const repository = new PostgresMessageRepository(testDb.db);
    const compatible: ConversationMessageRepository = repository;
    expect(compatible).toBe(repository);
    const command = inbound(userId, "resume");

    const prepared = await repository.prepareInbound(command);
    const resumed = await repository.prepareInbound(command);

    expect(prepared).toMatchObject({ kind: "pending", packageAvailable: true });
    expect(resumed).toEqual(prepared);
    expect(await testDb.packageBalance(userId)).toBe(1);
    expect(await testDb.ledgerEntryCount(command.externalMessageId)).toBe(0);

    const completed = await repository.completeInbound({
      messageEventId: prepared.messageEventId,
      userId,
      correlationId: command.correlationId,
      outcome: answer("first"),
    });
    const replay = await repository.completeInbound({
      messageEventId: prepared.messageEventId,
      userId,
      correlationId: "ignored-on-authoritative-replay",
      outcome: {
        kind: "start_booking",
        payload: { choiceHandle: `ch1.${"A".repeat(43)}` },
      },
    });

    expect(completed).toMatchObject({
      kind: "completed",
      packageId: expect.any(String),
      ledgerBalance: 0,
      result: { kind: "answer_queued", chargedMessages: 1 },
    });
    expect(replay).toEqual({
      kind: "duplicate",
      messageEventId: prepared.messageEventId,
    });
    expect(await testDb.ledgerEntryCount(command.externalMessageId)).toBe(1);
    const facts = await testDb.db.execute<{
      audit: string;
      outbox: string;
    }>(sql`
      select
        (select count(*)::text from audit_events
          where correlation_id = ${command.correlationId}) as audit,
        (select count(*)::text from integration_outbox
          where reconciliation_key = ${`conversation:${prepared.messageEventId}`}) as outbox
    `);
    expect(facts.rows[0]).toEqual({ audit: "1", outbox: "1" });
  });

  it("poisons a provider-event replay whose payload differs", async () => {
    const userId = await testDb.createUserWithPackage(1);
    const repository = new PostgresMessageRepository(testDb.db);
    const command = inbound(userId, "mismatch");
    await repository.prepareInbound(command);

    await expect(
      repository.prepareInbound({
        ...command,
        externalMessageId: "mismatched-message",
      }),
    ).rejects.toBeInstanceOf(InboxPayloadMismatchError);
  });

  it("rolls completion writes back and leaves the durable claim resumable", async () => {
    const userId = await testDb.createUserWithPackage(1);
    const failBeforeCommit = vi.fn(async () => {
      throw new Error("completion write failed");
    });
    const repository = new PostgresMessageRepository(testDb.db, {
      beforeCompleteCommit: failBeforeCommit,
    });
    const command = inbound(userId, "rollback");
    const prepared = await repository.prepareInbound(command);

    await expect(
      repository.completeInbound({
        messageEventId: prepared.messageEventId,
        userId,
        correlationId: command.correlationId,
        outcome: answer("rollback"),
      }),
    ).rejects.toThrow("completion write failed");

    expect(await testDb.packageBalance(userId)).toBe(1);
    expect(await testDb.ledgerEntryCount(command.externalMessageId)).toBe(0);
    await expect(
      new PostgresMessageRepository(testDb.db).prepareInbound(command),
    ).resolves.toEqual(prepared);
    const counts = await testDb.db.execute<{
      audit: string;
      outbox: string;
    }>(sql`
      select
        (select count(*)::text from audit_events
          where correlation_id = ${command.correlationId}) as audit,
        (select count(*)::text from integration_outbox
          where reconciliation_key = ${`conversation:${prepared.messageEventId}`}) as outbox
    `);
    expect(counts.rows[0]).toEqual({ audit: "0", outbox: "0" });
  });

  it("authoritatively gives one of two concurrent messages the last credit", async () => {
    const userId = await testDb.createUserWithPackage(1);
    const repository = new PostgresMessageRepository(testDb.db);
    const firstCommand = inbound(userId, "last-credit-a");
    const secondCommand = inbound(userId, "last-credit-b");
    const [first, second] = await Promise.all([
      repository.prepareInbound(firstCommand),
      repository.prepareInbound(secondCommand),
    ]);
    if (first.kind !== "pending" || second.kind !== "pending") {
      throw new Error("Expected two pending inbound messages");
    }
    expect([first.packageAvailable, second.packageAvailable]).toEqual([
      true,
      true,
    ]);

    const completed = await Promise.all([
      repository.completeInbound({
        messageEventId: first.messageEventId,
        userId,
        correlationId: firstCommand.correlationId,
        outcome: answer("first"),
      }),
      repository.completeInbound({
        messageEventId: second.messageEventId,
        userId,
        correlationId: secondCommand.correlationId,
        outcome: answer("second"),
      }),
    ]);

    expect(
      completed
        .map((completion) =>
          completion.kind === "completed"
            ? completion.result.kind
            : "duplicate",
        )
        .sort(),
    ).toEqual(["answer_queued", "no_package"]);
    expect(await testDb.packageBalance(userId)).toBe(0);
    const facts = await testDb.db.execute<{
      debit: string;
      free: string;
    }>(sql`
      select
        count(*) filter (where entry_kind = 'debit')::text as debit,
        count(*) filter (where entry_kind = 'free')::text as free
      from message_ledger_entries
      where message_event_id in (
        ${first.messageEventId}::uuid,
        ${second.messageEventId}::uuid
      )
    `);
    expect(facts.rows[0]).toEqual({ debit: "1", free: "1" });
  });

  it("turns a stale paid decision into one atomic no-package completion", async () => {
    const userId = await testDb.createUser();
    const repository = new PostgresMessageRepository(testDb.db);
    const command = inbound(userId, "no-package");
    const prepared = await repository.prepareInbound(command);
    if (prepared.kind !== "pending")
      throw new Error("Expected pending inbound");
    expect(prepared.packageAvailable).toBe(false);

    const completed = await repository.completeInbound({
      messageEventId: prepared.messageEventId,
      userId,
      correlationId: command.correlationId,
      outcome: answer("must not be delivered"),
    });

    expect(completed).toMatchObject({
      kind: "completed",
      packageId: null,
      ledgerBalance: 0,
      result: { kind: "no_package", chargedMessages: 0 },
    });
    expect(
      await testDb.outboxDeliveryForCorrelation(command.correlationId),
    ).toMatchObject({ topic: "client.no_package" });
  });

  it("keeps a no-package proposal pending when a package is granted after prepare", async () => {
    const userId = await testDb.createUser();
    const repository = new PostgresMessageRepository(testDb.db);
    const command = inbound(userId, "concurrent-grant");
    const prepared = await repository.prepareInbound(command);
    if (prepared.kind !== "pending")
      throw new Error("Expected pending inbound");
    expect(prepared.packageAvailable).toBe(false);

    const packageId = await testDb.createLedgerPackage(
      userId,
      "post-prepare-package",
      1,
    );
    await testDb.appendGrantFact(packageId, 1, "post-prepare-grant");
    const retry = await repository.completeInbound({
      messageEventId: prepared.messageEventId,
      userId,
      correlationId: command.correlationId,
      outcome: {
        kind: "no_package",
        topic: "client.no_package",
        payload: {},
      },
    });

    expect(retry).toEqual({
      kind: "retry",
      messageEventId: prepared.messageEventId,
      packageAvailable: true,
    });
    expect(await testDb.ledgerEntryCount(command.externalMessageId)).toBe(0);
    expect(await testDb.outboxCountForCorrelation(command.correlationId)).toBe(
      0,
    );

    const completed = await repository.completeInbound({
      messageEventId: prepared.messageEventId,
      userId,
      correlationId: command.correlationId,
      outcome: answer("now paid"),
    });
    expect(completed).toMatchObject({
      kind: "completed",
      packageId: expect.any(String),
      ledgerBalance: 0,
      result: { kind: "answer_queued", chargedMessages: 1 },
    });
  });

  it("replays a committed completion after an unknown commit outcome", async () => {
    const userId = await testDb.createUserWithPackage(1);
    let failAcknowledgement = true;
    const repository = new PostgresMessageRepository(testDb.db, {
      afterCompleteCommit: async () => {
        if (!failAcknowledgement) return;
        failAcknowledgement = false;
        throw new Error("commit acknowledgement lost");
      },
    });
    const command = inbound(userId, "unknown-commit");
    const prepared = await repository.prepareInbound(command);

    await expect(
      repository.completeInbound({
        messageEventId: prepared.messageEventId,
        userId,
        correlationId: command.correlationId,
        outcome: answer("durable"),
      }),
    ).rejects.toThrow("commit acknowledgement lost");
    const replay = await repository.completeInbound({
      messageEventId: prepared.messageEventId,
      userId,
      correlationId: command.correlationId,
      outcome: answer("retry request"),
    });

    expect(replay).toEqual({
      kind: "duplicate",
      messageEventId: prepared.messageEventId,
    });
    expect(await testDb.ledgerEntryCount(command.externalMessageId)).toBe(1);
    const outbox = await testDb.db.execute<{ count: string }>(sql`
      select count(*)::text as count
      from integration_outbox
      where reconciliation_key = ${`conversation:${prepared.messageEventId}`}
    `);
    expect(outbox.rows[0]?.count).toBe("1");
  });

  it("persists human-handoff ownership in the same completion transaction", async () => {
    const userId = await testDb.createUserWithPackage(1);
    const ownerId = await testDb.createUser();
    const repository = new PostgresMessageRepository(testDb.db);
    const command = inbound(userId, "handoff");
    const prepared = await repository.prepareInbound(command);
    const openedAt = new Date("2026-07-28T10:01:00.000Z");
    const acknowledgeBy = new Date("2026-07-28T10:06:00.000Z");

    await repository.completeInbound({
      messageEventId: prepared.messageEventId,
      userId,
      correlationId: command.correlationId,
      outcome: {
        kind: "human_handoff",
        topic: "human_handoff.opened",
        payload: { reasonCode: "intent_unavailable" },
        ownerId,
        openedAt,
        acknowledgeBy,
      },
    });

    const handoff = await testDb.db.execute<{
      ownerId: string;
      openedAt: string;
      acknowledgeBy: string;
    }>(sql`
      select
        h.owner_id as "ownerId",
        h.opened_at as "openedAt",
        h.acknowledgement_deadline as "acknowledgeBy"
      from human_escalations h
      join safety_incidents i on i.id = h.incident_id
      where i.reason_code = 'intent_unavailable'
    `);
    const storedHandoff = handoff.rows[0];
    expect(storedHandoff?.ownerId).toBe(ownerId);
    expect(new Date(storedHandoff?.openedAt ?? "").toISOString()).toBe(
      openedAt.toISOString(),
    );
    expect(new Date(storedHandoff?.acknowledgeBy ?? "").toISOString()).toBe(
      acknowledgeBy.toISOString(),
    );
  });

  it.each([
    {
      name: "non-delivered",
      deliveryStatus: "failed" as const,
      charge: true,
    },
    {
      name: "billing-disabled",
      deliveryStatus: "delivered" as const,
      charge: false,
    },
  ])(
    "records and deduplicates a free $name outbound event",
    async ({ deliveryStatus, charge }) => {
      const userId = await testDb.createUserWithPackage(1);
      const repository = new PostgresMessageRepository(testDb.db);
      const command = {
        provider: "selarti" as const,
        externalDeliveryEventId: `delivery-${deliveryStatus}-${charge}`,
        providerMessageId: `outbound-${deliveryStatus}-${charge}`,
        userId,
        deliveryStatus,
        occurredAt: new Date("2026-07-28T10:00:00.000Z"),
        correlationId: `delivery-correlation-${deliveryStatus}-${charge}`,
        charge,
      };

      const first = await repository.recordOutboundDelivery(command);
      const duplicate = await repository.recordOutboundDelivery(command);

      expect(first).toMatchObject({
        kind: "accepted",
        packageId: null,
        ledgerBalance: 0,
      });
      expect(duplicate).toEqual({
        kind: "duplicate",
        messageEventId: first.messageEventId,
      });
      expect(await testDb.packageBalance(userId)).toBe(1);
      expect(await testDb.ledgerEntryCount(command.providerMessageId)).toBe(1);
    },
  );
});
