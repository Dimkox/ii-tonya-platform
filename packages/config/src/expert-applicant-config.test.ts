import { expect, it } from "vitest";
import { loadEnv } from "./env.js";
import { assertExpertApplicantConfig } from "./expert-applicant-config.js";
const base = {
  DATABASE_URL: "postgresql://local:local@localhost/test",
  ALLOW_INSECURE_LOCAL_DATABASE: "true",
};
const enabled = {
  ...base,
  EXPERT_APPLICANT_ENABLED: "true",
  EXPERT_PROMO_TELEGRAM_BOT_ID: "123456",
  EXPERT_PROMO_TELEGRAM_BOT_KEY: "promo-v1",
  EXPERT_PROMO_TELEGRAM_WEBHOOK_SECRET: "synthetic_promo_secret_1234567890",
  EXPERT_PROMO_MESSAGING_CONSENT_POLICY_VERSION: "policy-v1",
};
it("defaults applicant ingress off", () => {
  expect(loadEnv(base).features.expertApplicant).not.toBe(true);
  expect(loadEnv(base).expertApplicant).toBeUndefined();
});
it("reads complete dedicated scope without requiring provider transport", () => {
  expect(loadEnv(enabled).expertApplicant).toEqual({
    botId: "123456",
    botKey: "promo-v1",
    webhookSecret: enabled.EXPERT_PROMO_TELEGRAM_WEBHOOK_SECRET,
    messagingConsentPolicyVersion: "policy-v1",
  });
  expect(loadEnv(enabled).features.expertApplicant).toBe(true);
});
it.each([
  "EXPERT_PROMO_TELEGRAM_BOT_ID",
  "EXPERT_PROMO_TELEGRAM_BOT_KEY",
  "EXPERT_PROMO_TELEGRAM_WEBHOOK_SECRET",
  "EXPERT_PROMO_MESSAGING_CONSENT_POLICY_VERSION",
])("fails enabled config without %s", (key) => {
  const source: NodeJS.ProcessEnv = { ...enabled };
  delete source[key];
  expect(() => loadEnv(source)).toThrow(
    "expert_applicant_configuration_required",
  );
});
it.each(["0", "123x", "9007199254740992", "123456\n"])(
  "rejects invalid trusted numeric bot id %j",
  (id) => {
    expect(() =>
      loadEnv({ ...enabled, EXPERT_PROMO_TELEGRAM_BOT_ID: id }),
    ).toThrow("expert_applicant_configuration_required");
  },
);
it.each(["TELEGRAM_BOT_TOKEN", "EXPERT_TELEGRAM_BOT_TOKEN"])(
  "rejects shared receiving bot identity with %s",
  (key) => {
    expect(() =>
      loadEnv({
        ...enabled,
        [key]: "123456:synthetic_aaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      }),
    ).toThrow("expert_applicant_bot_scope_conflict");
  },
);
it("rejects shared client path scope", () => {
  expect(() =>
    loadEnv({ ...enabled, CLIENT_TELEGRAM_BOT_KEY: "promo-v1" }),
  ).toThrow("expert_applicant_bot_scope_conflict");
});
it("validates manually supplied startup config as well", () => {
  expect(() =>
    assertExpertApplicantConfig({ features: { expertApplicant: true } }),
  ).toThrow("expert_applicant_configuration_required");
});
it("rejects nonboolean enablement without reflecting source", () => {
  expect(() =>
    loadEnv({ ...enabled, EXPERT_APPLICANT_ENABLED: "secret-canary" }),
  ).toThrow("expert_applicant_configuration_invalid");
});
it("requires a dedicated webhook secret separate from the ordinary client channel", () => {
  expect(() =>
    loadEnv({
      ...enabled,
      TELEGRAM_WEBHOOK_SECRET: enabled.EXPERT_PROMO_TELEGRAM_WEBHOOK_SECRET,
    }),
  ).toThrow("expert_applicant_bot_scope_conflict");
});
it("accepts an optional dedicated promo delivery token only for its exact configured bot", () => {
  const botToken = `123456:${"synthetic_".repeat(4)}`;
  expect(
    loadEnv({ ...enabled, EXPERT_PROMO_TELEGRAM_BOT_TOKEN: botToken })
      .expertApplicant?.botToken,
  ).toBe(botToken);
  expect(() =>
    loadEnv({
      ...enabled,
      EXPERT_PROMO_TELEGRAM_BOT_TOKEN: `654321:${"synthetic_".repeat(4)}`,
    }),
  ).toThrow("expert_applicant_configuration_required");
});
it("keeps verification form default-off and requires dedicated applicant configuration", () => {
  expect(loadEnv(enabled).features.expertVerificationForm).not.toBe(true);
  expect(
    loadEnv({ ...enabled, EXPERT_VERIFICATION_FORM_ENABLED: "true" }).features
      .expertVerificationForm,
  ).toBe(true);
  expect(() =>
    loadEnv({ ...base, EXPERT_VERIFICATION_FORM_ENABLED: "true" }),
  ).toThrow("resident_verification_configuration_required");
  expect(() =>
    loadEnv({ ...enabled, EXPERT_VERIFICATION_FORM_ENABLED: "1" }),
  ).toThrow("resident_verification_configuration_required");
});
