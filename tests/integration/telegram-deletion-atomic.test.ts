import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import { PassThrough } from "node:stream";
import { buildApp, buildTestApp } from "../../apps/api/src/app.js";
import { sql } from "drizzle-orm";
import { beforeAll, afterAll, expect, it, vi } from "vitest";
import {
  startTestPostgres,
  type TestDatabase,
} from "../../packages/db/src/testkit/postgres.js";
import { PostgresErasureRequestRepository } from "../../packages/db/src/repositories/erasure-request-repository.js";
import { createErasureRequestService } from "../../packages/application/src/erasure-request-service.js";
import { createTelegramDeletionCapability } from "../../apps/api/src/telegram-deletion-composition.js";
import { telegramWebhookRoutes } from "../../apps/api/src/routes/telegram-webhook.js";
import { createLogger } from "../../packages/observability/src/logger.js";
const dbRequire = createRequire(
  new URL("../../packages/db/package.json", import.meta.url),
);
const { PostgreSqlContainer } = dbRequire("@testcontainers/postgresql") as {
  PostgreSqlContainer: new (image: string) => {
    start(): Promise<{ getConnectionUri(): string; stop(): Promise<unknown> }>;
  };
};
const apiRequire = createRequire(
  new URL("../../apps/api/package.json", import.meta.url),
);
const Fastify = apiRequire("fastify") as (options?: {
  loggerInstance: ReturnType<typeof createLogger>;
}) => Awaited<ReturnType<typeof buildApp>>;
let container: { getConnectionUri(): string; stop(): Promise<unknown> };
let db: TestDatabase;
const previous = process.env.II_TONYA_TEST_POSTGRES_ADMIN_URL;
const secret = "synthetic-telegram-webhook-key-0000000000000000000000";
let nextTelegram = 10000;
const headers = { "x-telegram-bot-api-secret-token": secret };
beforeAll(async () => {
  container = await new PostgreSqlContainer("postgres:17.5-bookworm").start();
  process.env.II_TONYA_TEST_POSTGRES_ADMIN_URL = container.getConnectionUri();
  db = await startTestPostgres();
  await db.migrate();
  expect(
    (await db.db.execute(sql`show server_version_num`)).rows[0]
      ?.server_version_num,
  ).toBe("170005");
}, 180000);
afterAll(async () => {
  try {
    await db?.stop();
  } finally {
    await container?.stop();
    if (previous === undefined)
      delete process.env.II_TONYA_TEST_POSTGRES_ADMIN_URL;
    else process.env.II_TONYA_TEST_POSTGRES_ADMIN_URL = previous;
  }
}, 120000);
async function binding(botKey = "bot") {
  const userId = await db.createUser();
  const tg = String(nextTelegram++);
  const row = (
    await db.db.execute<{ id: string }>(
      sql`insert into channel_identities(user_id,provider,bot_key,external_id,external_chat_id) values(${userId}::uuid,'telegram',${botKey},${tg},${tg}) returning id`,
    )
  ).rows[0]!;
  return { userId, tg, identityId: row.id, botKey };
}
async function appFor(
  botKey = "bot",
  enabled = true,
  receiptKey = secret,
  stableBotId = botKey === "first" ? "11" : botKey === "second" ? "12" : "10",
) {
  const repo = new PostgresErasureRequestRepository(db.db);
  const service = createErasureRequestService({
    repository: repo,
    requestEnabled: enabled,
  });
  const deletion = createTelegramDeletionCapability({
    enabled,
    botKey,
    botId: stableBotId,
    receiptKey,
    repository: repo,
    service,
  });
  const app = Fastify({ loggerInstance: createLogger() });
  const downstream = vi.fn(async () => {});
  await app.register(telegramWebhookRoutes, {
    secret,
    ...(deletion ? { deletion } : {}),
    callbacks: {
      isAuthorizedIdentity: async () => true,
      verifyCallback: async () => true,
      process: downstream,
    },
    inbox: {
      claim: async () => ({ kind: "claimed", claimId: "claim" }),
      complete: async () => {},
      fail: async () => {},
    },
    rateLimiter: { consume: () => true },
    clientIngressEnabled: true,
    clientHybridRoutingEnabled: true,
    clientBotKey: botKey,
    clientGateway: {
      handle: async () => {
        await downstream();
        return { status: "handled" };
      },
    },
  });
  return { app, repo, service, downstream };
}
function payload(tg: string, update = 1, extra = {}) {
  return {
    update_id: update,
    message: {
      text: "/delete_data",
      from: { id: Number(tg), is_bot: false },
      chat: { id: Number(tg), type: "private" },
      ...extra,
    },
  };
}
async function count(userId: string) {
  return Number(
    (
      await db.db.execute(
        sql`select count(*) as n from client_erasure_requests where user_id=${userId}::uuid`,
      )
    ).rows[0]?.n,
  );
}
function token(text: string): string | undefined {
  return /er1\.[A-Za-z0-9_-]{43}/u.exec(text)?.[0];
}
it("accepts real HTTP requests atomically, issues usable private receipt and serializes duplicates", async () => {
  const b = await binding();
  const f = await appFor();
  try {
    const responses = await Promise.all(
      Array.from({ length: 5 }, () =>
        f.app.inject({
          method: "POST",
          url: "/v1/webhooks/telegram/client/bot",
          headers,
          payload: payload(b.tg),
        }),
      ),
    );
    expect(responses.map((r) => r.statusCode)).toEqual([
      200, 200, 200, 200, 200,
    ]);
    const bodies = responses.map((r) => r.json().text as string);
    expect(new Set(bodies).size).toBe(1);
    const receipt = token(bodies[0]!)!;
    expect(receipt).toMatch(/^er1\./u);
    expect(await count(b.userId)).toBe(1);
    expect((await f.service.readReceipt(receipt)).kind).toBe("found");
    expect(f.downstream).not.toHaveBeenCalled();
    await db.db.execute(
      sql`delete from channel_identities where id=${b.identityId}::uuid`,
    );
    await db.db.execute(
      sql`update users set active=false where id=${b.userId}::uuid`,
    );
    expect((await f.service.readReceipt(receipt)).kind).toBe("found");
    const response = await f.app.inject({
      method: "POST",
      url: "/v1/webhooks/telegram/client/bot",
      headers,
      payload: payload(b.tg),
    });
    expect(response.statusCode).toBe(403);
    expect(response.body).not.toContain(receipt);
  } finally {
    await f.app.close();
  }
});
it("pins each successful update to original owner across Telegram rebinding and rejects mutated sender", async () => {
  const b = await binding();
  const f = await appFor();
  try {
    const send = (tg = b.tg, update = 2) =>
      f.app.inject({
        method: "POST",
        url: "/v1/webhooks/telegram",
        headers,
        payload: payload(tg, update),
      });
    expect((await send()).statusCode).toBe(200);
    const other = await db.createUser();
    await db.db.execute(
      sql`update channel_identities set user_id=${other}::uuid where id=${b.identityId}::uuid`,
    );
    const stale = await send();
    expect(stale.statusCode).toBe(403);
    expect(token(stale.body)).toBeUndefined();
    expect(await count(other)).toBe(0);
    expect((await send(b.tg, 3)).statusCode).toBe(200);
    expect(await count(other)).toBe(1);
    const foreign = await binding();
    expect((await send(foreign.tg)).statusCode).toBe(403);
    expect(await count(foreign.userId)).toBe(0);
  } finally {
    await f.app.close();
  }
});
it("scopes identical Telegram update IDs by bot", async () => {
  const b = await binding("first");
  const c = await binding("second");
  const first = await appFor("first"),
    second = await appFor("second");
  try {
    for (const [f, binding] of [
      [first, b],
      [second, c],
    ] as const) {
      const res = await f.app.inject({
        method: "POST",
        url: `/v1/webhooks/telegram/client/${binding.botKey}`,
        headers,
        payload: payload(binding.tg, 9),
      });
      expect(res.statusCode).toBe(200);
      expect(await count(binding.userId)).toBe(1);
    }
  } finally {
    await first.app.close();
    await second.app.close();
  }
});
it("rejects wrong bot, inactive user/identity, foreign chat, and disabled capability before routing", async () => {
  const f = await appFor();
  try {
    for (const kind of [
      "wrong_bot",
      "inactive_user",
      "inactive_identity",
      "foreign_chat",
      "foreign_bot_mapping",
      "foreign_chat_mapping",
    ]) {
      const b = await binding();
      if (kind === "inactive_user")
        await db.db.execute(
          sql`update users set active=false where id=${b.userId}::uuid`,
        );
      if (kind === "inactive_identity")
        await db.db.execute(
          sql`update channel_identities set status='blocked' where id=${b.identityId}::uuid`,
        );
      if (kind === "foreign_bot_mapping")
        await db.db.execute(
          sql`update channel_identities set bot_key='other' where id=${b.identityId}::uuid`,
        );
      if (kind === "foreign_chat_mapping")
        await db.db.execute(
          sql`update channel_identities set external_chat_id='999999' where id=${b.identityId}::uuid`,
        );
      const res = await f.app.inject({
        method: "POST",
        url: `/v1/webhooks/telegram/client/${kind === "wrong_bot" ? "wrong" : "bot"}`,
        headers,
        payload: payload(b.tg, Number(b.tg), {
          ...(kind === "foreign_chat"
            ? { chat: { id: 99, type: "private" } }
            : {}),
        }),
      });
      expect(res.statusCode).toBe(kind === "wrong_bot" ? 200 : 403);
      expect(await count(b.userId)).toBe(0);
      expect(token(res.body)).toBeUndefined();
    }
    expect(f.downstream).not.toHaveBeenCalled();
  } finally {
    await f.app.close();
  }
  const off = await appFor("bot", false);
  const b = await binding();
  try {
    expect(
      (
        await off.app.inject({
          method: "POST",
          url: "/v1/webhooks/telegram/client/bot",
          headers,
          payload: payload(b.tg, 50),
        })
      ).statusCode,
    ).toBe(503);
    expect(await count(b.userId)).toBe(0);
    expect(off.downstream).not.toHaveBeenCalled();
  } finally {
    await off.app.close();
  }
});
it("does not issue a derived receipt for an existing browser request or a revoked receipt", async () => {
  const b = await binding();
  const f = await appFor();
  try {
    const browser = `er1.${"A".repeat(43)}`;
    await f.service.request({
      principalUserId: b.userId,
      targetUserId: b.userId,
      receiptToken: browser,
    });
    const res = await f.app.inject({
      method: "POST",
      url: "/v1/webhooks/telegram/client/bot",
      headers,
      payload: payload(b.tg, 60),
    });
    expect(res.statusCode).toBe(200);
    expect(token(res.body)).toBeUndefined();
    expect((await f.service.readReceipt(browser)).kind).toBe("found");
    const c = await binding();
    const request = () =>
      f.app.inject({
        method: "POST",
        url: "/v1/webhooks/telegram/client/bot",
        headers,
        payload: payload(c.tg, 61),
      });
    const created = await request();
    const receipt = token(created.json().text)!;
    expect(receipt).toBeDefined();
    await db.db.execute(
      sql`update client_erasure_requests set receipt_revoked_at=now() where user_id=${c.userId}::uuid`,
    );
    expect(token((await request()).body)).toBeUndefined();
    expect((await f.service.readReceipt(receipt)).kind).toBe("denied");
  } finally {
    await f.app.close();
  }
});
it("renders real attention state and rejects forged completion proof", async () => {
  const b = await binding();
  const f = await appFor();
  try {
    const request = () =>
      f.app.inject({
        method: "POST",
        url: "/v1/webhooks/telegram/client/bot",
        headers,
        payload: payload(b.tg, 70),
      });
    expect((await request()).statusCode).toBe(200);
    const job = randomUUID();
    await db.db.execute(
      sql`insert into privacy_deletion_jobs(id,user_id,idempotency_key,status) values(${job}::uuid,${b.userId}::uuid,${job},'dead_letter')`,
    );
    await db.db.execute(
      sql`update client_erasure_requests set job_id=${job}::uuid where user_id=${b.userId}::uuid`,
    );
    const attention = await request();
    expect(attention.statusCode).toBe(200);
    expect(attention.json().text).toContain("требует внимания");
    expect(attention.json().text).not.toContain("Выполнение ещё ожидается");
    await db.db.execute(
      sql`update privacy_deletion_jobs set status='backup_verified' where id=${job}::uuid`,
    );
    expect((await request()).statusCode).toBe(503);
  } finally {
    await f.app.close();
  }
});
async function waitForBlockedIdentity() {
  for (let n = 0; n < 80; n++) {
    const result = await db.db.execute(
      sql`select 1 from pg_stat_activity where datname=current_database() and wait_event_type='Lock' and query like '%channel_identities%'`,
    );
    if (result.rows.length) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("expected_identity_lock_wait");
}
it("rechecks revoked identity under row lock, persists pinned denial, and cannot target replacement owner", async () => {
  const b = await binding();
  const f = await appFor();
  const lock = await db.db.$client.connect();
  try {
    await lock.query("begin");
    await lock.query(
      "update channel_identities set status='blocked' where id=$1",
      [b.identityId],
    );
    const pending = f.app
      .inject({
        method: "POST",
        url: "/v1/webhooks/telegram/client/bot",
        headers,
        payload: payload(b.tg, 80),
      })
      .then((response) => response);
    await waitForBlockedIdentity();
    await lock.query("commit");
    expect((await pending).statusCode).toBe(403);
    expect(await count(b.userId)).toBe(0);
    const other = await db.createUser();
    await db.db.execute(
      sql`update channel_identities set status='active', user_id=${other}::uuid where id=${b.identityId}::uuid`,
    );
    const res = await f.app.inject({
      method: "POST",
      url: "/v1/webhooks/telegram/client/bot",
      headers,
      payload: payload(b.tg, 80),
    });
    expect(res.statusCode).toBe(403);
    expect(await count(other)).toBe(0);
  } finally {
    await lock.query("rollback");
    lock.release();
    await f.app.close();
  }
});

it("forwards real atomic capability through buildApp and enforces both flags", async () => {
  const b = await binding();
  const repo = new PostgresErasureRequestRepository(db.db);
  const deletion = createTelegramDeletionCapability({
    enabled: true,
    botKey: "bot",
    botId: "10",
    receiptKey: secret,
    repository: repo,
    service: createErasureRequestService({
      repository: repo,
      requestEnabled: true,
    }),
  })!;
  for (const flags of [
    { clientPrivacy: false, clientErasureRequests: true },
    { clientPrivacy: true, clientErasureRequests: false },
    { clientPrivacy: true, clientErasureRequests: true },
  ]) {
    const app = await buildTestApp({
      telegramDeletion: deletion,
      features: flags,
    });
    try {
      const res = await app.inject({
        method: "POST",
        url: "/v1/webhooks/telegram",
        headers: {
          "x-telegram-bot-api-secret-token":
            "__PLACEHOLDER_TELEGRAM_WEBHOOK_SECRET__",
        },
        payload: payload(b.tg, 90),
      });
      expect(res.statusCode).toBe(
        flags.clientPrivacy && flags.clientErasureRequests ? 200 : 503,
      );
    } finally {
      await app.close();
    }
  }
  expect(await count(b.userId)).toBe(1);
});
it("emits a keyed security event for wrong bot path even with valid shared secret", async () => {
  const output = new PassThrough();
  let logged = "";
  output.on("data", (chunk) => {
    logged += String(chunk);
  });
  const app = Fastify({ loggerInstance: createLogger(output) });
  await app.register(telegramWebhookRoutes, {
    secret,
    callbacks: {
      isAuthorizedIdentity: async () => true,
      verifyCallback: async () => true,
      process: async () => {},
    },
    inbox: {
      claim: async () => ({ kind: "claimed", claimId: "claim" }),
      complete: async () => {},
      fail: async () => {},
    },
    rateLimiter: { consume: () => true },
    clientIngressEnabled: false,
    clientHybridRoutingEnabled: false,
    clientBotKey: "bot",
    clientGateway: undefined,
  });
  try {
    const response = await app.inject({
      method: "POST",
      url: "/v1/webhooks/telegram/client/WRONG_BOT_MARKER",
      headers: { ...headers, "user-agent": "PRIVATE_UA_MARKER" },
      payload: { update_id: 1 },
    });
    expect(response.statusCode).toBe(200);
    await new Promise<void>((resolve) => setImmediate(resolve));
    const records = logged
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    expect(
      records.filter((row) => row.event === "telegram_ingress_security"),
    ).toEqual([
      expect.objectContaining({
        reason: "authentication_rejected",
        ipFingerprint: expect.stringMatching(/^h1:[0-9a-f]{64}$/u),
        uaFingerprint: expect.stringMatching(/^h1:[0-9a-f]{64}$/u),
      }),
    ]);
    expect(logged).not.toContain("WRONG_BOT_MARKER");
    expect(logged).not.toContain("PRIVATE_UA_MARKER");
  } finally {
    await app.close();
  }
});

it("keeps replay ownership across webhook-key and bot-path rotation", async () => {
  const b = await binding("old_path");
  const first = await appFor("old_path", true, secret, "77");
  try {
    expect(
      (
        await first.app.inject({
          method: "POST",
          url: "/v1/webhooks/telegram/client/old_path",
          headers,
          payload: payload(b.tg, 101),
        })
      ).statusCode,
    ).toBe(200);
  } finally {
    await first.app.close();
  }
  const other = await db.createUser();
  await db.db.execute(
    sql`update channel_identities set bot_key='new_path',user_id=${other}::uuid where id=${b.identityId}::uuid`,
  );
  const rotated = await appFor(
    "new_path",
    true,
    "new-synthetic-webhook-key-00000000000000000000",
    "77",
  );
  try {
    const replay = await rotated.app.inject({
      method: "POST",
      url: "/v1/webhooks/telegram/client/new_path",
      headers,
      payload: payload(b.tg, 101),
    });
    expect(replay.statusCode).toBe(403);
    expect(token(replay.body)).toBeUndefined();
    expect(await count(other)).toBe(0);
  } finally {
    await rotated.app.close();
  }
});
