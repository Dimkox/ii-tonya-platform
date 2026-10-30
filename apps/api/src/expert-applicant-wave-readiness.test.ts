import { expect, it } from "vitest";
import type { RuntimeConfig } from "@ii-tonya/config";
import { assertExpertApplicantCapability } from "./expert-applicant-composition.js";
const SYNTHETIC_FIXTURE_VALUE_1 = "synthetic_promo_secret_1234567890";

it("rejects wave configuration when the applicant cannot provide wave handling", () => {
  const config = {
    features: { expertApplicant: true, expertSeparatedSales: true },
    launchPhase: { configuredPhase: "WAVE_1_EARLY_BIRD" },
    expertApplicant: {
      botId: "123456",
      botKey: "promo-v1",
      webhookSecret: SYNTHETIC_FIXTURE_VALUE_1,
      messagingConsentPolicyVersion: "policy-v1",
    },
  } as unknown as RuntimeConfig;
  const capability = {
    botId: "123456",
    botKey: "promo-v1",
    webhookSecret: SYNTHETIC_FIXTURE_VALUE_1,
    separatedSalesEnabled: true,
    service: { handle: async () => ({ status: "disabled" as const }) },
  };
  expect(() => assertExpertApplicantCapability(config, capability)).toThrow(
    "early_bird_capability_required",
  );
});

it("does not accept a wave boolean as proof of a composed checkout", () => {
  const config = {
    features: { expertApplicant: true, expertSeparatedSales: true },
    launchPhase: { configuredPhase: "WAVE_1_EARLY_BIRD" },
    expertApplicant: {
      botId: "123456",
      botKey: "promo-v1",
      webhookSecret: SYNTHETIC_FIXTURE_VALUE_1,
      messagingConsentPolicyVersion: "policy-v1",
    },
  } as unknown as RuntimeConfig;
  expect(() =>
    assertExpertApplicantCapability(config, {
      botId: "123456",
      botKey: "promo-v1",
      webhookSecret: SYNTHETIC_FIXTURE_VALUE_1,
      separatedSalesEnabled: true,
      earlyBirdEnabled: true,
      service: { handle: async () => ({ status: "disabled" as const }) },
    }),
  ).toThrow("early_bird_capability_required");
});

it("allows configured wave to fall back to the standard flow at client launch", () => {
  const config = {
    features: { expertApplicant: true, expertSeparatedSales: true },
    launchPhase: {
      configuredPhase: "WAVE_1_EARLY_BIRD",
      clientStartMs: Date.parse("2027-01-11T00:00:00+03:00"),
    },
    expertApplicant: {
      botId: "123456",
      botKey: "promo-v1",
      webhookSecret: SYNTHETIC_FIXTURE_VALUE_1,
      messagingConsentPolicyVersion: "policy-v1",
    },
  } as unknown as RuntimeConfig;
  const capability = {
    botId: "123456",
    botKey: "promo-v1",
    webhookSecret: SYNTHETIC_FIXTURE_VALUE_1,
    separatedSalesEnabled: true,
    service: { handle: async () => ({ status: "disabled" as const }) },
  };
  expect(() =>
    assertExpertApplicantCapability(
      config,
      capability,
      Date.parse("2027-01-11T00:00:00+03:00") - 1,
    ),
  ).toThrow("early_bird_capability_required");
  expect(() =>
    assertExpertApplicantCapability(
      config,
      capability,
      Date.parse("2027-01-11T00:00:00+03:00"),
    ),
  ).not.toThrow();
});
