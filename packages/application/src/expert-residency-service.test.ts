import { describe, expect, it } from "vitest";
import { createExpertResidencyService } from "./expert-residency-service.js";
import { expertResidencyFixture } from "./expert-residency-service.testkit.js";

describe("expert residency application boundary", () => {
  it("returns a server-derived owner quote and forbids another principal", async () => {
    const fixture = expertResidencyFixture();
    const service = createExpertResidencyService(fixture);

    await expect(service.quote(fixture.owner, "annual-v1")).resolves.toEqual({
      tariffVersionId: "annual-v1",
      displayName: "Expert residency",
      description: "One year",
      priceMinor: "200000",
      currency: "RUB",
      durationSeconds: 31_536_000,
      creditMinor: "100000",
      cashMinor: "100000",
    });
    await expect(service.quote(fixture.other, "annual-v1")).resolves.toEqual({
      kind: "forbidden",
    });
    expect(fixture.quoteCount()).toBe(1);
  });

  it("requires the billing environment ceiling before quote or checkout", async () => {
    const fixture = expertResidencyFixture({ billingEnabled: false });
    const service = createExpertResidencyService(fixture);

    await expect(service.quote(fixture.owner, "annual-v1")).resolves.toEqual({
      kind: "disabled",
    });
    await expect(
      service.checkout(fixture.owner, {
        tariffKey: "annual-v1",
        idempotencyKey: "checkout_811",
        providerDeadline: new Date("2026-08-03T00:30:00.000Z"),
      }),
    ).resolves.toEqual({ kind: "disabled" });
    expect(fixture.controlReadCount()).toBe(0);
    expect(fixture.quoteCount()).toBe(0);
    expect(fixture.checkoutCount()).toBe(0);
  });

  it("observes durable command-switch changes without a process cache", async () => {
    const fixture = expertResidencyFixture();
    const service = createExpertResidencyService(fixture);

    await expect(
      service.quote(fixture.owner, "annual-v1"),
    ).resolves.toMatchObject({ priceMinor: "200000" });
    fixture.setNewCommandsEnabled(false);
    await expect(service.quote(fixture.owner, "annual-v1")).resolves.toEqual({
      kind: "disabled",
    });
    fixture.setNewCommandsEnabled(true);
    await expect(
      service.quote(fixture.owner, "annual-v1"),
    ).resolves.toMatchObject({ cashMinor: "100000" });

    expect(fixture.controlReadCount()).toBe(3);
    expect(fixture.quoteCount()).toBe(2);
  });

  it("builds checkout payment input only from the committed order", async () => {
    const fixture = expertResidencyFixture();
    const service = createExpertResidencyService(fixture);

    await expect(
      service.checkout(fixture.owner, {
        tariffKey: "annual-v1",
        idempotencyKey: "checkout_811",
        providerDeadline: new Date("2026-08-03T00:30:00.000Z"),
      }),
    ).resolves.toMatchObject({
      kind: "checkout_created",
      order: {
        priceMinor: "200000",
        creditMinor: "100000",
        cashMinor: "100000",
      },
      payment: { kind: "created", paymentId: "pay_811" },
    });
    expect(fixture.existingStateOperations()).toContain("payment:100000");
  });

  it("fails closed before payment when the committed order owner mismatches", async () => {
    const fixture = expertResidencyFixture();
    const createCheckoutOrder = fixture.orders.createCheckoutOrder.bind(
      fixture.orders,
    );
    const service = createExpertResidencyService({
      ...fixture,
      orders: {
        ...fixture.orders,
        async createCheckoutOrder(command) {
          const order = await createCheckoutOrder(command);
          return { ...order, expertId: fixture.other.expertId };
        },
      },
    });

    await expect(
      service.checkout(fixture.owner, {
        tariffKey: "annual-v1",
        idempotencyKey: "checkout_wrong_owner",
        providerDeadline: new Date("2026-08-03T00:30:00.000Z"),
      }),
    ).rejects.toThrow("expert_residency_order_ownership_mismatch");
    expect(fixture.existingStateOperations()).not.toContain("payment:100000");
  });

  it("keeps verified settlement and refund processing callable while ceilings are off", async () => {
    const fixture = expertResidencyFixture({ billingEnabled: false });
    fixture.setNewCommandsEnabled(false);
    const service = createExpertResidencyService(fixture);

    await expect(service.settle(fixture.settledEvent)).resolves.toEqual({
      kind: "settled",
    });
    await expect(service.refund(fixture.refundEvent)).resolves.toEqual({
      kind: "refunded",
    });
    expect(fixture.existingStateOperations()).toEqual(["settle", "refund"]);
    expect(fixture.controlReadCount()).toBe(0);
  });

  it("keeps reconciliation, release, reversal, and held replay callable while ceilings are off", async () => {
    const fixture = expertResidencyFixture({ billingEnabled: false });
    fixture.setNewCommandsEnabled(false);
    const service = createExpertResidencyService(fixture);

    await expect(service.reconcile("pay_811")).resolves.toEqual({
      kind: "settled",
    });
    await expect(
      service.releaseExpiredOrder({ orderId: "order_811" }),
    ).resolves.toEqual({ kind: "expired", released: true });
    await expect(
      service.reverseReward({
        grantId: "grant_811",
        inviterExpertId: fixture.owner.expertId,
        reversedAt: new Date("2026-08-03T00:00:00.000Z"),
      }),
    ).resolves.toMatchObject({ rewardReversed: true });
    await expect(
      service.replayHeldReward({
        expertId: fixture.owner.expertId,
        qualifyingOrderId: "order_811",
      }),
    ).resolves.toEqual({
      kind: "reward_granted",
      amountMinor: "100000",
    });
    expect(fixture.controlReadCount()).toBe(0);
    expect(fixture.existingStateOperations()).toEqual([
      "reconcile:pay_811",
      "settle",
      "release",
      "reverse",
      "replay",
    ]);
  });
});
