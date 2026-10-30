import { expect, it } from "vitest";
import { loadEnv } from "./env.js";
const SYNTHETIC_FIXTURE_VALUE_1 = "synthetic_work_secret_123456789012";

const base = {
  DATABASE_URL: "postgresql://local:local@localhost/test",
  ALLOW_INSECURE_LOCAL_DATABASE: "true",
};
it("keeps wave workspace off unless explicitly enabled with card ingress", () => {
  expect(loadEnv(base).features.waveWorkspace).not.toBe(true);
  expect(() => loadEnv({ ...base, WAVE_WORKSPACE_ENABLED: "true" })).toThrow();
  expect(() =>
    loadEnv({ ...base, WAVE_WORKSPACE_ENABLED: "invalid" }),
  ).toThrow();
});
it("enables wave workspace only with an explicit configured card feature", () => {
  const config = loadEnv({
    ...base,
    WAVE_WORKSPACE_ENABLED: "true",
    EXPERT_CARD_ENABLED: "true",
    EXPERT_CARD_PAYMENT_MODE: "test",
    EXPERT_CARD_WORK_BOT_ID: "123456",
    EXPERT_CARD_WORK_BOT_KEY: "expert-work",
    EXPERT_CARD_WORK_BOT_USERNAME: "synthetic_work_bot",
    EXPERT_CARD_MESSAGING_CONSENT_POLICY_VERSION: "policy-v1",
    TELEGRAM_WEBHOOK_SECRET: SYNTHETIC_FIXTURE_VALUE_1,
  });
  expect(config.features.waveWorkspace).toBe(true);
});
