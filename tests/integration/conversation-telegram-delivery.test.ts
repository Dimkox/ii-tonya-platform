import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  CONVERSATION_CATALOG_ACKNOWLEDGEMENT,
  PostgresMessageRepository,
} from "../../packages/db/src/index.js";
import { seedClientConsent } from "../../packages/db/src/testkit/client-consent.js";
import {
  startTestPostgres,
  type TestDatabase,
} from "../../packages/db/src/testkit/postgres.js";

let testDb: TestDatabase;
let chat = 7000;

beforeAll(async () => {
  testDb = await startTestPostgres();
  await testDb.migrate();
}, 120_000);
beforeEach(async () => testDb.reset());
afterAll(async () => testDb?.stop(), 60_000);

const delivery = {
  botKey: "client-bot",
  messagingPolicyVersion: "client-messaging-v1",
};

async function boundClient(options: { consent?: boolean } = {}) {
  const userId = await testDb.createUserWithPackage(1);
  const chatId = String(++chat);
  await testDb.db.execute(sql`
    insert into channel_identities(user_id,provider,external_id,bot_key,external_chat_id,status)
    values(${userId}::uuid,'telegram',${chatId},${delivery.botKey},${chatId},'active')
  `);
  await testDb.db.execute(sql`
    insert into dialogues(tenant_key,user_id,provider,bot_key,external_chat_id)
    values('tenant-1',${userId}::uuid,'telegram',${delivery.botKey},${chatId})
  `);
  if (options.consent !== false)
    await seedClientConsent(testDb.db, userId, "client_messaging");
  return { userId, chatId };
}

const inbound = (userId: string, suffix: string) => ({
  provider: "selarti",
  externalEventId: `delivery-event-${suffix}`,
  externalMessageId: `delivery-message-${suffix}`,
  userId,
  messageClass: "ordinary_inbound" as const,
  occurredAt: new Date("2026-07-28T10:00:00.000Z"),
  correlationId: `delivery-correlation-${suffix}`,
});

async function outbox(userId: string) {
  return (
    await testDb.db.execute<{
      topic: string;
      status: string;
      payload: Record<string, unknown>;
      dialogueSequence: string | null;
      source: string | null;
    }>(sql`
      select o.topic,o.status::text as status,o.payload,
        o.dialogue_sequence as "dialogueSequence",dd.source
      from integration_outbox o
      left join dialogue_deliveries dd on dd.outbox_id=o.id
      where o.correlation_id like 'delivery-correlation-%'
        and (o.payload->>'chatId' is null or o.dialogue_id in
          (select id from dialogues where user_id=${userId}::uuid))
      order by o.created_at,o.topic
    `)
  ).rows;
}

describe("conversation telegram delivery", () => {
  it("delivers an answer as a dialogue-bound telegram.send_text.v1 and closes the completion record", async () => {
    const { userId, chatId } = await boundClient();
    const repository = new PostgresMessageRepository(testDb.db, {
      telegramDelivery: delivery,
    });
    const command = inbound(userId, "answer");
    const prepared = await repository.prepareInbound(command);
    const completed = await repository.completeInbound({
      messageEventId: prepared.messageEventId,
      userId,
      correlationId: command.correlationId,
      outcome: {
        kind: "answer",
        topic: "selarti.send",
        payload: { text: "Привет!\nКак дела?" },
      },
    });
    expect(completed).toMatchObject({
      kind: "completed",
      result: { kind: "answer_queued", chargedMessages: 1 },
    });
    const rows = await outbox(userId);
    const send = rows.find((row) => row.topic === "telegram.send_text.v1")!;
    expect(send).toMatchObject({
      status: "pending",
      dialogueSequence: "1",
      source: "selarti",
      payload: expect.objectContaining({
        botKey: delivery.botKey,
        chatId,
        text: "Привет! Как дела?",
        sequence: 1,
      }),
    });
    expect(Object.keys(send.payload).sort()).toEqual([
      "botKey",
      "chatId",
      "consentAuthority",
      "deliveryId",
      "dialogueId",
      "sequence",
      "text",
    ]);
    expect(rows.find((row) => row.topic === "selarti.send")?.status).toBe(
      "succeeded",
    );
    const replay = await repository.completeInbound({
      messageEventId: prepared.messageEventId,
      userId,
      correlationId: command.correlationId,
      outcome: {
        kind: "answer",
        topic: "selarti.send",
        payload: { text: "x" },
      },
    });
    expect(replay.kind).toBe("duplicate");
    expect(
      (await outbox(userId)).filter((r) => r.topic === "telegram.send_text.v1"),
    ).toHaveLength(1);
  });

  it("turns show_catalog into a versioned catalogRequestId plus an acknowledgement", async () => {
    const { userId } = await boundClient();
    const repository = new PostgresMessageRepository(testDb.db, {
      telegramDelivery: delivery,
    });
    const command = inbound(userId, "catalog");
    const prepared = await repository.prepareInbound(command);
    const completed = await repository.completeInbound({
      messageEventId: prepared.messageEventId,
      userId,
      correlationId: command.correlationId,
      outcome: {
        kind: "show_catalog",
        topic: "catalog.show",
        payload: { allowedServiceCodes: ["consult"] },
      },
    });
    expect(completed).toMatchObject({
      result: { kind: "catalog_requested" },
    });
    const request = (
      await testDb.db.execute<{ id: string }>(
        sql`select id from client_catalog_requests where user_id=${userId}::uuid`,
      )
    ).rows;
    expect(request).toHaveLength(1);
    const catalog = (
      await testDb.db.execute<{ payload: unknown; status: string }>(sql`
        select payload,status::text as status from integration_outbox
        where topic='catalog.show' and idempotency_key like 'client-catalog:%'
      `)
    ).rows;
    expect(catalog).toEqual([
      {
        payload: { v: 1, catalogRequestId: request[0]!.id },
        status: "pending",
      },
    ]);
    const legacy = (
      await testDb.db.execute<{ status: string }>(sql`
        select status::text as status from integration_outbox
        where idempotency_key=${`conversation:${prepared.messageEventId}`}
      `)
    ).rows;
    expect(legacy).toEqual([{ status: "succeeded" }]);
    const send = (await outbox(userId)).find(
      (row) => row.topic === "telegram.send_text.v1",
    );
    expect(send).toMatchObject({
      source: "deterministic",
      payload: expect.objectContaining({
        text: CONVERSATION_CATALOG_ACKNOWLEDGEMENT,
      }),
    });
  });

  it("rolls back without charging when there is no consented dialogue", async () => {
    const { userId } = await boundClient({ consent: false });
    const repository = new PostgresMessageRepository(testDb.db, {
      telegramDelivery: delivery,
    });
    const command = inbound(userId, "no-consent");
    const prepared = await repository.prepareInbound(command);
    await expect(
      repository.completeInbound({
        messageEventId: prepared.messageEventId,
        userId,
        correlationId: command.correlationId,
        outcome: {
          kind: "answer",
          topic: "selarti.send",
          payload: { text: "hi" },
        },
      }),
    ).rejects.toThrow("conversation_delivery_unavailable");
    expect(await testDb.packageBalance(userId)).toBe(1);
    expect(await testDb.ledgerEntryCount(command.externalMessageId)).toBe(0);
    const rows = await testDb.db.execute(
      sql`select 1 from integration_outbox where correlation_id=${command.correlationId}`,
    );
    expect(rows.rows).toHaveLength(0);
  });
});
