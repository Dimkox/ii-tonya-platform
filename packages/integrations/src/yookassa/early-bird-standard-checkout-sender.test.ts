import { createHash, randomBytes, randomUUID } from "node:crypto";
import { expect, it, vi } from "vitest";
import { EarlyBirdStandardCheckoutSender } from "./early-bird-standard-checkout-sender.js";
import { sealEarlyBirdStandardRequest } from "./early-bird-standard-sealed-request.js";
import {
  YooKassaEarlyBirdCandidateVerifier,
  assertVerifiedEarlyBirdCandidate,
} from "./early-bird-candidate-verifier.js";
function fixture(full = false) {
  const intent = {
    userId: randomUUID(),
    operationId: randomUUID(),
    invoiceId: randomUUID(),
    idempotencyKey: randomUUID(),
    pricingPolicy: "wave1_standard_v1" as const,
    priceKind: full ? ("full_price" as const) : ("discounted" as const),
    mode: "live" as const,
    ruleVersion: "expert_separated_sales_v3" as const,
    participantKind: "expert" as const,
    promotionEligible: !full,
    baseMonthlyMinor: "1000000",
    onboardingMinor: "300000" as const,
    subscriptionMinor: full ? "1000000" : "600000",
    totalMinor: full ? "1300000" : "900000",
    quotedAt: full ? "2026-11-11T00:00:00.000Z" : "2026-11-01T01:00:00.000Z",
    baseOfferShownAt: "2026-11-01T00:00:00.000Z",
    expiresAt: "2026-11-11T00:00:00.000Z",
    launchAt: "2027-01-10T21:00:00.000Z",
  };
  const fiscal = {
    vatCode: 1,
    paymentSubject: "service",
    paymentMode: "full_prepayment",
  };
  const source = {
    intent,
    customer: { email: "fixture@example.test" },
    returnUrl: "https://example.test/done",
    onboardingFiscal: fiscal,
    subscriptionFiscal: fiscal,
  };
  const key = randomBytes(32),
    sealed = sealEarlyBirdStandardRequest(source, key, "vault:v1"),
    events: string[] = [];
  const provider = {
    id: "00000000-0000-0000-0000-000000000001",
    status: "pending" as const,
    paid: false,
    refundable: false,
    amount: { value: full ? "13000.00" : "9000.00", currency: "RUB" as const },
    test: false,
    createdAt: full ? "2026-11-11T00:00:01.000Z" : "2026-11-01T01:00:00.000Z",
    metadata: {
      order_id: intent.invoiceId,
      operation_id: intent.operationId,
      user_id: intent.userId,
      purpose: "combined_early_bird",
      price_kind: intent.priceKind,
      pricing_policy: intent.pricingPolicy,
    },
    confirmation: {
      type: "redirect" as const,
      url: "https://yoomoney.ru/checkout/payments/v2/contract?orderId=fixture",
    },
  };
  const getPayment = vi.fn(async () => {
    events.push("get");
    return provider;
  });
  const verifier = new YooKassaEarlyBirdCandidateVerifier(
    { getPayment },
    {
      findIntent: async () => {
        const { idempotencyKey: _, ...candidate } = intent;
        void _;
        return candidate;
      },
    },
  );
  const admission = {
    admit: vi.fn(async (_input, authenticate) => {
      const body = authenticate({ intent, sealed });
      events.push("committed");
      return {
        kind: "initial_send_admitted" as const,
        userId: intent.userId,
        operationId: intent.operationId,
        invoiceId: intent.invoiceId,
        receiptContactId: _input.receiptContactId,
        idempotencyKey: intent.idempotencyKey,
        digest: sealed.digest,
        totalMinor: intent.totalMinor,
        body,
      };
    }),
  };
  const dispatch = vi.fn(
    async (
      _userId: string,
      _attempt: string,
      _request: Uint8Array,
      context: {
        userId: string;
        intentId: string;
        contactId: string;
        idempotencyKey: string;
      },
    ) => {
      void context;
      void _userId;
      void _attempt;
      void _request;
      events.push("dispatch");
      return {
        kind: "response" as const,
        paymentId: provider.id,
        paymentStatus: "pending",
        confirmationUrl: provider.confirmation.url,
      };
    },
  );
  const bind = vi.fn(async (proof) => {
    assertVerifiedEarlyBirdCandidate(proof, verifier);
    events.push("bind");
  });
  const options = {
    enabled: true,
    admission,
    gateway: { dispatch },
    verifier,
    binding: { bind },
    client: { getPayment },
    resolveRequestKey: () => key,
  };
  const sender = new EarlyBirdStandardCheckoutSender(options);
  return {
    intent,
    source,
    provider,
    key,
    admission,
    dispatch,
    bind,
    getPayment,
    sender,
    options,
    events,
    input: {
      userId: intent.userId,
      operationId: intent.operationId,
      receiptContactId: randomUUID(),
      source: {
        customer: source.customer,
        returnUrl: source.returnUrl,
        onboardingFiscal: fiscal,
        subscriptionFiscal: fiscal,
      },
    },
  };
}
it("commits one admission before dispatch and verifies/binds before exposing the invoice URL", async () => {
  const f = fixture();
  expect(await f.sender.createOrRecover(f.input)).toMatchObject({
    kind: "ready",
    paymentId: f.provider.id,
    confirmationUrl: f.provider.confirmation.url,
  });
  expect(f.events).toEqual(["committed", "dispatch", "get", "bind", "get"]);
  const args = f.dispatch.mock.calls[0]!;
  expect(args[0]).toBe(f.input.receiptContactId);
  expect(args[3]).toEqual({
    userId: f.intent.userId,
    intentId: f.intent.operationId,
    contactId: f.input.receiptContactId,
    idempotencyKey: f.intent.idempotencyKey,
  });
  expect(args[1]).toBe(
    createHash("sha256")
      .update(Buffer.from(f.intent.idempotencyKey.replaceAll("-", ""), "hex"))
      .digest("hex"),
  );
  expect(Buffer.from(args[2]).toString()).not.toMatch(/authorization:/iu);
  expect(Buffer.from(args[2]).toString()).toContain(
    "Idempotence-Key: " + f.intent.idempotencyKey,
  );
});
it("never POSTs existing unknown operation", async () => {
  const f = fixture();
  f.admission.admit.mockResolvedValueOnce({
    kind: "reconcile",
    operationId: f.intent.operationId,
  } as never);
  expect(await f.sender.createOrRecover(f.input)).toEqual({
    kind: "reconcile",
    operationId: f.intent.operationId,
  });
  expect(f.dispatch).not.toHaveBeenCalled();
});
it("unknown transport outcome preserves reconciliation and never retries", async () => {
  const f = fixture();
  f.dispatch.mockRejectedValueOnce(new Error("response lost"));
  expect(await f.sender.createOrRecover(f.input)).toEqual({
    kind: "reconcile",
    operationId: f.intent.operationId,
  });
  expect(f.dispatch).toHaveBeenCalledTimes(1);
  expect(f.bind).not.toHaveBeenCalled();
});
it("does not expose the untrusted gateway URL or bind a mismatched provider payment", async () => {
  const f = fixture();
  f.provider.metadata.operation_id = randomUUID();
  expect(await f.sender.createOrRecover(f.input)).toEqual({
    kind: "reconcile",
    operationId: f.intent.operationId,
  });
  expect(f.bind).not.toHaveBeenCalled();
});
it("fails authentication before admission when receipt data changes", async () => {
  const f = fixture();
  f.input.source.customer.email = "changed@example.test";
  await expect(f.sender.createOrRecover(f.input)).rejects.toThrow(
    "early_bird_sealed_request_invalid",
  );
  expect(f.dispatch).not.toHaveBeenCalled();
});
it("never exposes a payment URL when provider total differs from the DB snapshot", async () => {
  const f = fixture();
  f.provider.amount.value = "9001.00";
  expect(await f.sender.createOrRecover(f.input)).toMatchObject({
    kind: "reconcile",
  });
  expect(f.bind).not.toHaveBeenCalled();
});

it("exposes the DB verified full price at the promotion boundary", async () => {
  const f = fixture(true);
  expect(await f.sender.createOrRecover(f.input)).toMatchObject({
    kind: "ready",
    totalMinor: "1300000",
    onboardingMinor: "300000",
    subscriptionMinor: "1000000",
  });
});
