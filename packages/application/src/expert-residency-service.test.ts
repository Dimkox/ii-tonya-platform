import { describe, expect, it, vi } from "vitest";
import { createExpertResidencyService } from "./expert-residency-service.js";
import { owner } from "./expert-referral-service.testkit.js";
import { quote } from "./expert-residency-service.testkit.js";

describe("expert residency service", () => {
  it.each([
    ["START", "390000", 0, "basic", "standard"],
    ["BASE", "590000", 1, "expanded", "standard"],
    ["PRO", "999000", 3, "expanded", "priority"],
  ])(
    "exposes authoritative V2 facts for %s",
    async (
      _key,
      priceMinor,
      groupEventLimit,
      statisticsLevel,
      supportPriority,
    ) => {
      const tariff = {
        tariffVersionId: `00000000-0000-4000-8000-00000000010${groupEventLimit}`,
        displayName: String(_key),
        priceMinor,
        currency: "RUB" as const,
        durationSeconds: 2_592_000,
        commercialPolicyVersion: "expert_residency_v2" as const,
        creditCapBps: 3000,
        individualServicesEnabled: true,
        groupEventLimit,
        statisticsLevel,
        supportPriority,
      };
      const service = createExpertResidencyService({
        environmentEnabled: true,
        commands: {
          listActiveTariffs: async () => [tariff],
          quote: async () => ({
            ...tariff,
            creditMinor: "117000",
            cashMinor: "273000",
          }),
          checkout: vi.fn(),
        },
        queries: { ownerUserId: async () => owner.userId },
        reconciliation: {
          settle: vi.fn(),
          reverse: vi.fn(),
          replayHeldReward: vi.fn(),
          releaseExpiredOrders: vi.fn(),
        },
      });
      await expect(service.listActiveTariffs(owner)).resolves.toEqual([tariff]);
      await expect(
        service.quote(owner, tariff.tariffVersionId),
      ).resolves.toMatchObject(tariff);
    },
  );
  it("reauthorizes ownership before returning the bounded authoritative tariff list", async () => {
    const listActiveTariffs = vi.fn(async () => [
      {
        tariffVersionId: "00000000-0000-4000-8000-000000000101",
        displayName: "Резидентство на месяц",
        priceMinor: "200000",
        currency: "RUB" as const,
        durationSeconds: 2_592_000,
      },
    ]);
    const dependencies = {
      environmentEnabled: true,
      commands: {
        quote: async () => quote,
        checkout: vi.fn(),
        listActiveTariffs,
      },
      queries: { ownerUserId: vi.fn(async () => owner.userId) },
      reconciliation: {
        settle: vi.fn(),
        reverse: vi.fn(),
        replayHeldReward: vi.fn(),
        releaseExpiredOrders: vi.fn(),
      },
    };

    await expect(
      createExpertResidencyService(dependencies).listActiveTariffs(owner),
    ).resolves.toEqual([
      {
        tariffVersionId: "00000000-0000-4000-8000-000000000101",
        displayName: "Резидентство на месяц",
        priceMinor: "200000",
        currency: "RUB",
        durationSeconds: 2_592_000,
      },
    ]);
    expect(dependencies.queries.ownerUserId).toHaveBeenCalledWith(
      owner.expertId,
    );
    expect(listActiveTariffs).toHaveBeenCalledWith({
      expertId: owner.expertId,
      limit: 20,
    });

    const foreign = createExpertResidencyService({
      ...dependencies,
      queries: { ownerUserId: vi.fn(async () => "another-user") },
    });
    await expect(foreign.listActiveTariffs(owner)).resolves.toEqual({
      kind: "forbidden",
    });
    expect(listActiveTariffs).toHaveBeenCalledTimes(1);

    const disabled = createExpertResidencyService({
      ...dependencies,
      environmentEnabled: false,
    });
    await expect(disabled.listActiveTariffs(owner)).resolves.toEqual({
      kind: "disabled",
    });
    expect(listActiveTariffs).toHaveBeenCalledTimes(1);
  });

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
      commands: {
        listActiveTariffs: vi.fn(async () => []),
        quote: async () => quote,
        checkout: vi.fn(),
      },
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
      commands: {
        listActiveTariffs: vi.fn(async () => []),
        quote: async () => quote,
        checkout,
      },
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
