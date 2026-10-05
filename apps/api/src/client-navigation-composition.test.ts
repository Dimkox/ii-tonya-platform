import { PassThrough } from "node:stream";
import { expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";
import type { DrizzleDb } from "@ii-tonya/db";
import { createLogger } from "@ii-tonya/observability";
import {
  loadEnv,
  type RuntimeConfig,
} from "../../../packages/config/src/env.js";
import { createDefaultLifecycle } from "./server.js";
import { buildApp } from "./app.js";

const env = {
  DATABASE_URL: "postgresql://localhost/test",
  ALLOW_INSECURE_LOCAL_DATABASE: "true",
  CLIENT_TELEGRAM_NAVIGATION_ENABLED: "true",
  CLIENT_WEB_ORIGIN: "https://client.example",
  CLIENT_TELEGRAM_BOT_KEY: "synthetic-key",
  TELEGRAM_WEBHOOK_SECRET: "synthetic-secret-".repeat(3),
  TELEGRAM_BOT_TOKEN: `123456:${"a".repeat(35)}`,
};
async function fixture() {
  const queries: { sql: string; params: unknown[] }[] = [];
  const execute = vi.fn(async (query: SQL) => {
    const compiled = new PgDialect().sqlToQuery(query);
    queries.push(compiled);
    if (compiled.sql.includes("insert into webhook_inbox"))
      return { rows: [{ id: "receipt" }] };
    if (compiled.sql.includes("select exists"))
      return { rows: [{ present: true }] };
    return { rows: [] };
  });
  const transaction = vi.fn(
    async (fn: (tx: { execute: typeof execute }) => Promise<unknown>) =>
      fn({ execute }),
  );
  const outside = vi.fn(async () => {
    throw new Error("unexpected database operation");
  });
  const config = loadEnv(env);
  const lifecycle = createDefaultLifecycle();
  lifecycle.preflight(config);
  const deps = await lifecycle.dependencies(config, {
    execute: outside,
    transaction,
  } as unknown as DrizzleDb);
  const sink = new PassThrough();
  const logs: string[] = [];
  sink.on("data", (chunk: Buffer) => logs.push(chunk.toString()));
  deps.logger = createLogger(sink);
  return { deps, queries, execute, transaction, outside, logs };
}
it("composes the actual receipt repository and navigation gateway with sessions/content/providers off", async () => {
  const f = await fixture();
  const app = await buildApp(f.deps);
  try {
    expect(f.deps.clientGateway).toBeUndefined();
    expect(f.deps.testExpertPromo).toBeUndefined();
    const response = await app.inject({
      method: "POST",
      url: "/v1/webhooks/telegram/client/synthetic-key",
      headers: {
        "x-telegram-bot-api-secret-token": env.TELEGRAM_WEBHOOK_SECRET,
      },
      payload: {
        update_id: 7,
        message: {
          chat: { id: 123, type: "private" },
          from: { id: 123, is_bot: false },
          text: "/account",
          unknown: "SYNTHETIC_PERSONAL_CANARY",
        },
      },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      method: "sendMessage",
      chat_id: 123,
      reply_markup: {
        inline_keyboard: [
          [{ text: "Каталог", url: "https://client.example/catalog" }],
          [
            {
              text: "Личный кабинет",
              web_app: { url: "https://client.example/account" },
            },
          ],
          [
            {
              text: "Политика конфиденциальности",
              url: "https://client.example/privacy",
            },
          ],
        ],
      },
    });
    expect(f.transaction).toHaveBeenCalledTimes(1);
    expect(f.queries.map((q) => q.sql.trim()).slice(0, 2)).toEqual([
      "SET LOCAL lock_timeout = '1s'",
      "SET LOCAL statement_timeout = '2s'",
    ]);
    expect(f.queries).toHaveLength(3);
    expect(f.queries[2]?.params).toContain("client-navigation-v1:123456:7");
    expect(JSON.stringify(f.queries)).not.toContain(
      "SYNTHETIC_PERSONAL_CANARY",
    );
    expect(f.outside).not.toHaveBeenCalled();
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(f.logs.join("")).not.toContain("SYNTHETIC_PERSONAL_CANARY");
  } finally {
    await app.close();
  }
});
it.each([
  "clientNavigationGateway",
  "clientIngressReplay",
  "clientBotId",
] as const)("buildApp refuses missing capability %s", async (key) => {
  const f = await fixture();
  delete f.deps[key];
  await expect(buildApp(f.deps)).rejects.toThrow(
    "client_navigation_capability_unavailable",
  );
  expect(f.transaction).not.toHaveBeenCalled();
});
it.each([
  "clientTelegramIngress",
  "clientHybridRouting",
  "testExpertPromo",
  "testExpertSelarti",
  "workerOutboxDelivery",
  "b2TelegramDispatch",
] as const)("preflight refuses hand-built mixed runtime %s", async (flag) => {
  const config = loadEnv(env);
  config.features[flag] = true;
  expect(() => createDefaultLifecycle().preflight(config)).toThrow(
    "client_navigation_exclusive_mode_required",
  );
});
it.each([
  "clientTelegramBotToken",
  "telegramWebhookSecret",
  "clientTelegramBotKey",
  "clientNavigation",
] as const)("preflight refuses missing dependency %s", (key) => {
  const config: RuntimeConfig = loadEnv(env);
  delete config[key];
  expect(() => createDefaultLifecycle().preflight(config)).toThrow(
    "client_navigation_configuration_incomplete",
  );
});
it("production legacy composition refuses to run without stable bot identity", async () => {
  const config = loadEnv({
    DATABASE_URL: env.DATABASE_URL,
    ALLOW_INSECURE_LOCAL_DATABASE: "true",
    CLIENT_TELEGRAM_INGRESS_ENABLED: "true",
    CLIENT_TELEGRAM_BOT_KEY: "synthetic-key",
    TELEGRAM_WEBHOOK_SECRET: env.TELEGRAM_WEBHOOK_SECRET,
    CLIENT_MESSAGING_CONSENT_POLICY_VERSION: "messaging-v1",
  });
  expect(() => createDefaultLifecycle().preflight(config)).toThrow(
    "client_ingress_bot_identity_required",
  );
});

it.each(["config", "dependency", "both"] as const)(
  "custom %s-enabled legacy composition requires valid matching identity and replay capability",
  async (enabledBy) => {
    for (const defect of [
      "missing-token",
      "invalid-token",
      "missing-id",
      "mismatched-id",
      "missing-reader",
    ] as const) {
      const f = await fixture();
      f.deps.config.features.clientTelegramNavigation = false;
      f.deps.config.features.clientTelegramIngress = enabledBy !== "dependency";
      f.deps.clientIngressEnabled = enabledBy !== "config";
      if (defect === "missing-token")
        delete f.deps.config.clientTelegramBotToken;
      if (defect === "invalid-token")
        f.deps.config.clientTelegramBotToken = "invalid";
      if (defect === "missing-id") delete f.deps.clientBotId;
      if (defect === "mismatched-id") f.deps.clientBotId = "654321";
      if (defect === "missing-reader") delete f.deps.clientIngressReplay;
      // Also reject undefined === undefined, not just identity mismatches.
      if (defect === "missing-token" || defect === "invalid-token")
        delete f.deps.clientBotId;
      let created: Awaited<ReturnType<typeof buildApp>> | undefined;
      try {
        await expect(
          buildApp(f.deps).then((app) => {
            created = app;
            return "constructed";
          }),
          defect,
        ).rejects.toThrow("client_ingress_replay_capability_unavailable");
        expect(f.transaction).not.toHaveBeenCalled();
      } finally {
        await created?.close();
      }
    }
  },
);
it.each(["config", "dependency", "both"] as const)(
  "accepts explicit valid %s-enabled legacy composition with replay capability",
  async (enabledBy) => {
    const f = await fixture();
    f.deps.config.features.clientTelegramNavigation = false;
    f.deps.config.features.clientTelegramIngress = enabledBy !== "dependency";
    f.deps.clientIngressEnabled = enabledBy !== "config";
    f.deps.clientBotId = "123456";
    f.deps.clientIngressReplay = { hasReceipt: async () => false };
    const app = await buildApp(f.deps);
    await app.close();
    expect(f.transaction).not.toHaveBeenCalled();
  },
);
