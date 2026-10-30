import { expect, it, vi } from "vitest";
import { createHeldOnboardingClient } from "@ii-tonya/integrations";
import { PostgresHeldOnboardingCheckout } from "./expert-held-onboarding-repository.js";

function fixture(paymentId: string | null, invoiceMode = "live") {
  const execute = vi.fn().mockImplementation(async () => {
    const n = (execute.mock.calls.length - 1) % 4;
    if (n === 0) return { rows: [{ userId: "user_1" }] };
    if (n === 3)
      return {
        rows: [
          {
            userId: "user_1",
            operationId: "operation_1",
            paymentId,
            current: true,
            mode: invoiceMode,
          },
        ],
      };
    return { rows: [] };
  });
  const transaction = vi.fn(async (callback: (tx: unknown) => unknown) =>
    callback({ execute }),
  );
  const transport = vi.fn(async (_url: string, init: RequestInit) => {
    expect(init.method).toBe("GET");
    return new Response(
      JSON.stringify({
        id: "payment_1",
        status: "pending",
        paid: false,
        amount: { value: "3000.00", currency: "RUB" },
        test: false,
        created_at: "2026-01-01T00:00:00Z",
        metadata: {
          order_id: "invoice_1",
          operation_id: "operation_1",
          user_id: "user_1",
          purpose: "onboarding",
        },
        payment_method: { type: "bank_card" },
        refundable: false,
        confirmation: {
          type: "redirect",
          confirmation_url: "https://yookassa.ru/checkout",
        },
      }),
      { status: 200 },
    );
  });
  const client = createHeldOnboardingClient(
    { enabled: true, mode: "live", shopId: "123", secretKey: "synthetic-only" },
    transport,
  );
  const checkout = new PostgresHeldOnboardingCheckout(
    { transaction } as never,
    { enabled: true, mode: "live", client } as never,
  );
  return { checkout, execute, transport };
}
it("does not dispatch new receipt data in test mode either", async () => {
  const execute = vi.fn(() => {
    throw new Error("database must not be touched");
  });
  const checkout = new PostgresHeldOnboardingCheckout(
    { execute } as never,
    { enabled: true, mode: "test" } as never,
  );
  const raw = checkout as unknown as {
    dispatch(invoice: string, operation: { kind: string }): Promise<unknown>;
  };
  await expect(raw.dispatch("invoice", { kind: "create" })).resolves.toBeNull();
  expect(execute).not.toHaveBeenCalled();
});
it("never sends a new live invoice without a proven first-send fence", async () => {
  const f = fixture(null);
  expect(f.checkout.strictFirstSendCancellation).toBe(false);
  await expect(
    f.checkout.recoverCheckout({
      invoiceId: "invoice_1",
      operationId: "operation_1",
    }),
  ).resolves.toEqual({ kind: "unavailable" });
  expect(f.transport).not.toHaveBeenCalled();
});
it("can recover an already-bound live checkout by GET without a new POST", async () => {
  const f = fixture("payment_1");
  await expect(
    f.checkout.recoverCheckout({
      invoiceId: "invoice_1",
      operationId: "operation_1",
    }),
  ).resolves.toEqual({
    kind: "ready",
    url: "https://yookassa.ru/checkout",
    paymentId: "payment_1",
  });
  expect(f.transport).toHaveBeenCalledTimes(1);
});
it("does not query a provider object bound to a different mode", async () => {
  const f = fixture("payment_1", "test");
  await expect(
    f.checkout.recoverCheckout({
      invoiceId: "invoice_1",
      operationId: "operation_1",
    }),
  ).resolves.toEqual({ kind: "unavailable" });
  expect(f.transport).not.toHaveBeenCalled();
});
it("does not claim strict cancellation in test mode", () => {
  const checkout = new PostgresHeldOnboardingCheckout(
    {} as never,
    { enabled: true, mode: "test" } as never,
  );
  expect(checkout.strictFirstSendCancellation).toBe(false);
});
