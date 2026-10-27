import { expect, it, vi } from "vitest";
import { buildTestApp, buildApp } from "./app.js";
import { createDefaultLifecycle } from "./server.js";
import { loadEnv } from "@ii-tonya/config";
const base = () =>
  loadEnv({
    DATABASE_URL: "postgresql://local:local@localhost/test",
    ALLOW_INSECURE_LOCAL_DATABASE: "true",
  });
it("actual normal app fails enabled C without its complete configuration/capability", async () => {
  await expect(
    buildTestApp({ features: { expertCard: true } }),
  ).rejects.toThrow("expert_card_configuration_required");
});
it("actual lifecycle rejects incomplete C before migration", () => {
  const config = base();
  config.features.expertCard = true;
  expect(() => createDefaultLifecycle().preflight(config)).toThrow(
    "expert_card_configuration_required",
  );
});

function enabledConfig() {
  const config = base();
  config.features.expertCard = true;
  config.telegramWebhookSecret = "synthetic_work_secret_123456789012";
  config.expertCard = {
    paymentMode: "test",
    materialDeliveryEnabled: false,
    mainCheckoutEnabled: false,
    workBotId: "11",
    workBotKey: "work",
    workBotUsername: "synthetic_work_bot",
    messagingConsentPolicyVersion: "policy-v1",
    webhookSecret: config.telegramWebhookSecret,
  };
  return config;
}
it("normal lifecycle composes card services and actual app routes", async () => {
  const config = enabledConfig();
  const lifecycle = createDefaultLifecycle();
  lifecycle.preflight(config);
  const deps = await lifecycle.dependencies(config, undefined as never);
  expect(deps.expertCard?.workBotId).toBe("11");
  expect(typeof deps.expertCard?.legacyReplay.read).toBe("function");
  const list = vi
    .spyOn(deps.expertCard!.admin, "list")
    .mockResolvedValue({ kind: "ok", items: [] });
  const app = await buildApp(deps);
  try {
    const response = await app.inject({
      method: "GET",
      url: "/v1/admin/expert-cards",
      headers: { authorization: "Bearer synthetic_staff_token_123456789012" },
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(list).toHaveBeenCalledOnce();
  } finally {
    await app.close();
  }
});
it("normal app rejects a card capability bound to a different webhook secret", async () => {
  const config = enabledConfig();
  const deps = await createDefaultLifecycle().dependencies(
    config,
    undefined as never,
  );
  await expect(
    buildApp({
      ...deps,
      telegramWebhookSecret: "different_synthetic_work_secret_123456",
    }),
  ).rejects.toThrow("expert_card_webhook_scope_conflict");
});
it("enabled main checkout requires explicit custody capability before migration", () => {
  const config = enabledConfig();
  config.expertCard!.mainCheckoutEnabled = true;
  expect(() => createDefaultLifecycle().preflight(config)).toThrow(
    "expert_card_checkout_capability_required",
  );
});

it("configured main checkout still requires canonical merchant callback before migration", () => {
  const config = enabledConfig();
  config.expertCard!.mainCheckoutEnabled = true;
  const lifecycle = createDefaultLifecycle({
    expertCard: {
      mainCheckout: {
        strictFirstSendCancellation: true,
        async createOrRecover() {
          return { kind: "unavailable" as const };
        },
      },
    },
  });
  expect(() => lifecycle.preflight(config)).toThrow(
    "expert_card_merchant_callback_required",
  );
});

it("acknowledges an already delivered ForceReply without sending a competing message", async () => {
  const config = enabledConfig();
  const deps = await createDefaultLifecycle().dependencies(
    config,
    undefined as never,
  );
  vi.spyOn(deps.expertCard!.legacyReplay, "read").mockResolvedValue("absent");
  vi.spyOn(deps.expertCard!.service, "handleWork").mockResolvedValue({
    status: "handled",
    text: "already sent",
    promptDelivered: true,
    tagCallbackAuthorized: true,
  });
  const app = await buildApp(deps);
  try {
    const response = await app.inject({
      method: "POST",
      url: "/v1/webhooks/telegram",
      headers: {
        "x-telegram-bot-api-secret-token": config.telegramWebhookSecret!,
      },
      payload: {
        update_id: 91,
        callback_query: {
          id: "custom-field",
          from: { id: 42 },
          message: {
            message_id: 90,
            from: { id: 11, is_bot: true },
            chat: { id: 42, type: "private" },
            text: "Теги",
          },
          data: "ct2:a:11111111-1111-4111-8111-111111111111",
        },
      },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ accepted: true });
  } finally {
    await app.close();
  }
});
