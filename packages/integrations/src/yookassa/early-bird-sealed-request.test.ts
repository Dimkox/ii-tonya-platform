import { randomBytes } from "node:crypto";
import { expect, it } from "vitest";
import {
  openEarlyBirdOwnerRequest,
  sealEarlyBirdOwnerRequest,
} from "./early-bird-sealed-request.js";

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
const source = {
  intent,
  customer: { email: "fixture@example.invalid" },
  returnUrl: "https://example.invalid/return",
  onboardingFiscal: fiscal,
  subscriptionFiscal: fiscal,
};
const key = randomBytes(32);
const keyReference = "vault:fixture";

it("seals canonical 30 ruble request and verifies exact source on opening", () => {
  const sealed = sealEarlyBirdOwnerRequest(source, key, keyReference);
  expect(sealed.ciphertext).not.toContain("fixture@example.invalid");
  const request = openEarlyBirdOwnerRequest(source, sealed, key);
  expect(JSON.parse(request.body).amount.value).toBe("30.00");
  expect(request.digest).toBe(sealed.digest);
  expect(
    sealEarlyBirdOwnerRequest(source, key, keyReference).ciphertext,
  ).not.toBe(sealed.ciphertext);
});
it("rejects altered ciphertext, key, digest, key reference, identity, contact, and price", () => {
  const sealed = sealEarlyBirdOwnerRequest(source, key, keyReference);
  for (const attempt of [
    () =>
      openEarlyBirdOwnerRequest(
        source,
        {
          ...sealed,
          ciphertext:
            sealed.ciphertext.slice(0, -1) +
            (sealed.ciphertext.endsWith("A") ? "B" : "A"),
        },
        key,
      ),
    () => openEarlyBirdOwnerRequest(source, sealed, randomBytes(32)),
    () =>
      openEarlyBirdOwnerRequest(
        source,
        { ...sealed, digest: `sha256:${"a".repeat(64)}` },
        key,
      ),
    () =>
      openEarlyBirdOwnerRequest(
        source,
        { ...sealed, keyReference: "vault:other" },
        key,
      ),
    () =>
      openEarlyBirdOwnerRequest(
        { ...source, intent: { ...intent, userId: intent.invoiceId } },
        sealed,
        key,
      ),
    () =>
      openEarlyBirdOwnerRequest(
        { ...source, customer: { email: "other@example.invalid" } },
        sealed,
        key,
      ),
    () =>
      openEarlyBirdOwnerRequest(
        { ...source, intent: { ...intent, totalMinor: "3001" } } as never,
        sealed,
        key,
      ),
  ])
    expect(attempt).toThrow("early_bird_sealed_request_invalid");
});

it("rejects shifting both offer and expiry while retaining their ten-day interval", () => {
  const sealed = sealEarlyBirdOwnerRequest(source, key, keyReference);
  const shifted = {
    ...source,
    intent: {
      ...intent,
      baseOfferShownAt: "2026-11-02T00:00:00.000Z",
      expiresAt: "2026-11-12T00:00:00.000Z",
    },
  };
  expect(() => openEarlyBirdOwnerRequest(shifted, sealed, key)).toThrow(
    "early_bird_sealed_request_invalid",
  );
});
