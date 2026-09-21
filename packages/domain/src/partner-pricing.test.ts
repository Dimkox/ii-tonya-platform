import { describe, expect, it } from "vitest";
import {
  calculatePartnerShadowQuote,
  type PartnerPolicySnapshot,
} from "./partner-pricing.js";

const entitlements = (kind: "CENTER" | "ORGANIZER") =>
  kind === "CENTER"
    ? [{ capacity: 30, count: 10 }]
    : [
        { capacity: 50, count: 5 },
        { capacity: 100, count: 3 },
        { capacity: 500, count: 1 },
      ];
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
  eventEntitlements: entitlements(kind),
  residentCommissionBps: 1000,
  nonresidentCommissionBps: 1500,
  nonresidentCardFeeMinor: 450_000,
});
const quoteInput = (overrides: Record<string, unknown> = {}) => ({
  kind: "CENTER" as const,
  qualifiedExpertCount: 0,
  onlineOnly: false,
  cityMillionPlus: false,
  policy: policy("CENTER"),
  ...overrides,
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
  ] as const)(
    "calculates %s count %i",
    (kind, count, onlineOnly, cityMillionPlus, tier, finalPriceMinor) => {
      expect(
        calculatePartnerShadowQuote({
          kind,
          qualifiedExpertCount: count,
          onlineOnly,
          cityMillionPlus,
          policy: policy(kind),
        }),
      ).toMatchObject({ tier, finalPriceMinor });
    },
  );
  it("propagates the complete policy snapshot", () => {
    const source = policy("ORGANIZER");
    expect(
      calculatePartnerShadowQuote({
        kind: "ORGANIZER",
        qualifiedExpertCount: 6,
        onlineOnly: true,
        cityMillionPlus: true,
        policy: source,
      }),
    ).toEqual({
      policyVersionId: source.policyVersionId,
      policyVersion: source.policyVersion,
      kind: "ORGANIZER",
      qualifiedExpertCount: 6,
      tier: "REFERRED_6_9",
      basePriceMinor: 1_500_000,
      onlineOnlySurchargeMinor: 300_000,
      cityMillionPlusSurchargeMinor: 500_000,
      finalPriceMinor: 2_300_000,
      currency: "RUB",
      durationSeconds: 2_592_000,
      eventEntitlements: entitlements("ORGANIZER"),
      residentCommissionBps: 1000,
      nonresidentCommissionBps: 1500,
      nonresidentCardFeeMinor: 450_000,
    });
  });
  it("deeply isolates and freezes entitlements", () => {
    const source = policy("CENTER");
    const quote = calculatePartnerShadowQuote({
      ...quoteInput(),
      policy: source,
    });
    expect(Object.isFrozen(quote)).toBe(true);
    expect(Object.isFrozen(quote.eventEntitlements)).toBe(true);
    expect(Object.isFrozen(quote.eventEntitlements[0])).toBe(true);
    expect(quote.eventEntitlements).not.toBe(source.eventEntitlements);
    expect(quote.eventEntitlements[0]).not.toBe(source.eventEntitlements[0]);
    (source.eventEntitlements[0]! as { capacity: number }).capacity = 99;
    expect(quote.eventEntitlements[0]!.capacity).toBe(30);
    expect(
      () =>
        ((
          quote.eventEntitlements as unknown as Array<{ capacity: number }>
        )[0]!.capacity = 99),
    ).toThrow(TypeError);
  });
  it.each([-1, 1.5, Number.MAX_SAFE_INTEGER + 1])(
    "rejects invalid count %s",
    (qualifiedExpertCount) => {
      expect(() =>
        calculatePartnerShadowQuote(
          quoteInput({ qualifiedExpertCount }) as never,
        ),
      ).toThrow(new Error("partner_pricing_invalid"));
    },
  );
  it.each([
    ["kind", { kind: "EXPERT" }],
    ["currency", { policy: { ...policy("CENTER"), currency: "USD" } }],
    [
      "policy version id",
      { policy: { ...policy("CENTER"), policyVersionId: "" } },
    ],
    ["policy version", { policy: { ...policy("CENTER"), policyVersion: 0 } }],
    [
      "standard price",
      { policy: { ...policy("CENTER"), standardPriceMinor: 0 } },
    ],
    [
      "six price",
      {
        policy: {
          ...policy("CENTER"),
          referredSixPriceMinor: Number.MAX_SAFE_INTEGER + 1,
        },
      },
    ],
    [
      "ten price",
      { policy: { ...policy("CENTER"), referredTenPriceMinor: -1 } },
    ],
    ["online boolean", { onlineOnly: "false" }],
    ["city boolean", { cityMillionPlus: 0 }],
    [
      "entitlement shape",
      { policy: { ...policy("CENTER"), eventEntitlements: null } },
    ],
    [
      "entitlement array",
      {
        policy: {
          ...policy("CENTER"),
          eventEntitlements: [{ capacity: 30, count: 9 }],
        },
      },
    ],
  ] as const)("rejects malformed %s", (_name, overrides) =>
    expect(() =>
      calculatePartnerShadowQuote(quoteInput(overrides) as never),
    ).toThrow(new Error("partner_pricing_invalid")),
  );

  // Границы полосы по DEC-FIN-012 (пороги `>=6` и `>=10`) и его эрратуму 2026-09-21:
  // ровно 5 приведённых экспертов — это STANDARD (базовая цена), скидка начинается с 6.
  describe("tier boundaries per DEC-FIN-012", () => {
    const boundary = [
      [0, "STANDARD"],
      [1, "STANDARD"],
      [2, "STANDARD"],
      [3, "STANDARD"],
      [4, "STANDARD"],
      [5, "STANDARD"],
      [6, "REFERRED_6_9"],
      [7, "REFERRED_6_9"],
      [8, "REFERRED_6_9"],
      [9, "REFERRED_6_9"],
      [10, "REFERRED_10_PLUS"],
      [11, "REFERRED_10_PLUS"],
      [99, "REFERRED_10_PLUS"],
    ] as const;

    it.each(boundary)("counts %i -> %s (CENTER)", (count, tier) => {
      const quote = calculatePartnerShadowQuote(
        quoteInput({ qualifiedExpertCount: count }),
      );
      expect(quote.tier).toBe(tier);
      expect(quote.basePriceMinor).toBe(
        tier === "STANDARD"
          ? 1_500_000
          : tier === "REFERRED_6_9"
            ? 1_200_000
            : 800_000,
      );
    });

    it.each(boundary)("counts %i -> %s (ORGANIZER)", (count, tier) => {
      const quote = calculatePartnerShadowQuote(
        quoteInput({
          kind: "ORGANIZER",
          qualifiedExpertCount: count,
          policy: policy("ORGANIZER"),
        }),
      );
      expect(quote.tier).toBe(tier);
      expect(quote.basePriceMinor).toBe(
        tier === "STANDARD"
          ? 2_000_000
          : tier === "REFERRED_6_9"
            ? 1_500_000
            : 1_000_000,
      );
    });

    it("keeps the 5/6 step a discount step, never a surcharge", () => {
      const five = calculatePartnerShadowQuote(
        quoteInput({ qualifiedExpertCount: 5 }),
      );
      const six = calculatePartnerShadowQuote(
        quoteInput({ qualifiedExpertCount: 6 }),
      );
      const nine = calculatePartnerShadowQuote(
        quoteInput({ qualifiedExpertCount: 9 }),
      );
      const ten = calculatePartnerShadowQuote(
        quoteInput({ qualifiedExpertCount: 10 }),
      );
      expect(six.basePriceMinor).toBeLessThan(five.basePriceMinor);
      expect(ten.basePriceMinor).toBeLessThan(nine.basePriceMinor);
      expect(five.finalPriceMinor - six.finalPriceMinor).toBe(300_000);
    });

    it("keeps tier selection independent of the surcharges", () => {
      for (const count of [5, 6, 10]) {
        const plain = calculatePartnerShadowQuote(
          quoteInput({ qualifiedExpertCount: count }),
        );
        const both = calculatePartnerShadowQuote(
          quoteInput({
            qualifiedExpertCount: count,
            onlineOnly: true,
            cityMillionPlus: true,
          }),
        );
        expect(both.tier).toBe(plain.tier);
        expect(both.finalPriceMinor - plain.finalPriceMinor).toBe(800_000);
      }
    });
  });
});
