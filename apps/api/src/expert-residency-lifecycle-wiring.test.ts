import { expect, it, vi } from "vitest";
import { loadEnv } from "@ii-tonya/config";
import { buildApp } from "./app.js";
import { createDefaultLifecycle } from "./server.js";
import { ExperimentalGatewayIpc } from "@ii-tonya/integrations";
const receiptCancellation = () => ({
  receiptDisclosureGateway: new ExperimentalGatewayIpc({
    address: "\0unused-lifecycle-wiring",
    key: Buffer.alloc(32, 1),
    authKey: Buffer.alloc(32, 2),
    timeoutMs: 10,
  }),
  receiptDisclosureKeyVersion: "fixture-v1",
});
function enabledConfig() {
  return loadEnv({
    DATABASE_URL: "postgresql://local:local@localhost/test",
    ALLOW_INSECURE_LOCAL_DATABASE: "true",
    EXPERT_RESIDENCY_LIFECYCLE_COMMANDS_ENABLED: "true",
    EXPERT_CARD_PAYMENT_MODE: "test",
    EXPERT_CARD_WORK_BOT_ID: "123456",
    EXPERT_CARD_WORK_BOT_KEY: "work",
    EXPERT_CARD_WORK_BOT_USERNAME: "synthetic_work_bot",
    EXPERT_CARD_MESSAGING_CONSENT_POLICY_VERSION: "policy-v1",
    TELEGRAM_WEBHOOK_SECRET: [
      "synthetic",
      "work",
      "secret",
      "123456789012",
    ].join("_"),
  });
}
it("normal app requires the enabled lifecycle command capability", async () => {
  const config = enabledConfig();
  const deps = await createDefaultLifecycle().dependencies(
    config,
    undefined as never,
  );
  delete deps.expertResidencyLifecycle;
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
    "expert_residency_lifecycle_capability_required",
  );
});
it("normal lifecycle rejects missing strict renewal checkout before migration", () => {
  const config = enabledConfig();
  config.expertResidencyLifecycle!.renewalCheckoutEnabled = true;
  expect(() =>
    createDefaultLifecycle(receiptCancellation()).preflight(config),
  ).toThrow("expert_residency_lifecycle_checkout_capability_required");
});
it("enabled renewal checkout requires its receipt cancellation gateway before migration", () => {
  const config = enabledConfig();
  config.expertResidencyLifecycle!.renewalCheckoutEnabled = true;
  expect(() => createDefaultLifecycle().preflight(config)).toThrow(
    "receipt disclosure cancellation gateway required",
  );
});

it("normal composition routes lifecycle commands with C admissions off", async () => {
  const config = enabledConfig();
  expect(config.features.expertCard).not.toBe(true);
  const deps = await createDefaultLifecycle().dependencies(
    config,
    undefined as never,
  );
  expect(deps.expertResidencyLifecycle).toBeDefined();
  vi.spyOn(
    deps.expertResidencyLifecycle!.legacyReplay,
    "read",
  ).mockResolvedValue("absent");
  const handle = vi
    .spyOn(deps.expertResidencyLifecycle!.service, "handleWork")
    .mockResolvedValue({
      status: "handled",
      text: "Synthetic lifecycle status",
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
        update_id: 7,
        message: {
          from: { id: 940001 },
          chat: { id: 940001, type: "private" },
          text: "/residency",
        },
      },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      method: "sendMessage",
      text: "Synthetic lifecycle status",
      protect_content: true,
    });
    expect(handle).toHaveBeenCalledOnce();
  } finally {
    await app.close();
  }
});
it("normal app binds the lifecycle capability to its receiving webhook", async () => {
  const deps = await createDefaultLifecycle().dependencies(
    enabledConfig(),
    undefined as never,
  );
  await expect(
    buildApp({
      ...deps,
      telegramWebhookSecret: [
        "different",
        "synthetic",
        "secret",
        "123456789012",
      ].join("_"),
    }),
  ).rejects.toThrow("expert_residency_lifecycle_webhook_scope_conflict");
});
it("configured renewal checkout requires the actual merchant callback", () => {
  const config = enabledConfig();
  config.expertResidencyLifecycle!.renewalCheckoutEnabled = true;
  const lifecycle = createDefaultLifecycle({
    ...receiptCancellation(),
    expertResidencyLifecycle: {
      mainCheckout: {
        strictFirstSendCancellation: true,
        async createOrRecover() {
          return { kind: "unavailable" as const };
        },
      },
    },
  });
  expect(() => lifecycle.preflight(config)).toThrow(
    "expert_residency_lifecycle_merchant_callback_required",
  );
});
