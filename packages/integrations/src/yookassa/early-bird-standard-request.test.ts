import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { buildEarlyBirdStandardRequest } from "./early-bird-request.js";
const base = {
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
} as const;
const input = {
  intent: base,
  customer: { email: "fixture@example.invalid" },
  returnUrl: "https://example.invalid/return",
  onboardingFiscal: fiscal,
  subscriptionFiscal: fiscal,
};
it("serializes the stored exact discounted snapshot and two receipt items", () => {
  const result = buildEarlyBirdStandardRequest(input),
    body = JSON.parse(result.body);
  expect(body.amount.value).toBe("9000.00");
  expect(
    body.receipt.items.map(
      (x: { amount: { value: string } }) => x.amount.value,
    ),
  ).toEqual(["3000.00", "6000.00"]);
  expect(body.metadata).toMatchObject({
    pricing_policy: "wave1_standard_v1",
    price_kind: "discounted",
    operation_id: base.operationId,
  });
  expect(result.idempotencyKey).toBe(base.idempotencyKey);
  expect(result.digest).toBe(
    `sha256:${createHash("sha256").update(result.body).digest("hex")}`,
  );
});
it("rejects forged price or policy snapshot", () => {
  for (const changed of [
    { ...base, subscriptionMinor: "500000", totalMinor: "800001" },
    { ...base, priceKind: "full_price" },
    { ...base, promotionEligible: false },
    { ...base, ruleVersion: "other" },
  ])
    expect(() =>
      buildEarlyBirdStandardRequest({ ...input, intent: changed } as never),
    ).toThrow();
});
it("accepts full price after expiry and floor-limited price with no savings", () => {
  const full = {
    ...base,
    quotedAt: "2026-11-12T00:00:00.000Z",
    promotionEligible: false,
    priceKind: "full_price",
    subscriptionMinor: "1000000",
    totalMinor: "1300000",
  };
  expect(
    JSON.parse(
      buildEarlyBirdStandardRequest({ ...input, intent: full } as never).body,
    ).amount.value,
  ).toBe("13000.00");
  const floor = {
    ...base,
    baseMonthlyMinor: "500000",
    priceKind: "full_price",
    subscriptionMinor: "500000",
    totalMinor: "800000",
  };
  expect(
    JSON.parse(
      buildEarlyBirdStandardRequest({ ...input, intent: floor } as never).body,
    ).amount.value,
  ).toBe("8000.00");
});
