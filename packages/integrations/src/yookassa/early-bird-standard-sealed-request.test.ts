import { randomBytes } from "node:crypto";
import { expect, it } from "vitest";
import {
  sealEarlyBirdStandardRequest,
  openEarlyBirdStandardRequest,
} from "./early-bird-standard-sealed-request.js";
const intent = {
  invoiceId: "2526c71d-803f-4c3d-9b57-74e902170001",
  userId: "2526c71d-803f-4c3d-9b57-74e902170002",
  operationId: "2526c71d-803f-4c3d-9b57-74e902170003",
  idempotencyKey: "2526c71d-803f-4c3d-9b57-74e902170005",
  pricingPolicy: "wave1_standard_v1",
  ruleVersion: "expert_separated_sales_v3",
  priceKind: "discounted",
  promotionEligible: true,
  participantKind: "expert",
  mode: "live",
  baseMonthlyMinor: "1000000",
  onboardingMinor: "300000",
  subscriptionMinor: "600000",
  totalMinor: "900000",
  baseOfferShownAt: "2026-11-01T00:00:00.000Z",
  quotedAt: "2026-11-01T01:00:00.000Z",
  expiresAt: "2026-11-11T00:00:00.000Z",
  launchAt: "2027-01-10T21:00:00.000Z",
} as const;
const fiscal = {
  vatCode: 1,
  paymentSubject: "service",
  paymentMode: "full_payment",
};
const source = {
  intent,
  customer: { email: "fixture@example.invalid" },
  returnUrl: "https://example.invalid/return",
  onboardingFiscal: fiscal,
  subscriptionFiscal: fiscal,
};
it("seals the discounted standard invoice and binds quote time and source", () => {
  const key = randomBytes(32),
    sealed = sealEarlyBirdStandardRequest(source, key, "vault:fixture");
  expect(
    JSON.parse(openEarlyBirdStandardRequest(source, sealed, key).body).amount
      .value,
  ).toBe("9000.00");
  expect(() =>
    openEarlyBirdStandardRequest(
      {
        ...source,
        intent: { ...intent, quotedAt: "2026-11-01T02:00:00.000Z" },
      },
      sealed,
      key,
    ),
  ).toThrow();
  expect(() =>
    openEarlyBirdStandardRequest(source, sealed, randomBytes(32)),
  ).toThrow();
});
it("seals full price after the exact 10-day boundary", () => {
  const full = {
    ...source,
    intent: {
      ...intent,
      quotedAt: intent.expiresAt,
      promotionEligible: false,
      priceKind: "full_price" as const,
      subscriptionMinor: "1000000",
      totalMinor: "1300000",
    },
  };
  const key = randomBytes(32),
    sealed = sealEarlyBirdStandardRequest(full, key, "vault:fixture");
  expect(
    JSON.parse(openEarlyBirdStandardRequest(full, sealed, key).body).amount
      .value,
  ).toBe("13000.00");
});
