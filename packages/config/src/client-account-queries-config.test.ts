import { expect, it } from "vitest";
import {
  readClientAccountQueriesConfig,
  assertClientAccountQueriesConfig,
} from "./client-account-queries-config.js";
it("defaults off and requires explicit reviewed server payment mode", () => {
  expect(readClientAccountQueriesConfig({})).toBeUndefined();
  expect(() =>
    readClientAccountQueriesConfig({ CLIENT_ACCOUNT_QUERIES_ENABLED: "true" }),
  ).toThrow("client_account_queries_configuration_required");
});
it("binds actual assistant and explicit test mode", () => {
  expect(
    readClientAccountQueriesConfig({
      CLIENT_ACCOUNT_QUERIES_ENABLED: "true",
      CLIENT_ACCOUNT_QUERIES_PAYMENT_MODE: "test",
      TELEGRAM_BOT_TOKEN: "123:dedicated-token",
      TELEGRAM_WEBHOOK_SECRET: "synthetic_approved_webhook_secret_123456",
      CLIENT_TELEGRAM_BOT_KEY: "assistant",
      CLIENT_MESSAGING_CONSENT_POLICY_VERSION: "approved-v1",
    }),
  ).toEqual({
    botId: "123",
    botKey: "assistant",
    messagingConsentPolicyVersion: "approved-v1",
    providerMode: "test",
  });
});
it.each(["live-from-user", "TEST", ""])(
  "rejects unreviewed payment mode %s",
  (providerMode) => {
    expect(() =>
      readClientAccountQueriesConfig({
        CLIENT_ACCOUNT_QUERIES_ENABLED: "true",
        CLIENT_ACCOUNT_QUERIES_PAYMENT_MODE: providerMode,
        TELEGRAM_BOT_TOKEN: "123:synthetic",
        TELEGRAM_WEBHOOK_SECRET: "synthetic_approved_webhook_secret_123456",
        CLIENT_TELEGRAM_BOT_KEY: "assistant",
        CLIENT_MESSAGING_CONSENT_POLICY_VERSION: "approved-v1",
      }),
    ).toThrow("client_account_queries_configuration_required");
  },
);

it.each([
  undefined,
  "",
  "short",
  "placeholder_abcdefghijklmnopqrstuvwxyz",
  "!".repeat(32),
  "a".repeat(257),
])(
  "rejects enabled manual config with invalid receiving secret %s",
  (telegramWebhookSecret) => {
    expect(() =>
      assertClientAccountQueriesConfig({
        features: { clientAccountQueries: true },
        clientAccountQueries: {
          botId: "123",
          botKey: "assistant",
          messagingConsentPolicyVersion: "approved-v1",
          providerMode: "test",
        },
        clientTelegramBotToken: "123:synthetic",
        clientTelegramBotKey: "assistant",
        clientMessagingConsentPolicyVersion: "approved-v1",
        telegramWebhookSecret,
      } as Parameters<typeof assertClientAccountQueriesConfig>[0]),
    ).toThrow("client_account_queries_configuration_required");
  },
);
