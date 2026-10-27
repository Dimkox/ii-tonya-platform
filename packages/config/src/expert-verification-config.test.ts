import { expect, it } from "vitest";
import { loadEnv } from "./env.js";
import { assertExpertVerificationConfig } from "./expert-verification-config.js";
const base = {
  DATABASE_URL: "postgresql://local:local@localhost/test",
  ALLOW_INSECURE_LOCAL_DATABASE: "true",
};
const enabled = {
  ...base,
  EXPERT_VERIFICATION_ENABLED: "true",
  EXPERT_VERIFICATION_PAYMENT_MODE: "test",
  EXPERT_VERIFICATION_MESSAGING_CONSENT_POLICY_VERSION: "policy-v1",
};
it("keeps manager and payment capabilities off by default", () => {
  expect(loadEnv(base).features.expertVerification).not.toBe(true);
  expect(loadEnv(base).expertVerification).toBeUndefined();
});
it.each(["test", "live"])(
  "stores explicit server-owned %s mode with transport off",
  (paymentMode) => {
    expect(
      loadEnv({ ...enabled, EXPERT_VERIFICATION_PAYMENT_MODE: paymentMode })
        .expertVerification,
    ).toEqual({
      paymentMode,
      checkoutEnabled: false,
      paymentVerificationEnabled: false,
      messagingConsentPolicyVersion: "policy-v1",
    });
    expect(
      loadEnv({ ...enabled, EXPERT_VERIFICATION_PAYMENT_MODE: paymentMode })
        .features.expertVerification,
    ).toBe(true);
  },
);
it.each([undefined, "", "sandbox", "client_metadata", "test\n"])(
  "rejects missing or unsupported manager payment mode %j",
  (mode) => {
    expect(() =>
      loadEnv({ ...enabled, EXPERT_VERIFICATION_PAYMENT_MODE: mode }),
    ).toThrow("expert_verification_configuration_required");
  },
);
it.each([
  "EXPERT_VERIFICATION_ENABLED",
  "EXPERT_VERIFICATION_CHECKOUT_ENABLED",
  "EXPERT_VERIFICATION_PAYMENT_VERIFICATION_ENABLED",
])("rejects malformed capability flag %s without disclosing input", (key) => {
  expect(() => loadEnv({ ...enabled, [key]: "private-canary" })).toThrow(
    "expert_verification_configuration_invalid",
  );
});
it.each([
  "EXPERT_VERIFICATION_CHECKOUT_ENABLED",
  "EXPERT_VERIFICATION_PAYMENT_VERIFICATION_ENABLED",
])("requires explicit configuration before %s", (key) => {
  expect(() => loadEnv({ ...base, [key]: "true" })).toThrow(
    "expert_verification_configuration_required",
  );
});
it("allows separately selected payment capabilities but no provider call", () => {
  expect(
    loadEnv({
      ...enabled,
      EXPERT_VERIFICATION_CHECKOUT_ENABLED: "true",
      EXPERT_VERIFICATION_PAYMENT_VERIFICATION_ENABLED: "true",
    }).expertVerification,
  ).toEqual({
    paymentMode: "test",
    checkoutEnabled: true,
    paymentVerificationEnabled: true,
    messagingConsentPolicyVersion: "policy-v1",
  });
});
it("validates manual enabled runtime config before composing capabilities", () => {
  expect(() =>
    assertExpertVerificationConfig({ features: { expertVerification: true } }),
  ).toThrow("expert_verification_configuration_required");
});
it("rejects conflicting configured provider mode", () => {
  expect(() => loadEnv({ ...enabled, YOOKASSA_MODE: "live" })).toThrow(
    "expert_verification_payment_mode_conflict",
  );
});

it.each([undefined, "", "placeholder-policy", "private policy", "policy-v1\n"])(
  "requires explicit approved messaging consent policy identifier %j",
  (policy) => {
    expect(() =>
      loadEnv({
        ...enabled,
        EXPERT_VERIFICATION_MESSAGING_CONSENT_POLICY_VERSION: policy,
      }),
    ).toThrow("expert_verification_configuration_required");
  },
);

it("keeps existing onboarding payment truth available with manager and new checkout off", () => {
  const config = loadEnv({
    ...enabled,
    EXPERT_VERIFICATION_ENABLED: "false",
    EXPERT_VERIFICATION_PAYMENT_VERIFICATION_ENABLED: "true",
  });
  expect(config.features.expertVerification).not.toBe(true);
  expect(config.expertVerification).toEqual({
    paymentMode: "test",
    messagingConsentPolicyVersion: "policy-v1",
    checkoutEnabled: false,
    paymentVerificationEnabled: true,
  });
});
it("cannot enable new onboarding checkout without an existing-payment GET settlement path", () => {
  expect(() =>
    loadEnv({ ...enabled, EXPERT_VERIFICATION_CHECKOUT_ENABLED: "true" }),
  ).toThrow("expert_verification_configuration_required");
});
it("enforces checkout settlement dependency for manually injected runtime settings", () => {
  expect(() =>
    assertExpertVerificationConfig({
      features: { expertVerification: true },
      expertVerification: {
        paymentMode: "test",
        messagingConsentPolicyVersion: "policy-v1",
        checkoutEnabled: true,
        paymentVerificationEnabled: false,
      },
    }),
  ).toThrow("expert_verification_configuration_required");
});
