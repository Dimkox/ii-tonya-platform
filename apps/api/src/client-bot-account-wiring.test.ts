import { expect, it, vi } from "vitest";
import { loadEnv } from "@ii-tonya/config";
import { buildApp } from "./app.js";
import { createDefaultLifecycle } from "./server.js";
function configured() {
  return loadEnv({
    DATABASE_URL: "postgresql://local:local@localhost/test",
    ALLOW_INSECURE_LOCAL_DATABASE: "true",
    CLIENT_ACCOUNT_QUERIES_ENABLED: "true",
    CLIENT_ACCOUNT_QUERIES_PAYMENT_MODE: "test",
    TELEGRAM_BOT_TOKEN: "123456:synthetic_token_123456789012345678901234",
    CLIENT_TELEGRAM_BOT_KEY: "assistant",
    CLIENT_MESSAGING_CONSENT_POLICY_VERSION: "policy-v1",
    TELEGRAM_WEBHOOK_SECRET: "synthetic_client_secret_123456789012",
  });
}
it("normal app requires enabled client account capability", async () => {
  const deps = await createDefaultLifecycle().dependencies(
    configured(),
    undefined as never,
  );
  delete deps.clientAccountQueries;
  let opened: Awaited<ReturnType<typeof buildApp>> | undefined;
  let failure: unknown;
  try {
    opened = await buildApp(deps);
  } catch (error) {
    failure = error;
  } finally {
    await opened?.close();
  }
  expect(failure).toBeInstanceOf(Error);
  expect((failure as Error).message).toBe(
    "client_account_queries_capability_required",
  );
});
it("normal lifecycle composes private reads independently of navigation and hybrid", async () => {
  const deps = await createDefaultLifecycle().dependencies(
    configured(),
    undefined as never,
  );
  const cap = deps.clientAccountQueries;
  expect(cap).toBeDefined();
  const handle = vi.spyOn(cap!.service, "handle").mockResolvedValue({
    status: "reply",
    reply: {
      method: "sendMessage",
      chat_id: 940001,
      text: "Действующие купоны: 0 ₽",
      protect_content: true,
    },
  });
  const app = await buildApp(deps);
  try {
    const response = await app.inject({
      method: "POST",
      url: "/v1/webhooks/telegram/client/assistant",
      headers: {
        "x-telegram-bot-api-secret-token": deps.config.telegramWebhookSecret!,
      },
      payload: {
        update_id: 7,
        message: {
          from: { id: 940001, is_bot: false },
          chat: { id: 940001, type: "private" },
          text: "/coupons_balance",
        },
      },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      method: "sendMessage",
      text: "Действующие купоны: 0 ₽",
      protect_content: true,
    });
    expect(handle).toHaveBeenCalledOnce();
  } finally {
    await app.close();
  }
});
it("manual enabled config rejects an empty receiving secret before serving", async () => {
  const config = configured();
  config.telegramWebhookSecret = "";
  const lifecycle = createDefaultLifecycle();
  expect(() => lifecycle.preflight(config)).toThrow(
    "client_account_queries_configuration_required",
  );
});
