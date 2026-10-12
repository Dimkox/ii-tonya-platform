import { expect, it } from "vitest";
import { loadEnv } from "@ii-tonya/config";
import type { DrizzleDb } from "@ii-tonya/db";
import { createDefaultLifecycle } from "./server.js";
import { buildApp } from "./app.js";
import { issueCallback } from "@ii-tonya/integrations";

const base = () =>
  loadEnv({
    DATABASE_URL: "postgresql://local:local@localhost/test",
    ALLOW_INSECURE_LOCAL_DATABASE: "true",
  });
const db = { execute: async () => ({ rows: [] }) } as unknown as DrizzleDb;
const enabled = () => {
  const config = Object.assign(base(), {
    clientTelegramBotKey: "client",
    clientTelegramBotToken: `123:${"a".repeat(35)}`,
    telegramWebhookSecret: "s".repeat(32),
    bookingCallbacks: {
      hmacKey: new Uint8Array(32).fill(1),
      activeKeyId: "k1",
      keys: new Map([["k1", new Uint8Array(32).fill(2)]]),
    },
  });
  Object.assign(config.features, { bookingCallbacks: true });
  return config;
};
it("routes HTTP callbacks through the composed service to its real repository", async () => {
  const config = enabled();
  let reads = 0;
  const instrumentedDb = {
    execute: async () => {
      reads++;
      return { rows: [] };
    },
  } as unknown as DrizzleDb;
  const deps = await createDefaultLifecycle().dependencies(
    config,
    instrumentedDb,
  );
  const token = await issueCallback(
    {
      reservationId: "11111111-1111-4111-8111-111111111111",
      expertId: "22222222-2222-4222-8222-222222222222",
      action: "confirm",
      version: 1,
      expiresAtEpochSeconds: 2000000000,
    },
    config.bookingCallbacks.hmacKey,
    {
      async put() {},
      async peek() {
        return null;
      },
      async consumeIfValid() {
        return null;
      },
    },
  );
  const app = await buildApp(deps);
  try {
    const before = reads;
    const response = await app.inject({
      method: "POST",
      url: "/v1/webhooks/telegram/client/client",
      headers: {
        "x-telegram-bot-api-secret-token": config.telegramWebhookSecret,
      },
      payload: {
        update_id: 123,
        callback_query: {
          id: "query",
          from: { id: 201 },
          data: token,
          message: { message_id: 77, chat: { id: 201, type: "private" } },
        },
      },
    });
    expect(response.statusCode).toBe(403);
    expect(reads - before).toBe(1);
  } finally {
    await app.close();
  }
});
it("composes real callback service only for explicitly enabled capability", async () => {
  const config = enabled();
  const deps = await createDefaultLifecycle().dependencies(config, db);
  expect(deps).toHaveProperty("bookingCallbacks.handle", expect.any(Function));
});
it("does not compose callback capability by default", async () => {
  const deps = await createDefaultLifecycle().dependencies(base(), db);
  expect(deps).not.toHaveProperty("bookingCallbacks");
});
it.each([
  "bookingCallbacks",
  "clientTelegramBotKey",
  "clientTelegramBotToken",
  "telegramWebhookSecret",
] as const)("refuses enabled callbacks missing only %s", async (field) => {
  const config = enabled();
  Reflect.deleteProperty(config, field);
  const outcome = await createDefaultLifecycle()
    .dependencies(config, db)
    .then(
      () => "resolved",
      (error: unknown) => (error instanceof Error ? error.message : "unknown"),
    );
  expect(outcome).toBe("booking_callback_configuration_required");
});
