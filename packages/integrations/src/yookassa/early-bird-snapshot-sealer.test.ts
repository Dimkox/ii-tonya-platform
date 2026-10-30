import { randomBytes } from "node:crypto";
import { expect, it } from "vitest";
import { createEarlyBirdSnapshotSealer } from "./early-bird-snapshot-sealer.js";
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
};
const input = {
  customer: { email: "fixture@example.invalid" },
  returnUrl: "https://example.invalid/return",
  onboardingFiscal: fiscal,
  subscriptionFiscal: fiscal,
  key: randomBytes(32),
  keyReference: "vault:fixture",
};
it("fingerprints the exact canonical request and key reference without encryption", () => {
  const sealer = createEarlyBirdSnapshotSealer(input);
  const fingerprint = sealer.fingerprint(intent);
  expect(fingerprint).toEqual({
    digest: sealer(intent).digest,
    keyReference: input.keyReference,
  });
  expect(
    createEarlyBirdSnapshotSealer({
      ...input,
      customer: { email: "other@example.invalid" },
    }).fingerprint(intent).digest,
  ).not.toBe(fingerprint.digest);
  expect(
    createEarlyBirdSnapshotSealer({
      ...input,
      returnUrl: "https://example.invalid/other",
    }).fingerprint(intent).digest,
  ).not.toBe(fingerprint.digest);
  expect(
    createEarlyBirdSnapshotSealer({
      ...input,
      onboardingFiscal: { ...fiscal, vatCode: 2 },
    }).fingerprint(intent).digest,
  ).not.toBe(fingerprint.digest);
  expect(
    createEarlyBirdSnapshotSealer({
      ...input,
      keyReference: "vault:other",
    }).fingerprint(intent).keyReference,
  ).not.toBe(fingerprint.keyReference);
});
