import { sql } from "drizzle-orm";
import Fastify from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { HybridMessageGateway } from "../../../../packages/application/src/hybrid-message-gateway.js";
import { PostgresHybridMessageRepository } from "../../../../packages/db/src/index.js";
import {
  startTestPostgres,
  type TestDatabase,
} from "../../../../packages/db/src/testkit/postgres.js";
import { telegramWebhookRoutes } from "./telegram-webhook.js";

describe("B1 dedicated Telegram HTTP to PostgreSQL path", () => {
  let database: TestDatabase;
  let app: ReturnType<typeof Fastify>;
  const secret = "Dedicated_B1_Webhook_Secret_123456";
  const botKey = "client-bot-a";

  beforeAll(async () => {
    database = await startTestPostgres();
    await database.migrate();
    const seed = async (
      externalId: string,
      status: "active" | "blocked",
      decision: "granted" | "denied",
    ) => {
      const userId = await database.createUser();
      await database.db.execute(sql`
        insert into channel_identities(user_id,provider,external_id,bot_key,external_chat_id,status)
        values(${userId}::uuid,'telegram',${externalId},${botKey},${externalId},${status})
      `);
      await database.db.execute(sql`
        insert into consents(user_id,consent_type,decision,policy_version,created_at)
        values
          (${userId}::uuid,'client_messaging',${decision},'client-msg-v1','2026-08-28T00:00:00Z'),
          (${userId}::uuid,'selarti_ai_processing',${decision},'selarti-v1','2026-08-28T00:00:01Z')
      `);
    };
    await seed("701", "active", "granted");
    await seed("702", "blocked", "granted");
    await seed("703", "active", "denied");
    await seed("704", "active", "granted");
    const repository = new PostgresHybridMessageRepository(database.db);
    const gateway = new HybridMessageGateway({
      enabled: true,
      botKey,
      routingEnabled: true,
      messagingConsentPolicyVersion: "client-msg-v1",
      selartiConsentPolicyVersion: "selarti-v1",
      clock: () => new Date("2026-08-29T00:00:00.000Z"),
      persist: (input) => repository.persist(input),
    });
    app = Fastify({ logger: false });
    await app.register(telegramWebhookRoutes, {
      secret,
      callbacks: {
        isAuthorizedIdentity: async () => false,
        verifyCallback: async () => false,
        process: async () => undefined,
      },
      inbox: {
        claim: async () => ({ kind: "claimed", claimId: "unused" }),
        complete: async () => undefined,
        fail: async () => undefined,
      },
      rateLimiter: { consume: () => true },
      clientIngressEnabled: true,
      clientHybridRoutingEnabled: true,
      clientBotKey: botKey,
      clientGateway: gateway,
    });
  }, 120_000);

  afterAll(async () => {
    await app.close();
    await database.stop();
  });

  const request = (updateId: number, userId: number) =>
    app.inject({
      method: "POST",
      url: `/v1/webhooks/telegram/client/${botKey}`,
      headers: { "x-telegram-bot-api-secret-token": secret },
      payload: {
        update_id: updateId,
        message: {
          from: { id: userId },
          chat: { id: userId, type: "private" },
          text: "Подбери специалиста по моему сложному запросу",
        },
      },
    });

  it("creates exactly one selarti.request.v1 for an authenticated consented client", async () => {
    const response = await request(1_001, 701);
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      accepted: true,
      route: "complex_dialogue",
    });
    const effects = await database.db.execute<{
      inbound: number;
      outbox: number;
    }>(sql`
      select
        (select count(*)::int from dialogue_inbound where provider='telegram' and bot_key=${botKey} and provider_update_id=1001) inbound,
        (select count(*)::int from integration_outbox where topic='selarti.request.v1' and correlation_id=${`telegram:${botKey}:1001`}) outbox
    `);
    expect(effects.rows[0]).toEqual({ inbound: 1, outbox: 1 });
  });

  it.each([
    [1_002, 799, "unknown"],
    [1_003, 702, "blocked"],
    [1_004, 703, "consent denied"],
  ])(
    "terminally rejects %s/%s %s without effects",
    async (updateId, userId) => {
      const response = await request(updateId, userId);
      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ accepted: true, rejected: true });
      const effects = await database.db.execute<{ count: number }>(sql`
      select
        (select count(*)::int from dialogue_inbound where provider_update_id=${updateId}) +
        (select count(*)::int from integration_outbox where correlation_id=${`telegram:${botKey}:${updateId}`}) count
    `);
      expect(effects.rows[0]?.count).toBe(0);
    },
  );

  it("returns retryable 503 and rolls back every effect on a database failure", async () => {
    await database.db.execute(sql`
      create function b1_http_reject_inbound() returns trigger language plpgsql as $$
      begin
        if new.provider_update_id = 1005 then
          raise exception 'forced B1 HTTP database failure';
        end if;
        return new;
      end $$
    `);
    await database.db.execute(sql`
      create trigger b1_http_reject_inbound_trigger before insert on dialogue_inbound
      for each row execute function b1_http_reject_inbound()
    `);
    try {
      const response = await request(1_005, 704);
      expect(response.statusCode).toBe(503);
      expect(response.json()).toEqual({ error: "client_gateway_unavailable" });
    } finally {
      await database.db.execute(
        sql`drop trigger b1_http_reject_inbound_trigger on dialogue_inbound`,
      );
      await database.db.execute(sql`drop function b1_http_reject_inbound()`);
    }
    const effects = await database.db.execute<{
      inbound: number;
      outbox: number;
    }>(sql`
      select
        (select count(*)::int from dialogue_inbound where provider_update_id=1005) inbound,
        (select count(*)::int from integration_outbox where correlation_id=${`telegram:${botKey}:1005`}) outbox
    `);
    expect(effects.rows[0]).toEqual({ inbound: 0, outbox: 0 });
  });
});
