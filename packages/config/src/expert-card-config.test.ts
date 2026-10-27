import { expect, it } from "vitest";
import { loadEnv } from "./env.js";
import { assertExpertCardConfig } from "./expert-card-config.js";
const base = {
  DATABASE_URL: "postgresql://local:local@localhost/test",
  ALLOW_INSECURE_LOCAL_DATABASE: "true",
};
const enabled = {
  ...base,
  EXPERT_CARD_ENABLED: "true",
  EXPERT_CARD_PAYMENT_MODE: "test",
  EXPERT_CARD_WORK_BOT_ID: "123456",
  EXPERT_CARD_WORK_BOT_KEY: "expert-work",
  EXPERT_CARD_WORK_BOT_USERNAME: "synthetic_work_bot",
  EXPERT_CARD_MESSAGING_CONSENT_POLICY_VERSION: "policy-v1",
  TELEGRAM_WEBHOOK_SECRET: "synthetic_work_secret_123456789012",
};
it("defaults actual card ingress off", () => {
  expect(loadEnv(base).features.expertCard).not.toBe(true);
  expect(loadEnv(base).expertCard).toBeUndefined();
});
it("retains explicit trusted actual work bot scope", () => {
  expect(loadEnv(enabled).expertCard).toEqual({
    paymentMode: "test",
    materialDeliveryEnabled: false,
    mainCheckoutEnabled: false,
    workBotId: "123456",
    workBotKey: "expert-work",
    workBotUsername: "synthetic_work_bot",
    messagingConsentPolicyVersion: "policy-v1",
    webhookSecret: enabled.TELEGRAM_WEBHOOK_SECRET,
  });
});
it.each([
  "EXPERT_CARD_PAYMENT_MODE",
  "EXPERT_CARD_WORK_BOT_ID",
  "EXPERT_CARD_WORK_BOT_KEY",
  "EXPERT_CARD_WORK_BOT_USERNAME",
  "EXPERT_CARD_MESSAGING_CONSENT_POLICY_VERSION",
  "TELEGRAM_WEBHOOK_SECRET",
])("fails enabled startup without %s", (key) => {
  const source: NodeJS.ProcessEnv = { ...enabled };
  delete source[key];
  expect(() => loadEnv(source)).toThrow("expert_card_configuration_required");
});
it.each(["0", "9007199254740992", "123456\n"])(
  "rejects invalid numeric workbot %j",
  (id) => {
    expect(() => loadEnv({ ...enabled, EXPERT_CARD_WORK_BOT_ID: id })).toThrow(
      "expert_card_configuration_required",
    );
  },
);
it("rejects client receiving bot identity collision", () => {
  expect(() =>
    loadEnv({
      ...enabled,
      TELEGRAM_BOT_TOKEN: "123456:synthetic_aaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    }),
  ).toThrow("expert_card_bot_scope_conflict");
});
it("rejects promo receiving identity collision", () => {
  expect(() =>
    assertExpertCardConfig({
      features: { expertCard: true },
      expertCard: loadEnv(enabled).expertCard!,
      expertApplicant: { botId: "123456", botKey: "promo" },
    }),
  ).toThrow("expert_card_bot_scope_conflict");
});
it("rejects mismatch with known actual expert work token/key", () => {
  expect(() =>
    loadEnv({
      ...enabled,
      EXPERT_TELEGRAM_BOT_TOKEN:
        "654321:synthetic_aaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      EXPERT_TELEGRAM_BOT_KEY: "expert-work",
    }),
  ).toThrow("expert_card_bot_scope_conflict");
});
it("requires complete injected runtime settings", () => {
  expect(() =>
    assertExpertCardConfig({ features: { expertCard: true } }),
  ).toThrow("expert_card_configuration_required");
});
it("rejects malformed enablement without reflecting input", () => {
  expect(() =>
    loadEnv({ ...enabled, EXPERT_CARD_ENABLED: "private-canary" }),
  ).toThrow("expert_card_configuration_invalid");
});

it.each(["live?", "sandbox", "test\n"])(
  "rejects unsupported main payment mode %j",
  (mode) => {
    expect(() =>
      loadEnv({ ...enabled, EXPERT_CARD_PAYMENT_MODE: mode }),
    ).toThrow("expert_card_configuration_required");
  },
);

it("keeps existing approved material jobs available while new card admission is off", () => {
  const token = `123456:${"a".repeat(32)}`;
  const config = loadEnv({
    ...enabled,
    EXPERT_CARD_ENABLED: "false",
    EXPERT_CARD_MATERIAL_DELIVERY_ENABLED: "true",
    EXPERT_TELEGRAM_BOT_TOKEN: token,
  });
  expect(config.features.expertCard).not.toBe(true);
  expect(config.features.expertCardMaterialDelivery).toBe(true);
  expect(config.expertCard).toMatchObject({
    materialDeliveryEnabled: true,
    workBotToken: token,
    workBotId: "123456",
  });
});
it("fails material delivery without a trusted actual receiving work bot token", () => {
  expect(() =>
    loadEnv({ ...enabled, EXPERT_CARD_MATERIAL_DELIVERY_ENABLED: "true" }),
  ).toThrow("expert_card_configuration_required");
});
it("rejects malformed material delivery enablement without reflecting input", () => {
  expect(() =>
    loadEnv({
      ...enabled,
      EXPERT_CARD_MATERIAL_DELIVERY_ENABLED: "private-canary",
    }),
  ).toThrow("expert_card_configuration_invalid");
});
it("rejects a new main-payment mode conflicting with configured merchant transport", () => {
  expect(() => loadEnv({ ...enabled, YOOKASSA_MODE: "live" })).toThrow(
    "expert_card_payment_mode_conflict",
  );
});
it("does not make existing material delivery depend on new main-payment admission mode", () => {
  const config = loadEnv({
    ...enabled,
    EXPERT_CARD_ENABLED: "false",
    EXPERT_CARD_MATERIAL_DELIVERY_ENABLED: "true",
    EXPERT_TELEGRAM_BOT_TOKEN: `123456:${"a".repeat(32)}`,
    YOOKASSA_MODE: "live",
  });
  expect(config.features.expertCardMaterialDelivery).toBe(true);
  expect(config.features.expertCard).not.toBe(true);
});

it("keeps main provider checkout independently default off", () => {
  expect(loadEnv(enabled).expertCard?.mainCheckoutEnabled).toBe(false);
});
it("retains explicit main checkout admission without inventing provider capabilities", () => {
  expect(
    loadEnv({ ...enabled, EXPERT_CARD_MAIN_CHECKOUT_ENABLED: "true" })
      .expertCard?.mainCheckoutEnabled,
  ).toBe(true);
});
it("requires card command admission before enabling new main checkout", () => {
  expect(() =>
    loadEnv({
      ...enabled,
      EXPERT_CARD_ENABLED: "false",
      EXPERT_CARD_MAIN_CHECKOUT_ENABLED: "true",
    }),
  ).toThrow("expert_card_configuration_required");
});
it("rejects malformed main checkout flag without reflecting it", () => {
  expect(() =>
    loadEnv({
      ...enabled,
      EXPERT_CARD_MAIN_CHECKOUT_ENABLED: "private-canary",
    }),
  ).toThrow("expert_card_configuration_invalid");
});
it("keeps rich geocoding off until explicitly enabled with server credentials", () => {
  expect(loadEnv(base).residentGeocode).toBeUndefined();
  expect(() => loadEnv({ ...base, RESIDENT_GEOCODE_ENABLED: "true" })).toThrow(
    "resident_geocode_configuration",
  );
  expect(() =>
    loadEnv({
      ...base,
      RESIDENT_GEOCODE_ENABLED: "true",
      RESIDENT_GEOCODE_API_KEY: "__PLACEHOLDER_YANDEX_GEOCODE_KEY__",
    }),
  ).toThrow("resident_geocode_configuration");
  expect(
    loadEnv({
      ...base,
      RESIDENT_GEOCODE_ENABLED: "true",
      RESIDENT_GEOCODE_API_KEY: "synthetic-server-key",
    }).residentGeocode,
  ).toEqual({ key: "synthetic-server-key" });
});
