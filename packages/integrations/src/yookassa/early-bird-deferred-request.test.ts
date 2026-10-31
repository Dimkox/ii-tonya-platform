import { expect, it } from "vitest";
import {
  buildDeferredRequest,
  openDeferredRequest,
  sealDeferredRequest,
  type DeferredRequestSource,
} from "./early-bird-deferred-request.js";

it("seals and independently rebuilds one exact fiscal receipt for each payment stage", () => {
  const invoiceId = crypto.randomUUID();
  const source: DeferredRequestSource = {
    snapshot: {
      invoiceId,
      operationId: invoiceId,
      userId: crypto.randomUUID(),
      grantId: crypto.randomUUID(),
      policy: "owner_test_10_20_v1",
      stage: "onboarding",
      amountMinor: "1000",
      mode: "live",
      launchAt: "2027-01-11T00:00:00+03:00",
    },
    idempotencyKey: crypto.randomUUID(),
    customer: { email: "client@example.org" },
    returnUrl: "https://example.org/return",
    fiscal: {
      vatCode: 1,
      paymentSubject: "service",
      paymentMode: "full_prepayment",
    },
  };
  const key = Buffer.alloc(32, 7),
    sealed = sealDeferredRequest(source, key, "request:key1");
  const body = JSON.parse(openDeferredRequest(source, sealed, key));
  expect(body.amount.value).toBe("10.00");
  expect(body.receipt.items).toHaveLength(1);
  expect(body.metadata.stage).toBe("onboarding");
  const changed = {
    ...source,
    snapshot: {
      ...source.snapshot,
      stage: "subscription" as const,
      amountMinor: "2000",
    },
  };
  expect(JSON.parse(buildDeferredRequest(changed).body).amount.value).toBe(
    "20.00",
  );
  expect(() => openDeferredRequest(changed, sealed, key)).toThrow(
    "early_bird_deferred_seal_invalid",
  );
  expect(() =>
    openDeferredRequest(
      source,
      { ...sealed, ciphertext: `${sealed.ciphertext}A` },
      key,
    ),
  ).toThrow("early_bird_deferred_seal_invalid");
});
