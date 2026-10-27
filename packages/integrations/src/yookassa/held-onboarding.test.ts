import { expect, it } from "vitest";
import { createHeldOnboardingClient } from "./held-onboarding.js";
it("uses capture:false bank-card create, GET then exact capture/cancel endpoints", async () => {
  const requests: { url: string; init: RequestInit }[] = [];
  const transport = async (url: string, init: RequestInit) => {
    requests.push({ url, init });
    return new Response(
      JSON.stringify({
        id: "payment_1",
        status: "waiting_for_capture",
        paid: true,
        amount: { value: "3000.00", currency: "RUB" },
        test: true,
        created_at: "2026-01-01T00:00:00Z",
        metadata: {
          order_id: "invoice_1",
          operation_id: "operation_1",
          purpose: "onboarding",
        },
        payment_method: { type: "bank_card" },
        refundable: false,
      }),
      { status: 200 },
    );
  };
  const client = createHeldOnboardingClient(
    {
      enabled: true,
      mode: "test",
      shopId: "test-shop",
      secretKey: "synthetic-only",
    },
    transport,
  );
  await expect(
    client.postExact({
      kind: "create",
      idempotencyKey: "00000000-0000-4000-8000-000000000001",
      body: JSON.stringify({ capture: true }),
    }),
  ).rejects.toThrow();
  await client.postExact({
    kind: "create",
    idempotencyKey: "00000000-0000-4000-8000-000000000001",
    body: JSON.stringify({
      amount: { value: "3000.00", currency: "RUB" },
      capture: false,
      payment_method_data: { type: "bank_card" },
      confirmation: {
        type: "redirect",
        return_url: "https://example.com/return",
      },
      metadata: {
        order_id: "invoice_1",
        operation_id: "operation_1",
        purpose: "onboarding",
      },
      receipt: {
        customer: { email: "synthetic@example.com" },
        items: [
          {
            description: "Онбординг",
            quantity: "1.00",
            amount: { value: "3000.00", currency: "RUB" },
            vat_code: 1,
            payment_subject: "service",
            payment_mode: "full_payment",
          },
        ],
      },
    }),
  });
  const waiting = await client.inspect("payment_1");
  expect(waiting.status).toBe("waiting_for_capture");
  await client.postExact({
    kind: "capture",
    paymentId: "payment_1",
    idempotencyKey: "00000000-0000-4000-8000-000000000002",
    body: '{"amount":{"value":"3000.00","currency":"RUB"}}',
  });
  await client.postExact({
    kind: "cancel",
    paymentId: "payment_1",
    idempotencyKey: "00000000-0000-4000-8000-000000000003",
    body: "{}",
  });
  expect(requests.map((r) => [r.init.method, new URL(r.url).pathname])).toEqual(
    [
      ["POST", "/v3/payments"],
      ["GET", "/v3/payments/payment_1"],
      ["POST", "/v3/payments/payment_1/capture"],
      ["POST", "/v3/payments/payment_1/cancel"],
    ],
  );
  expect(JSON.parse(requests[0]!.init.body as string)).toMatchObject({
    capture: false,
    payment_method_data: { type: "bank_card" },
  });
});
it("fails closed disabled, malformed, unsupported methods and network ambiguity", async () => {
  const off = createHeldOnboardingClient(
    {
      enabled: false,
      mode: "test",
      shopId: "test-shop",
      secretKey: "synthetic-only",
    },
    async () => {
      throw Error("must not send");
    },
  );
  await expect(off.inspect("payment_1")).rejects.toThrow(
    "held_payment_disabled",
  );
  const unknown = createHeldOnboardingClient(
    {
      enabled: true,
      mode: "test",
      shopId: "test-shop",
      secretKey: "synthetic-only",
    },
    async () => {
      throw Error("timeout");
    },
  );
  await expect(unknown.inspect("payment_1")).rejects.toThrow(
    "held_payment_unknown",
  );
});
it("bounds streamed bytes, cancels overflow and sanitizes stream errors", async () => {
  let cancelled = false;
  const oversized = new ReadableStream<Uint8Array>({
    pull(controller) {
      controller.enqueue(new Uint8Array(65537));
    },
    cancel() {
      cancelled = true;
    },
  });
  const client = createHeldOnboardingClient(
    {
      enabled: true,
      mode: "test",
      shopId: "test-shop",
      secretKey: "synthetic-only",
    },
    async () => new Response(oversized),
  );
  await expect(client.inspect("payment_1")).rejects.toThrow(
    "held_payment_invalid",
  );
  expect(cancelled).toBe(true);
  const broken = createHeldOnboardingClient(
    {
      enabled: true,
      mode: "test",
      shopId: "test-shop",
      secretKey: "synthetic-only",
    },
    async () =>
      new Response(
        new ReadableStream({
          start(controller) {
            controller.error(new Error("sensitive_body_read_diagnostic"));
          },
        }),
      ),
  );
  await expect(broken.inspect("payment_1")).rejects.toThrow(
    "held_payment_unknown",
  );
});

it("rejects a provider checkout URL outside the reviewed merchant confirmation hosts", async () => {
  const client = createHeldOnboardingClient(
    {
      enabled: true,
      mode: "test",
      shopId: "test-shop",
      secretKey: "synthetic-only",
    },
    async () =>
      new Response(
        JSON.stringify({
          id: "payment_1",
          status: "pending",
          paid: false,
          amount: { value: "3000.00", currency: "RUB" },
          test: true,
          created_at: "2026-01-01T00:00:00Z",
          metadata: {},
          payment_method: { type: "bank_card" },
          confirmation: {
            type: "redirect",
            confirmation_url: "https://evil.invalid/payment",
          },
          refundable: false,
        }),
      ),
  );
  await expect(client.inspect("payment_1")).rejects.toThrow(
    "held_payment_unsupported",
  );
});
