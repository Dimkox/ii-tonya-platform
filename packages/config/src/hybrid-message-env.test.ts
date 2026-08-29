import { describe, expect, it } from "vitest";
import { loadEnv } from "./env.js";
const base = (extra: Record<string, string> = {}) => ({
  DATABASE_URL: "postgres://postgres:postgres@localhost/db",
  ALLOW_INSECURE_LOCAL_DATABASE: "true",
  ...extra,
});
describe("hybrid message config", () => {
  it("fails closed without a dedicated valid secret and consent policies", () => {
    expect(() =>
      loadEnv(
        base({
          CLIENT_TELEGRAM_INGRESS_ENABLED: "true",
          CLIENT_TELEGRAM_BOT_KEY: "bot-a",
        }),
      ),
    ).toThrow("client_telegram_ingress_configuration_incomplete");
    expect(() =>
      loadEnv(
        base({
          CLIENT_TELEGRAM_INGRESS_ENABLED: "true",
          CLIENT_TELEGRAM_BOT_KEY: "bot-a",
          CLIENT_MESSAGING_CONSENT_POLICY_VERSION: "v1",
          TELEGRAM_WEBHOOK_SECRET: "placeholder_placeholder_placeholder_123",
        }),
      ),
    ).toThrow("client_telegram_ingress_configuration_incomplete");
  });
  it("exposes the configured secret and requires AI consent policy for hybrid", () => {
    const env = base({
      CLIENT_TELEGRAM_INGRESS_ENABLED: "true",
      CLIENT_HYBRID_ROUTING_ENABLED: "true",
      CLIENT_TELEGRAM_BOT_KEY: "bot-a",
      CLIENT_MESSAGING_CONSENT_POLICY_VERSION: "v1",
      SELARTI_AI_CONSENT_POLICY_VERSION: "ai-v1",
      TELEGRAM_WEBHOOK_SECRET: "AbCdEfGhIjKlMnOpQrStUvWxYz_123456",
    });
    expect(loadEnv(env).telegramWebhookSecret).toBe(
      env.TELEGRAM_WEBHOOK_SECRET,
    );
  });
});
