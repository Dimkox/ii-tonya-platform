import { expect, it } from "vitest";
import { loadEnv } from "./env.js";
import { assertExpertResidencyLifecycleConfig } from "./expert-residency-lifecycle-config.js";
const base = {
  DATABASE_URL: "postgresql://local:local@localhost/test",
  ALLOW_INSECURE_LOCAL_DATABASE: "true",
};
const scope = {
  EXPERT_CARD_PAYMENT_MODE: "test",
  EXPERT_CARD_WORK_BOT_ID: "123456",
  EXPERT_CARD_WORK_BOT_KEY: "work",
  EXPERT_CARD_WORK_BOT_USERNAME: "synthetic_work_bot",
  EXPERT_CARD_MESSAGING_CONSENT_POLICY_VERSION: "policy-v1",
  TELEGRAM_WEBHOOK_SECRET: "synthetic_work_secret_123456789012",
};
it("defaults all lifecycle capabilities off", () => {
  const c = loadEnv(base);
  expect(c.expertResidencyLifecycle).toBeUndefined();
  expect(c.features.expertResidencyLifecycle).not.toBe(true);
});
it("retains explicit worker scope while C/D new admissions are off", () => {
  const c = loadEnv({
    ...base,
    ...scope,
    EXPERT_RESIDENCY_LIFECYCLE_ENABLED: "true",
  });
  expect(c.features.expertCard).not.toBe(true);
  expect(c.features.expertResidencyLifecycleCommands).not.toBe(true);
  expect(c.expertCard?.workBotId).toBe("123456");
  expect(c.expertResidencyLifecycle).toEqual({
    enabled: true,
    commandsEnabled: false,
    noticeDeliveryEnabled: false,
    renewalCheckoutEnabled: false,
  });
});
it("retains notice delivery and its exact work bot token independently of scheduled/new admission", () => {
  const c = loadEnv({
    ...base,
    ...scope,
    EXPERT_RESIDENCY_NOTICE_DELIVERY_ENABLED: "true",
    EXPERT_TELEGRAM_BOT_TOKEN: `123456:${"a".repeat(32)}`,
  });
  expect(c.features.expertCardMaterialDelivery).not.toBe(true);
  expect(c.features.expertResidencyLifecycle).not.toBe(true);
  expect(c.features.expertResidencyNoticeDelivery).toBe(true);
  expect(c.expertCard?.workBotToken).toContain("123456:");
});
it("new commands require complete trusted work settings", () => {
  expect(() =>
    loadEnv({ ...base, EXPERT_RESIDENCY_LIFECYCLE_COMMANDS_ENABLED: "true" }),
  ).toThrow("expert_card_configuration_required");
});
it("notice delivery without a receiving-scope token fails closed", () => {
  expect(() =>
    loadEnv({
      ...base,
      ...scope,
      EXPERT_RESIDENCY_NOTICE_DELIVERY_ENABLED: "true",
    }),
  ).toThrow("expert_card_configuration_required");
});
it.each([
  "EXPERT_RESIDENCY_LIFECYCLE_ENABLED",
  "EXPERT_RESIDENCY_LIFECYCLE_COMMANDS_ENABLED",
  "EXPERT_RESIDENCY_NOTICE_DELIVERY_ENABLED",
  "EXPERT_RESIDENCY_RENEWAL_CHECKOUT_ENABLED",
])("rejects malformed %s without reflecting input", (key) => {
  expect(() => loadEnv({ ...base, ...scope, [key]: "private-canary" })).toThrow(
    "expert_residency_lifecycle_configuration_invalid",
  );
});
it("renewal checkout requires new private owner commands", () => {
  expect(() =>
    loadEnv({
      ...base,
      ...scope,
      EXPERT_RESIDENCY_RENEWAL_CHECKOUT_ENABLED: "true",
    }),
  ).toThrow("expert_residency_lifecycle_configuration_required");
});
it("does not silently invent settings for manually enabled worker", () => {
  expect(() =>
    assertExpertResidencyLifecycleConfig({
      features: { expertResidencyLifecycle: true },
    }),
  ).toThrow("expert_residency_lifecycle_configuration_required");
});
it("rejects a manually mismatched enabled/settings ceiling", () => {
  const c = loadEnv({
    ...base,
    ...scope,
    EXPERT_RESIDENCY_LIFECYCLE_ENABLED: "true",
  });
  expect(() =>
    assertExpertResidencyLifecycleConfig({
      ...c,
      expertResidencyLifecycle: {
        ...c.expertResidencyLifecycle!,
        enabled: false,
      },
    }),
  ).toThrow("expert_residency_lifecycle_configuration_required");
});
it("rejects D-only renewal mode mismatch before any provider operation", () => {
  expect(() =>
    loadEnv({
      ...base,
      ...scope,
      EXPERT_RESIDENCY_LIFECYCLE_COMMANDS_ENABLED: "true",
      EXPERT_RESIDENCY_RENEWAL_CHECKOUT_ENABLED: "true",
      YOOKASSA_MODE: "live",
    }),
  ).toThrow("expert_card_payment_mode_conflict");
});
it("also rejects configured merchant mismatch in manually injected D-only runtime", () => {
  const c = loadEnv({
    ...base,
    ...scope,
    EXPERT_RESIDENCY_LIFECYCLE_COMMANDS_ENABLED: "true",
  });
  expect(() =>
    assertExpertResidencyLifecycleConfig({ ...c, yookassa: { mode: "live" } }),
  ).toThrow("expert_card_payment_mode_conflict");
});
