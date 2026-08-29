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
    const secret = "AbCdEfGhIjKlMnOpQrStUvWxYz_123456";
    const env = base({
      CLIENT_TELEGRAM_INGRESS_ENABLED: "true",
      CLIENT_HYBRID_ROUTING_ENABLED: "true",
      CLIENT_TELEGRAM_BOT_KEY: "bot-a",
      CLIENT_MESSAGING_CONSENT_POLICY_VERSION: "v1",
      SELARTI_AI_CONSENT_POLICY_VERSION: "ai-v1",
      TELEGRAM_WEBHOOK_SECRET: secret,
    });
    expect(loadEnv(env).telegramWebhookSecret).toBe(secret);
  });
  it("keeps every B2 provider and retention capability independently off", () => {
    const config = loadEnv(base());
    expect(config.features.selartiResponseIngress).toBe(false);
    expect(config.features.b2TelegramDispatch).toBe(false);
    expect(config.features.b2SensitiveRetention).toBe(false);
    expect(config.selartiResponseSharedSecret).toBeUndefined();
  });
  it("blocks Selarti response activation until an official fixture contract exists", () => {
    expect(() =>
      loadEnv(
        base({
          SELARTI_RESPONSE_INGRESS_ENABLED: "true",
          SELARTI_RESPONSE_SHARED_SECRET:
            "B2_Response_Shared_Secret_0123456789abcdef",
          CLIENT_TELEGRAM_BOT_KEY: "bot-a",
        }),
      ),
    ).toThrow("selarti_response_official_fixture_required");
  });
});
