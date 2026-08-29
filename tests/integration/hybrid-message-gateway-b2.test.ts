import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createSelartiResponseService } from "../../packages/application/src/index.js";
import { selartiResponseRoutes } from "../../apps/api/src/routes/selarti-response.js";
import { createWindowedRateLimiter } from "../../apps/api/src/rate-limit.js";

const require = createRequire(
  new URL("../../apps/api/package.json", import.meta.url),
);
const Fastify =
  require("fastify") as typeof import("../../apps/api/node_modules/fastify/fastify.js").default;
import {
  PostgresHybridMessageRepository,
  PostgresOrderedTelegramOutboxRepository,
  PostgresB2SensitiveRetentionRepository,
  PostgresSelartiProposalRepository,
} from "../../packages/db/src/index.js";
import {
  startTestPostgres,
  type TestDatabase,
} from "../../packages/db/src/testkit/postgres.js";

describe("hybrid gateway B2 ordered local delivery", () => {
  let database: TestDatabase;
  let repository: PostgresHybridMessageRepository;
  let userId: string;

  beforeAll(async () => {
    database = await startTestPostgres();
    await database.migrate();
    repository = new PostgresHybridMessageRepository(database.db);
    userId = await database.createUser();
    await database.db.execute(sql`
      insert into channel_identities(user_id,provider,external_id,bot_key,external_chat_id,status)
      values(${userId}::uuid,'telegram','801','bot-b2','801','active')
    `);
    await database.db.execute(sql`
      insert into consents(user_id,consent_type,decision,policy_version,created_at)
      values
        (${userId}::uuid,'client_messaging','granted','client-msg-v1','2026-08-29T00:00:00Z'),
        (${userId}::uuid,'selarti_ai_processing','granted','selarti-v1','2026-08-29T00:00:01Z')
    `);
  }, 120_000);

  afterAll(async () => database.stop());

  it("atomically allocates sequence one and enqueues a bounded local reply without Selarti or billing", async () => {
    const text = "/help";
    const result = await repository.persist({
      updateId: 2_001n,
      payloadHash: createHash("sha256").update("b2-local-2001").digest("hex"),
      provider: "telegram",
      botKey: "bot-b2",
      externalUserId: "801",
      externalChatId: "801",
      text,
      route: "deterministic",
      routingEnabled: false,
      correlationId: "b2-local-2001",
      locale: "ru-RU",
      deadline: "2026-08-29T00:00:30.000Z",
      occurredAt: "2026-08-29T00:00:00.000Z",
      messagingConsentPolicyVersion: "client-msg-v1",
      localReplyText:
        "Я помогу с навигацией по сервису. Опишите ваш запрос одним сообщением.",
    });
    expect(result).toBe("claimed");
    const rows = await database.db.execute<{
      topic: string;
      sequence: string;
      payload: {
        botKey: string;
        chatId: string;
        text: string;
        sequence: number;
      };
      selarti: number;
      packages: number;
      events: number;
      ledger: number;
    }>(sql`
      select
        o.topic,
        o.dialogue_sequence::text sequence,
        o.payload,
        (select count(*)::int from integration_outbox where topic='selarti.request.v1') selarti,
        (select count(*)::int from message_packages) packages,
        (select count(*)::int from message_events) events,
        (select count(*)::int from message_ledger_entries) ledger
      from integration_outbox o
      where o.correlation_id='b2-local-2001'
    `);
    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0]).toMatchObject({
      topic: "telegram.send_text.v1",
      sequence: "1",
      payload: {
        botKey: "bot-b2",
        chatId: "801",
        sequence: 1,
      },
      selarti: 0,
      packages: 0,
      events: 0,
      ledger: 0,
    });
    expect(rows.rows[0]?.payload.text.length).toBeLessThanOrEqual(512);
  });

  it("converges one accepted Selarti proposal on sequence two in the original bot and chat", async () => {
    const text = "Мне нужен специалист для сложного запроса";
    expect(
      await repository.persist({
        updateId: 2_002n,
        payloadHash: createHash("sha256")
          .update("b2-selarti-2002")
          .digest("hex"),
        provider: "telegram",
        botKey: "bot-b2",
        externalUserId: "801",
        externalChatId: "801",
        text,
        route: "complex_dialogue",
        routingEnabled: true,
        correlationId: "b2-selarti-2002",
        locale: "ru-RU",
        deadline: "2026-08-29T00:00:30.000Z",
        occurredAt: "2026-08-29T00:00:00.000Z",
        messagingConsentPolicyVersion: "client-msg-v1",
        selartiConsentPolicyVersion: "selarti-v1",
      }),
    ).toBe("claimed");
    const request = (
      await database.db.execute<{
        requestId: string;
        dialogueId: string;
      }>(sql`
        select idempotency_key "requestId",payload->>'dialogueId' "dialogueId"
        from integration_outbox
        where topic='selarti.request.v1' and correlation_id='b2-selarti-2002'
      `)
    ).rows[0]!;
    const proposals = new PostgresSelartiProposalRepository(database.db);
    const command = {
      requestId: request.requestId,
      dialogueId: request.dialogueId,
      threadId: request.requestId,
      tenantKey: "bot-b2",
      text: "Подходящий специалист найден. Продолжим уточнение запроса.",
      responsePayloadHash: createHash("sha256")
        .update("accepted-response-2002")
        .digest("hex"),
      receivedAt: "2026-08-29T00:00:10.000Z",
    };
    const outcomes = await Promise.all(
      Array.from({ length: 4 }, () => proposals.accept(command)),
    );
    expect(outcomes.filter((result) => result === "accepted")).toHaveLength(1);
    expect(outcomes.filter((result) => result === "duplicate")).toHaveLength(3);
    await expect(
      proposals.accept({
        ...command,
        receivedAt: "2026-08-29T00:01:00.000Z",
      }),
    ).resolves.toBe("duplicate");
    await expect(
      proposals.accept({
        ...command,
        responsePayloadHash: createHash("sha256")
          .update("poison-response-2002")
          .digest("hex"),
        receivedAt: "2026-08-29T00:01:00.000Z",
      }),
    ).resolves.toBe("conflict");
    const rows = await database.db.execute<{
      sequences: string[];
      proposalCount: number;
      botKey: string;
      chatId: string;
      topic: string;
    }>(sql`
      select
        array_agg(o.dialogue_sequence::text order by o.dialogue_sequence) sequences,
        (select count(*)::int from selarti_response_proposals where request_id=${request.requestId}) "proposalCount",
        max(o.payload->>'botKey') "botKey",
        max(o.payload->>'chatId') "chatId",
        max(o.topic) topic
      from integration_outbox o
      where o.topic='telegram.send_text.v1'
    `);
    expect(rows.rows[0]).toEqual({
      sequences: ["1", "2"],
      proposalCount: 1,
      botKey: "bot-b2",
      chatId: "801",
      topic: "telegram.send_text.v1",
    });
  });

  it("rejects mismatched and late proposals before proposal or delivery effects", async () => {
    expect(
      await repository.persist({
        updateId: 2_003n,
        payloadHash: createHash("sha256")
          .update("b2-selarti-2003")
          .digest("hex"),
        provider: "telegram",
        botKey: "bot-b2",
        externalUserId: "801",
        externalChatId: "801",
        text: "Ещё один сложный запрос",
        route: "complex_dialogue",
        routingEnabled: true,
        correlationId: "b2-selarti-2003",
        locale: "ru-RU",
        deadline: "2026-08-29T00:00:30.000Z",
        occurredAt: "2026-08-29T00:00:00.000Z",
        messagingConsentPolicyVersion: "client-msg-v1",
        selartiConsentPolicyVersion: "selarti-v1",
      }),
    ).toBe("claimed");
    const request = (
      await database.db.execute<{ requestId: string; dialogueId: string }>(sql`
        select idempotency_key "requestId",payload->>'dialogueId' "dialogueId"
        from integration_outbox
        where topic='selarti.request.v1' and correlation_id='b2-selarti-2003'
      `)
    ).rows[0]!;
    const proposals = new PostgresSelartiProposalRepository(database.db);
    const base = {
      requestId: request.requestId,
      dialogueId: "00000000-0000-4000-8000-000000000999",
      threadId: request.requestId,
      tenantKey: "bot-b2",
      text: "Ответ",
      responsePayloadHash: createHash("sha256").update("reject").digest("hex"),
      receivedAt: "2026-08-29T00:00:31.000Z",
    };
    await expect(proposals.accept(base)).resolves.toBe("rejected");
    await expect(
      proposals.accept({ ...base, dialogueId: request.dialogueId }),
    ).resolves.toBe("late");
    const effects = await database.db.execute<{ count: number }>(sql`
      select
        (select count(*)::int from selarti_response_proposals where request_id=${request.requestId}) +
        (select count(*)::int from integration_outbox where topic='telegram.send_text.v1' and correlation_id=${request.requestId}) count
    `);
    expect(effects.rows[0]?.count).toBe(0);
  });

  it("holds later dialogue sequence behind retry and unknown outcome until reconciliation", async () => {
    const ordered = new PostgresOrderedTelegramOutboxRepository(database.db);
    const first = await ordered.claim(10, "b2-worker", 60_000, 5);
    expect(
      first.map(
        (message) => (message.payload as { sequence: number }).sequence,
      ),
    ).toEqual([1]);
    await ordered.succeed(
      first[0]!.id,
      "b2-worker",
      first[0]!.dispatchClaimToken!,
    );
    const second = await ordered.claim(10, "b2-worker", 60_000, 5);
    expect((second[0]!.payload as { sequence: number }).sequence).toBe(2);
    await repository.persist({
      updateId: 2_004n,
      payloadHash: createHash("sha256").update("b2-local-2004").digest("hex"),
      provider: "telegram",
      botKey: "bot-b2",
      externalUserId: "801",
      externalChatId: "801",
      text: "/help",
      route: "deterministic",
      routingEnabled: false,
      correlationId: "b2-local-2004",
      locale: "ru-RU",
      deadline: "2026-08-29T00:00:30.000Z",
      occurredAt: "2026-08-29T00:00:00.000Z",
      messagingConsentPolicyVersion: "client-msg-v1",
      localReplyText: "Локальный ответ",
    });
    await ordered.recordAttemptStarted(
      second[0]!.id,
      "b2-worker",
      second[0]!.dispatchClaimToken!,
      "attempt-2",
      second[0]!.reconciliationKey,
      new Date(),
    );
    await ordered.markUnknownOutcome(
      second[0]!.id,
      "b2-worker",
      second[0]!.dispatchClaimToken!,
      "attempt-2",
      second[0]!.reconciliationKey,
      "timeout",
    );
    await expect(ordered.claim(10, "b2-worker", 60_000, 5)).resolves.toEqual(
      [],
    );
    const unknown = await ordered.claimUnknown(1, "b2-reconciler", 60_000, 5);
    expect(unknown).toHaveLength(1);
    await ordered.succeedAfterReconciliation(
      unknown[0]!.id,
      "b2-reconciler",
      unknown[0]!.reconciliationClaimToken!,
    );
    const third = await ordered.claim(10, "b2-worker", 60_000, 5);
    expect((third[0]!.payload as { sequence: number }).sequence).toBe(3);
    await ordered.succeed(
      third[0]!.id,
      "b2-worker",
      third[0]!.dispatchClaimToken!,
    );
  });

  it("physically purges expired inbound and redacts terminal payloads while preserving replay hashes", async () => {
    await database.db.execute(
      sql`update integration_outbox set status='succeeded' where topic in ('selarti.request.v1','telegram.send_text.v1')`,
    );
    const retention = new PostgresB2SensitiveRetentionRepository(database.db);
    const result = await retention.purgeExpired(
      new Date("2026-10-01T00:00:00Z"),
      100,
    );
    expect(result.inboundPurged).toBeGreaterThanOrEqual(4);
    expect(result.outboxRedacted).toBeGreaterThanOrEqual(1);
    expect(result.proposalsRedacted).toBe(1);
    const replay = await repository.persist({
      updateId: 2_001n,
      payloadHash: createHash("sha256").update("b2-local-2001").digest("hex"),
      provider: "telegram",
      botKey: "bot-b2",
      externalUserId: "801",
      externalChatId: "801",
      text: "/help",
      route: "deterministic",
      routingEnabled: false,
      correlationId: "b2-local-2001",
      locale: "ru-RU",
      deadline: "2026-08-29T00:00:30.000Z",
      occurredAt: "2026-08-29T00:00:00.000Z",
      messagingConsentPolicyVersion: "client-msg-v1",
    });
    expect(replay).toBe("duplicate");
    const durable = await database.db.execute<{
      tombstones: number;
      raw: number;
    }>(sql`
      select (select count(*)::int from dialogue_inbound_tombstones) tombstones,
        (select count(*)::int from integration_outbox where topic in ('selarti.request.v1','telegram.send_text.v1') and payload <> '{"redacted":true}'::jsonb) raw
    `);
    expect(durable.rows[0]).toEqual({ tombstones: expect.any(Number), raw: 0 });
    expect(durable.rows[0]!.tombstones).toBeGreaterThanOrEqual(4);
    const acceptedProposal = (
      await database.db.execute<{
        requestId: string;
        dialogueId: string;
        responsePayloadHash: string;
      }>(sql`
        select request_id "requestId",dialogue_id::text "dialogueId",
          response_payload_hash "responsePayloadHash"
        from selarti_response_proposals limit 1
      `)
    ).rows[0]!;
    await expect(
      new PostgresSelartiProposalRepository(database.db).accept({
        ...acceptedProposal,
        threadId: acceptedProposal.requestId,
        tenantKey: "bot-b2",
        text: "Подходящий специалист найден. Продолжим уточнение запроса.",
        receivedAt: "2026-10-01T00:00:00.000Z",
      }),
    ).resolves.toBe("duplicate");
  });

  it("converges authenticated HTTP proposal and maps transactional DB failure to retryable 503", async () => {
    const seedRequest = async (updateId: bigint, correlationId: string) => {
      await repository.persist({
        updateId,
        payloadHash: createHash("sha256").update(correlationId).digest("hex"),
        provider: "telegram",
        botKey: "bot-b2",
        externalUserId: "801",
        externalChatId: "801",
        text: "Сложный HTTP запрос",
        route: "complex_dialogue",
        routingEnabled: true,
        correlationId,
        locale: "ru-RU",
        deadline: "2026-10-01T00:01:00.000Z",
        occurredAt: "2026-10-01T00:00:00.000Z",
        messagingConsentPolicyVersion: "client-msg-v1",
        selartiConsentPolicyVersion: "selarti-v1",
      });
      return (
        await database.db.execute<{
          requestId: string;
          dialogueId: string;
        }>(sql`
        select idempotency_key "requestId",payload->>'dialogueId' "dialogueId"
        from integration_outbox where correlation_id=${correlationId} and topic='selarti.request.v1'
      `)
      ).rows[0]!;
    };
    const responses = createSelartiResponseService({
      enabled: true,
      tenantKey: "bot-b2",
      allowedUrlHosts: ["ii-tonya.ru"],
      clock: () => new Date("2026-10-01T00:00:10.000Z"),
      proposals: new PostgresSelartiProposalRepository(database.db),
    });
    const app = Fastify();
    await app.register(selartiResponseRoutes, {
      enabled: true,
      secret: "B2_HTTP_Shared_Secret_0123456789abcdef",
      responses,
      rateLimiter: createWindowedRateLimiter(),
    });
    const acceptedRequest = await seedRequest(2_005n, "b2-http-2005");
    await database.db.execute(
      sql`update integration_outbox set status='succeeded' where idempotency_key=${acceptedRequest.requestId}`,
    );
    await new PostgresB2SensitiveRetentionRepository(database.db).purgeExpired(
      new Date("2026-10-01T00:00:20.000Z"),
      100,
    );
    const retained = await database.db.execute<{
      requestId: string | null;
    }>(sql`
      select payload->>'requestId' "requestId" from integration_outbox
      where idempotency_key=${acceptedRequest.requestId}
    `);
    expect(retained.rows[0]?.requestId).toBe(acceptedRequest.requestId);
    const payload = {
      version: 1,
      requestId: acceptedRequest.requestId,
      dialogueId: acceptedRequest.dialogueId,
      threadId: acceptedRequest.requestId,
      text: "Безопасный ответ",
    };
    const accepted = await app.inject({
      method: "POST",
      url: "/v1/webhooks/selarti/responses",
      headers: {
        authorization: "Bearer B2_HTTP_Shared_Secret_0123456789abcdef",
      },
      payload,
    });
    expect(accepted.statusCode).toBe(200);
    const failedRequest = await seedRequest(2_006n, "b2-http-2006");
    await database.db.execute(
      sql`create function b2_fail_proposal() returns trigger language plpgsql as $$ begin raise exception 'forced b2 proposal failure'; end $$`,
    );
    await database.db.execute(
      sql`create trigger b2_fail_proposal_trigger before insert on selarti_response_proposals for each row execute function b2_fail_proposal()`,
    );
    const failed = await app.inject({
      method: "POST",
      url: "/v1/webhooks/selarti/responses",
      headers: {
        authorization: "Bearer B2_HTTP_Shared_Secret_0123456789abcdef",
      },
      payload: {
        ...payload,
        requestId: failedRequest.requestId,
        threadId: failedRequest.requestId,
        dialogueId: failedRequest.dialogueId,
      },
    });
    expect(failed.statusCode).toBe(503);
    await database.db.execute(
      sql`drop trigger b2_fail_proposal_trigger on selarti_response_proposals`,
    );
    await database.db.execute(sql`drop function b2_fail_proposal()`);
    const effects = await database.db.execute<{ count: number }>(
      sql`select (select count(*)::int from selarti_response_proposals where request_id=${failedRequest.requestId})+(select count(*)::int from integration_outbox where correlation_id=${failedRequest.requestId} and topic='telegram.send_text.v1') count`,
    );
    expect(effects.rows[0]?.count).toBe(0);
    await app.close();
  });
});
