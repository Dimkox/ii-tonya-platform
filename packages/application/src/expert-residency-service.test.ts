import { describe, expect, it, vi } from "vitest";
import { createExpertResidencyService } from "./expert-residency-service.js";
import { owner } from "./expert-referral-service.testkit.js";
import { quote } from "./expert-residency-service.testkit.js";

describe("expert residency service", () => {
  it("returns the 50/50 quote and keeps reconciliation callable below the ceiling", async () => {
    const settle = vi.fn(async () => ({ kind: "settled" }));
    const reconciliation = {
      settle,
      reverse: vi.fn(),
      replayHeldReward: vi.fn(),
      releaseExpiredOrders: vi.fn(),
    };
    const deps = {
      environmentEnabled: true,
      commands: { quote: async () => quote, checkout: vi.fn() },
      queries: { ownerUserId: async () => "user-1" },
      reconciliation,
    };
    expect(
      await createExpertResidencyService(deps).quote(owner, "tariff-1"),
    ).toEqual(quote);
    const disabled = createExpertResidencyService({
      ...deps,
      environmentEnabled: false,
    });
    expect(await disabled.quote(owner, "tariff-1")).toEqual({
      kind: "disabled",
    });
    await disabled.reconciliation.settle({});
    expect(settle).toHaveBeenCalledOnce();
  });

  it("creates the order before invoking the checkout provider and returns a bounded redirect", async () => {
    const order = {
      id: "00000000-0000-4000-8000-000000000701",
      expertId: owner.expertId,
      ...quote,
      paymentDeadline: "2026-08-14T12:00:00.000Z",
      status: "payment_pending" as const,
      allocations: [],
    };
    const checkout = vi.fn(async () => order);
    const createCheckout = vi.fn(async () => ({
      kind: "created" as const,
      paymentId: "2f4b6d0d-000f-5000-9000-000000000701",
      checkoutUrl: "https://yoomoney.ru/checkout/payments/v2/contract",
    }));
    const service = createExpertResidencyService({
      environmentEnabled: true,
      commands: { quote: async () => quote, checkout },
      queries: { ownerUserId: async () => owner.userId },
      reconciliation: {
        settle: vi.fn(),
        reverse: vi.fn(),
        replayHeldReward: vi.fn(),
        releaseExpiredOrders: vi.fn(),
      },
      checkoutProvider: { createCheckout },
    });

    await expect(
      service.checkout(owner, "tariff-1", "checkout-00000001"),
    ).resolves.toEqual({
      id: order.id,
      status: "payment_pending",
      payment: {
        kind: "created",
        paymentId: "2f4b6d0d-000f-5000-9000-000000000701",
        checkoutUrl: "https://yoomoney.ru/checkout/payments/v2/contract",
      },
    });
    expect(createCheckout).toHaveBeenCalledWith({
      orderId: order.id,
      amountMinor: quote.cashMinor,
      currency: "RUB",
      idempotencyKey: "checkout-00000001",
    });
    expect(checkout).toHaveBeenCalledBefore(createCheckout);
  });
});
