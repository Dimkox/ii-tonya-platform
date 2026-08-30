import { describe, expect, it } from "vitest";
import { calculatePartnerShadowQuote, type PartnerPolicySnapshot } from "./partner-pricing.js";

const policy = (kind: "CENTER" | "ORGANIZER"): PartnerPolicySnapshot => ({
  policyVersionId: "partner-commerce-a",
  policyVersion: 1,
  kind,
  standardPriceMinor: kind === "CENTER" ? 1_500_000 : 2_000_000,
  referredSixPriceMinor: kind === "CENTER" ? 1_200_000 : 1_500_000,
  referredTenPriceMinor: kind === "CENTER" ? 800_000 : 1_000_000,
  onlineOnlySurchargeMinor: 300_000,
  cityMillionPlusSurchargeMinor: 500_000,
  currency: "RUB",
  durationSeconds: 2_592_000,
  eventEntitlements: [{ capacity: 10, count: 1 }],
  residentCommissionBps: 1000,
  nonresidentCommissionBps: 1500,
  nonresidentCardFeeMinor: 450_000,
});

describe("calculatePartnerShadowQuote", () => {
  it.each([
    ["CENTER", 0, false, false, "STANDARD", 1_500_000],
    ["CENTER", 6, false, false, "REFERRED_6_9", 1_200_000],
    ["CENTER", 10, false, false, "REFERRED_10_PLUS", 800_000],
    ["ORGANIZER", 0, false, false, "STANDARD", 2_000_000],
    ["ORGANIZER", 6, false, false, "REFERRED_6_9", 1_500_000],
    ["ORGANIZER", 10, false, false, "REFERRED_10_PLUS", 1_000_000],
    ["CENTER", 10, true, true, "REFERRED_10_PLUS", 1_600_000],
    ["ORGANIZER", 6, true, true, "REFERRED_6_9", 2_300_000],
  ] as const)("calculates %s count %i", (kind, count, onlineOnly, cityMillionPlus, tier, finalPriceMinor) => {
    expect(calculatePartnerShadowQuote({ kind, qualifiedExpertCount: count, onlineOnly, cityMillionPlus, policy: policy(kind) })).toMatchObject({
      tier, finalPriceMinor, currency: "RUB", durationSeconds: 2_592_000,
    });
  });

  it.each([
    -1, 1.5, Number.MAX_SAFE_INTEGER + 1,
  ])("rejects invalid count %s", (qualifiedExpertCount) => {
    expect(() => calculatePartnerShadowQuote({ kind: "CENTER", qualifiedExpertCount, onlineOnly: false, cityMillionPlus: false, policy: policy("CENTER") })).toThrow("partner_pricing_invalid");
  });

  it("rejects unsupported kind", () => {
    expect(() => calculatePartnerShadowQuote({ kind: "EXPERT", qualifiedExpertCount: 0, onlineOnly: false, cityMillionPlus: false, policy: policy("CENTER") })).toThrow("partner_pricing_invalid");
  });

  it("rejects inconsistent policy", () => {
    expect(() => calculatePartnerShadowQuote({ kind: "CENTER", qualifiedExpertCount: 0, onlineOnly: false, cityMillionPlus: false, policy: { ...policy("CENTER"), kind: "ORGANIZER", currency: "USD", referredTenPriceMinor: 700_000 } as never })).toThrow("partner_pricing_invalid");
  });
});
