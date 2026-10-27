import { expect, it } from "vitest";
import type { RuntimeConfig } from "@ii-tonya/config";
import {
  createClientBotAccountComposition,
  assertClientBotAccountCapability,
} from "./client-bot-account-composition.js";
const config = {
  features: { clientAccountQueries: true },
  telegramWebhookSecret: "synthetic_approved_webhook_secret_123456",
  clientTelegramBotToken: "123:synthetic",
  clientTelegramBotKey: "assistant",
  clientMessagingConsentPolicyVersion: "approved-v1",
  clientAccountQueries: {
    botId: "123",
    botKey: "assistant",
    messagingConsentPolicyVersion: "approved-v1",
    providerMode: "test",
  },
} as RuntimeConfig;
it("does not construct a disabled dependency", () => {
  expect(
    createClientBotAccountComposition(
      undefined as never,
      { features: {} } as RuntimeConfig,
    ),
  ).toBeUndefined();
});
it("requires capability tied to actual receiving bot", () => {
  expect(() => assertClientBotAccountCapability(config, undefined)).toThrow(
    "client_account_queries_capability_required",
  );
  const cap = createClientBotAccountComposition(undefined as never, config)!;
  expect(cap.botId).toBe("123");
  expect(() =>
    assertClientBotAccountCapability(config, { ...cap, botId: "456" }),
  ).toThrow("client_account_queries_capability_required");
  expect(() => assertClientBotAccountCapability(config, cap)).not.toThrow();
});
