import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { buildEarlyBirdOwnerRequest } from "./early-bird-request.js";
const intent = {
  invoiceId: "2526c71d-803f-4c3d-9b57-74e902170001",
  userId: "2526c71d-803f-4c3d-9b57-74e902170002",
  operationId: "2526c71d-803f-4c3d-9b57-74e902170003",
  idempotencyKey: "2526c71d-803f-4c3d-9b57-74e902170005",
  grantId: "2526c71d-803f-4c3d-9b57-74e902170004",
  pricingPolicy: "owner_test_10_20_v1",
  priceKind: "fixed_test",
  mode: "live",
  onboardingMinor: "1000",
  subscriptionMinor: "2000",
  totalMinor: "3000",
  baseOfferShownAt: "2026-11-01T00:00:00.000Z",
  expiresAt: "2026-11-11T00:00:00.000Z",
  launchAt: "2027-01-10T21:00:00.000Z",
} as const;
const fiscal = {
  vatCode: 1,
  paymentSubject: "service",
  paymentMode: "full_payment",
} as const;
const input = {
  intent,
  customer: { email: "fixture@example.invalid" },
  returnUrl: "https://example.invalid/return",
  onboardingFiscal: fiscal,
  subscriptionFiscal: fiscal,
};
it("serializes one payment and two exact receipt items with intent-bound metadata and digest", () => {
  const result = buildEarlyBirdOwnerRequest(input);
  const body = JSON.parse(result.body);
  expect(body.amount.value).toBe("30.00");
  expect(
    body.receipt.items.map(
      (item: { amount: { value: string } }) => item.amount.value,
    ),
  ).toEqual(["10.00", "20.00"]);
  expect(body.metadata).toEqual({
    order_id: intent.invoiceId,
    user_id: intent.userId,
    operation_id: intent.operationId,
    purpose: "combined_early_bird",
    pricing_policy: intent.pricingPolicy,
    price_kind: intent.priceKind,
    pricing_grant_id: intent.grantId,
  });
  expect(result.idempotencyKey).toBe(intent.idempotencyKey);
  expect(buildEarlyBirdOwnerRequest(input)).toEqual(result);
  expect(result.digest).toBe(
    `sha256:${createHash("sha256").update(result.body).digest("hex")}`,
  );
});
it("rejects changed amount, policy, deadline or identities", () => {
  for (const changed of [
    { ...intent, totalMinor: "3001" },
    { ...intent, grantId: intent.operationId.replace("0003", "bad") },
    { ...intent, expiresAt: "2026-11-12T00:00:00.000Z" },
    { ...intent, mode: "test" },
    { ...intent, idempotencyKey: "bad" },
    { ...intent, operationId: "not-a-uuid" },
    { ...intent, idempotencyKey: "2526c71d-803f-1c3d-9b57-74e902170005" },
  ])
    expect(() =>
      buildEarlyBirdOwnerRequest({ ...input, intent: changed } as never),
    ).toThrow();
});
