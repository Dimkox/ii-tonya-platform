import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { sql } from "drizzle-orm";
import { PostgresClientIngressReplayRepository } from "../../packages/db/src/repositories/client-ingress-replay-repository.js";
import { PostgresWebhookInboxRepository } from "../../packages/db/src/repositories/webhook-inbox-repository.js";
import { PostgresHybridMessageRepository } from "../../packages/db/src/repositories/hybrid-message-repository.js";
import { ClientNavigationGateway } from "../../packages/application/src/client-navigation-gateway.js";
import { createDefaultLifecycle } from "../../apps/api/src/server.js";
import { buildApp } from "../../apps/api/src/app.js";
import { loadEnv } from "../../packages/config/src/env.js";
import {
  startTestPostgres,
  type TestDatabase,
} from "../../packages/db/src/testkit/postgres.js";

let db: TestDatabase;
beforeAll(async () => {
  db = await startTestPostgres();
  await db.migrate();
}, 180000);
beforeEach(async () => {
  await db.reset();
  await db.db.execute(sql`truncate webhook_inbox`);
});
afterAll(async () => db?.stop(), 60000);
const event = { botId: "123456", updateId: 7 };
const raw = {
  update_id: 7,
  message: {
    chat: { id: 777, type: "private" },
    from: { id: 777, is_bot: false },
    text: "SYNTHETIC_PERSONAL_CANARY",
  },
};
const gateway = () =>
  new ClientNavigationGateway({
    botId: event.botId,
    origin: "https://client.example",
    replay: new PostgresClientIngressReplayRepository(db.db),
  });
const env = {
  DATABASE_URL: "postgresql://localhost/test",
  ALLOW_INSECURE_LOCAL_DATABASE: "true",
  CLIENT_TELEGRAM_NAVIGATION_ENABLED: "true",
  CLIENT_WEB_ORIGIN: "https://client.example",
  TELEGRAM_BOT_TOKEN: `123456:${"a".repeat(35)}`,
  CLIENT_TELEGRAM_BOT_KEY: "synthetic-key-a",
  TELEGRAM_WEBHOOK_SECRET: "synthetic-secret-".repeat(3),
};

it("atomically receipts concurrent changed bodies once with no content, identity, consent or outbox persistence", async () => {
  const results = await Promise.all(
    Array.from({ length: 8 }, (_, i) =>
      gateway().handle({
        ...raw,
        message: {
          ...raw.message,
          text: i === 0 ? "/start" : `SYNTHETIC_PERSONAL_CANARY_${i}`,
        },
      }),
    ),
  );
  expect(results.filter((r) => r.status === "reply")).toHaveLength(1);
  expect(results.filter((r) => r.status === "duplicate")).toHaveLength(7);
  const rows = (await db.db.execute(sql`select * from webhook_inbox`)).rows;
  expect(rows).toHaveLength(1);
  expect(rows[0]).toEqual({
    id: expect.any(String),
    provider: "telegram",
    external_event_id: "client-navigation-v1:123456:7",
    status: "complete",
    claim_id: expect.stringMatching(/^[0-9a-f-]{36}$/u),
    lease_until: null,
    created_at: expect.anything(),
    updated_at: expect.anything(),
  });
  expect(JSON.stringify(rows)).not.toMatch(
    /SYNTHETIC|payload|digest|hash|text|chat|user/iu,
  );
  const counts = (
    await db.db.execute(
      sql`select (select count(*)::int from users) users, (select count(*)::int from channel_identities) identities, (select count(*)::int from consents) consents, (select count(*)::int from dialogue_inbound) inbound, (select count(*)::int from integration_outbox) outbox`,
    )
  ).rows[0];
  expect(counts).toEqual({
    users: 0,
    identities: 0,
    consents: 0,
    inbound: 0,
    outbox: 0,
  });
});
it("survives restart, arbitrary age and disjoint bot/event/provider namespaces", async () => {
  const first = new PostgresClientIngressReplayRepository(db.db);
  expect(await first.record(event)).toBe("recorded");
  await db.db.execute(
    sql`update webhook_inbox set created_at=now()-interval '10 years', updated_at=now()-interval '10 years'`,
  );
  const restarted = new PostgresClientIngressReplayRepository(db.db);
  expect(await restarted.record(event)).toBe("duplicate");
  expect(await restarted.hasReceipt(event)).toBe(true);
  expect(await restarted.hasReceipt({ ...event, updateId: 8 })).toBe(false);
  expect(await restarted.record({ ...event, botId: "654321" })).toBe(
    "recorded",
  );
  expect(await restarted.record({ ...event, updateId: 8 })).toBe("recorded");
  const legacy = new PostgresWebhookInboxRepository(db.db);
  expect((await legacy.claim("telegram", "7")).kind).toBe("claimed");
  expect(
    (await legacy.claim("yookassa", "client-navigation-v1:123456:7")).kind,
  ).toBe("claimed");
  expect(
    (await legacy.claim("telegram", "client-navigation-v1:123456:7")).kind,
  ).toBe("duplicate");
});
it("uses the same stable identity across key/token rotation and rejects later legacy promo/hybrid before content", async () => {
  const lifecycle = createDefaultLifecycle();
  const config = loadEnv(env);
  lifecycle.preflight(config);
  const app = await buildApp(await lifecycle.dependencies(config, db.db));
  const inject = (target: typeof app, key: string) =>
    target.inject({
      method: "POST",
      url: `/v1/webhooks/telegram/client/${key}`,
      headers: {
        "x-telegram-bot-api-secret-token": env.TELEGRAM_WEBHOOK_SECRET,
      },
      payload: raw,
    });
  try {
    expect((await inject(app, "synthetic-key-a")).json().method).toBe(
      "sendMessage",
    );
  } finally {
    await app.close();
  }
  const legacyConfig = loadEnv({
    ...env,
    CLIENT_TELEGRAM_NAVIGATION_ENABLED: "false",
    CLIENT_WEB_ORIGIN: undefined,
    CLIENT_TELEGRAM_INGRESS_ENABLED: "true",
    CLIENT_MESSAGING_CONSENT_POLICY_VERSION: "messaging-v99",
    CLIENT_TELEGRAM_BOT_KEY: "synthetic-key-b",
    TELEGRAM_BOT_TOKEN: `123456:${"b".repeat(35)}`,
  });
  const deps = await lifecycle.dependencies(legacyConfig, db.db);
  const legacy = vi.spyOn(deps.clientGateway!, "handle");
  const promo = vi.fn(async () => ({ status: "handled" as const }));
  deps.config.features.testExpertPromo = true;
  deps.config.features.testExpertDeterministicFlow = true;
  deps.testExpertPromo = { handle: promo };
  const resumed = await buildApp(deps);
  try {
    expect((await inject(resumed, "synthetic-key-b")).json()).toEqual({
      accepted: true,
      duplicate: true,
    });
    expect(legacy).not.toHaveBeenCalled();
    expect(promo).not.toHaveBeenCalled();
    expect(
      await deps.clientGateway!.handle({
        update_id: 7,
        get message() {
          throw new Error("personal content read");
        },
      }),
    ).toEqual({ status: "duplicate" });
    const direct = new PostgresHybridMessageRepository(db.db, {}, "123456");
    expect(
      await direct.persist({
        updateId: 7n,
        get payloadHash() {
          throw new Error("hash touched");
        },
      } as unknown as Parameters<typeof direct.persist>[0]),
    ).toBe("duplicate");
  } finally {
    await resumed.close();
  }
});
it("bounds receipt and replay lock waits, returns fixed unavailable, and writes nothing on failure", async () => {
  const locked = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  const holder = db.db.transaction(async (tx) => {
    await tx.execute(sql`lock table webhook_inbox in access exclusive mode`);
    locked.resolve();
    await release.promise;
  });
  await Promise.race([locked.promise, holder]);
  try {
    expect(await gateway().handle(raw)).toEqual({ status: "unavailable" });
    await expect(
      new PostgresClientIngressReplayRepository(db.db).hasReceipt(event),
    ).rejects.toThrow("client_ingress_replay_unavailable");
  } finally {
    release.resolve();
    await holder;
  }
  expect((await db.db.execute(sql`select * from webhook_inbox`)).rows).toEqual(
    [],
  );
}, 10000);
