import { expect, it } from "vitest";
import {
  assertExpertApplicantCapability,
  createExpertApplicantComposition,
} from "./expert-applicant-composition.js";
import type { RuntimeConfig } from "@ii-tonya/config";
const promo = {
  botId: "123456",
  botKey: "promo-v1",
  webhookSecret: "synthetic_promo_secret_1234567890",
  messagingConsentPolicyVersion: "policy-v1",
};
const config = {
  features: { expertApplicant: true },
  expertApplicant: promo,
} as unknown as RuntimeConfig;
const capability = {
  botId: promo.botId,
  botKey: promo.botKey,
  webhookSecret: promo.webhookSecret,
  service: { handle: async () => ({ status: "disabled" as const }) },
};
it("requires enabled capability before app startup", () => {
  expect(() => assertExpertApplicantCapability(config, undefined)).toThrow(
    "expert_applicant_capability_required",
  );
});
it.each(["botId", "botKey", "webhookSecret"] as const)(
  "binds injected %s to trusted startup configuration",
  (key) => {
    expect(() =>
      assertExpertApplicantCapability(config, {
        ...capability,
        [key]: "different",
      }),
    ).toThrow("expert_applicant_capability_required");
  },
);
it("accepts matching separately configured receiving scope", () => {
  expect(() =>
    assertExpertApplicantCapability(config, capability),
  ).not.toThrow();
});
it("does not access storage when disabled", () => {
  expect(
    createExpertApplicantComposition(
      undefined as never,
      { features: {} } as RuntimeConfig,
    ),
  ).toBeUndefined();
});
it("rejects incomplete manually supplied config before storage", () => {
  expect(() =>
    createExpertApplicantComposition(
      undefined as never,
      { features: { expertApplicant: true } } as RuntimeConfig,
    ),
  ).toThrow("expert_applicant_configuration_required");
});
it("normal API composition fails closed before building an enabled incomplete applicant app", async () => {
  const { buildTestApp } = await import("./app.js");
  await expect(
    buildTestApp({ features: { expertApplicant: true } }),
  ).rejects.toThrow("expert_applicant_configuration_required");
});
it("remediation: enforces the verification flag ceiling in both directions", () => {
  expect(() =>
    assertExpertApplicantCapability(config, {
      ...capability,
      verificationFormEnabled: true,
    }),
  ).toThrow("expert_applicant_capability_required");
  const formConfig = {
    ...config,
    features: { ...config.features, expertVerificationForm: true },
  };
  expect(() =>
    assertExpertApplicantCapability(formConfig, {
      ...capability,
      verificationFormEnabled: false,
    }),
  ).toThrow("expert_applicant_capability_required");
  expect(() =>
    assertExpertApplicantCapability(formConfig, {
      ...capability,
      verificationFormEnabled: true,
    }),
  ).not.toThrow();
  expect(() =>
    assertExpertApplicantCapability(config, {
      ...capability,
      verificationFormEnabled: false,
    }),
  ).not.toThrow();
});

it("remediation: disabled applicant startup cannot inject a higher verification capability", () => {
  expect(() =>
    assertExpertApplicantCapability(
      { features: {} } as RuntimeConfig,
      undefined,
    ),
  ).not.toThrow();
  expect(() =>
    assertExpertApplicantCapability({ features: {} } as RuntimeConfig, {
      ...capability,
      verificationFormEnabled: true,
    }),
  ).toThrow("expert_applicant_capability_required");
});
