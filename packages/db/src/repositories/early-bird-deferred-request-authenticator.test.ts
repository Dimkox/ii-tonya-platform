import { expect, it } from "vitest";
import {
  sealDeferredRequest,
  type DeferredRequestSource,
} from "@ii-tonya/integrations";
import { deferredRequestAuthenticator } from "./early-bird-deferred-request-authenticator.js";

it("binds the sealed request to the admitted invoice and receipt contact", () => {
  const invoiceId = crypto.randomUUID(),
    userId = crypto.randomUUID(),
    contact = crypto.randomUUID(),
    idempotencyKey = crypto.randomUUID();
  const source: DeferredRequestSource = {
    snapshot: {
      invoiceId,
      userId,
      operationId: invoiceId,
      grantId: crypto.randomUUID(),
      policy: "owner_test_10_20_v1",
      stage: "subscription",
      amountMinor: "2000",
      mode: "live",
      launchAt: "2027-01-11T00:00:00+03:00",
    },
    idempotencyKey,
    customer: { email: "expert@example.org" },
    returnUrl: "https://example.org/return",
    fiscal: {
      vatCode: 1,
      paymentSubject: "service",
      paymentMode: "full_prepayment",
    },
  };
  const key = Buffer.alloc(32, 9),
    sealed = sealDeferredRequest(source, key, "request:key1");
  const admitted = {
    kind: "initial_send_admitted" as const,
    userId,
    invoiceId,
    operationId: invoiceId,
    receiptContactId: contact,
    idempotencyKey,
    amountMinor: "2000",
    stage: "subscription" as const,
    ...sealed,
  };
  const authenticate = deferredRequestAuthenticator(
    source,
    contact,
    key,
    "request:key1",
  );
  expect(JSON.parse(authenticate(admitted)).amount.value).toBe("20.00");
  expect(() =>
    authenticate({ ...admitted, receiptContactId: crypto.randomUUID() }),
  ).toThrow("early_bird_deferred_request_mismatch");
});
