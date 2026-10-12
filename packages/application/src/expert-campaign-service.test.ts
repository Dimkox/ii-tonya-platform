import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  createExpertCampaignService,
  type CampaignCheckoutOrder,
} from "./expert-campaign-service.js";
import type { ResidencyTariff } from "./expert-residency-service.js";

const principal = {
  authenticated: true,
  userId: randomUUID(),
  expertId: randomUUID(),
};
const request = {
  tariffVersionId: randomUUID(),
  termMonths: 1 as const,
  idempotencyKey: randomUUID(),
};
const checkout = { quoteId: randomUUID(), idempotencyKey: randomUUID() };
function setup(provider = true) {
  const saved = {
    id: checkout.quoteId,
    userId: principal.userId,
    ...request,
    ruleVersion: "expert_energy_start_v1" as const,
    calculationTimestamp: "2026-10-12T00:00:00.000Z",
    quotedAt: "2026-10-12T00:00:00.000Z",
    expiresAt: "2026-10-12T01:00:00.000Z",
    durationSeconds: 2592000,
    baseMonthlyMinor: "999000",
    discountedMonthlyMinor: "599400",
    monthlyPriceMinor: "599400",
    priceMinor: "599400",
    currency: "RUB" as const,
    energyDiscountBps: 4000,
    startDiscountBps: 0,
    floorApplied: false,
    displayName: "PRO",
    creditCapBps: 3000,
    individualServicesEnabled: true,
    groupEventLimit: 2,
    statisticsLevel: "basic" as const,
    supportPriority: "standard" as const,
  };
  const order: CampaignCheckoutOrder = {
    id: randomUUID(),
    cashMinor: "419580",
    currency: "RUB" as const,
    status: "payment_pending" as const,
  };
  const ports = {
    ownerUserId: vi.fn(async () => principal.userId),
    listActiveTariffs: vi.fn(
      async (): Promise<readonly ResidencyTariff[]> => [],
    ),
    createQuote: vi.fn(async () => saved),
    createCheckoutOrder: vi.fn(async () => order),
  };
  const createCheckout = vi.fn(async () => ({
    kind: "created" as const,
    paymentId: "local-payment",
    checkoutUrl: "https://synthetic.invalid/pay",
  }));
  return {
    ports,
    saved,
    order,
    createCheckout,
    service: createExpertCampaignService({
      environmentEnabled: true,
      ...ports,
      ...(provider ? { checkoutProvider: { createCheckout } } : {}),
    }),
  };
}
describe("saved campaign authority", () => {
  it("labels the eligible monthly tariff as base without presenting a final price", async () => {
    const s = setup();
    const tariff: ResidencyTariff = {
      tariffVersionId: request.tariffVersionId,
      displayName: "PRO",
      priceMinor: "999000",
      currency: "RUB",
      durationSeconds: 2592000,
      commercialPolicyVersion: "expert_residency_v2",
      creditCapBps: 3000,
      individualServicesEnabled: true,
      groupEventLimit: 2,
      statisticsLevel: "basic",
      supportPriority: "standard",
    };
    s.ports.listActiveTariffs.mockResolvedValue([tariff]);
    const { priceMinor: _base, ...facts } = tariff;
    expect(_base).toBe("999000");
    expect(await s.service.listActiveTariffs(principal)).toEqual([
      { ...facts, baseMonthlyMinor: "999000", priceKind: "base" },
    ]);
    expect(s.ports.listActiveTariffs).toHaveBeenCalledWith({
      expertId: principal.expertId,
      limit: 20,
    });
    expect(s.ports.createQuote).not.toHaveBeenCalled();
  });
  it("keeps tariff discovery closed when the durable feature switch denies", async () => {
    const s = setup();
    s.ports.listActiveTariffs.mockRejectedValue(
      Object.assign(new Error("disabled"), {
        code: "EXPERT_CAMPAIGN_DISABLED",
      }),
    );
    expect(await s.service.listActiveTariffs(principal)).toEqual({
      kind: "disabled",
    });
  });
  it("returns immutable quote facts and forwards only server identity and parsed request", async () => {
    const s = setup();
    expect(await s.service.quote(principal, request)).toEqual(s.saved);
    expect(await s.service.quote(principal, request)).toEqual(s.saved);
    expect(s.ports.createQuote).toHaveBeenCalledWith({
      userId: principal.userId,
      ...request,
    });
  });
  it("rejects wrong owner across all commands without effects", async () => {
    const s = setup();
    s.ports.ownerUserId.mockResolvedValue(randomUUID());
    expect(await s.service.quote(principal, request)).toEqual({
      kind: "forbidden",
    });
    expect(await s.service.checkout(principal, checkout)).toEqual({
      kind: "forbidden",
    });
    expect(await s.service.listActiveTariffs(principal)).toEqual({
      kind: "forbidden",
    });
    expect(s.ports.createQuote).not.toHaveBeenCalled();
    expect(s.ports.createCheckoutOrder).not.toHaveBeenCalled();
    expect(s.ports.listActiveTariffs).not.toHaveBeenCalled();
    expect(s.createCheckout).not.toHaveBeenCalled();
  });
  it.each([
    "priceMinor",
    "userId",
    "expertId",
    "calculationTimestamp",
    "cashMinor",
  ])("rejects forged %s before commands", async (field) => {
    const s = setup();
    expect(
      await s.service.quote(principal, { ...request, [field]: "forged" }),
    ).toEqual({ kind: "invalid_request" });
    expect(
      await s.service.checkout(principal, { ...checkout, [field]: "forged" }),
    ).toEqual({ kind: "invalid_request" });
    expect(s.ports.createQuote).not.toHaveBeenCalled();
    expect(s.ports.createCheckoutOrder).not.toHaveBeenCalled();
  });
  it("checks absent payment capability before reserving credit", async () => {
    const s = setup(false);
    expect(await s.service.checkout(principal, checkout)).toEqual({
      kind: "payment_unavailable",
    });
    expect(s.ports.createCheckoutOrder).not.toHaveBeenCalled();
  });
  it("uses saved cash rather than saved offer price and retains command identity", async () => {
    const s = setup();
    await s.service.checkout(principal, checkout);
    await s.service.checkout(principal, checkout);
    expect(s.ports.createCheckoutOrder).toHaveBeenCalledWith({
      userId: principal.userId,
      expertId: principal.expertId,
      ...checkout,
    });
    expect(s.createCheckout).toHaveBeenLastCalledWith({
      orderId: s.order.id,
      amountMinor: "419580",
      currency: "RUB",
      idempotencyKey: checkout.idempotencyKey,
    });
  });
  it.each([
    "settled",
    "failed",
    "expired",
    "refunded",
    "charged_back",
    "quoted",
  ] as const)("preserves %s without provider calls", async (status) => {
    const s = setup();
    s.ports.createCheckoutOrder.mockResolvedValue({ ...s.order, status });
    expect(await s.service.checkout(principal, checkout)).toEqual({
      id: s.order.id,
      status,
    });
    expect(s.createCheckout).not.toHaveBeenCalled();
  });
  it("redacts provider failures and retries the original order/key", async () => {
    const s = setup();
    s.createCheckout.mockRejectedValueOnce(
      new Error("private-provider-detail"),
    );
    expect(await s.service.checkout(principal, checkout)).toEqual({
      kind: "payment_unavailable",
    });
    expect(await s.service.checkout(principal, checkout)).toMatchObject({
      id: s.order.id,
      status: "payment_pending",
      payment: { paymentId: "local-payment" },
    });
    expect(s.createCheckout.mock.calls[0]).toEqual(
      s.createCheckout.mock.calls[1],
    );
  });
  it.each([
    ["EXPERT_CAMPAIGN_OWNER_INELIGIBLE", "forbidden"],
    ["EXPERT_CAMPAIGN_USER_INACTIVE", "forbidden"],
    ["EXPERT_CAMPAIGN_DISABLED", "disabled"],
    ["EXPERT_CAMPAIGN_IDEMPOTENCY_CONFLICT", "command_rejected"],
    ["QUOTE_ALREADY_USED", "command_rejected"],
    ["EXPERT_CAMPAIGN_QUOTE_EXPIRED", "command_rejected"],
    ["EXPERT_CAMPAIGN_STORAGE", "service_unavailable"],
    ["EXPERT_CAMPAIGN_CONTENTION", "service_unavailable"],
    ["23505", "service_unavailable"],
  ])("bounds error %s to %s", async (code, kind) => {
    const s = setup();
    s.ports.createQuote.mockRejectedValueOnce(
      Object.assign(new Error("private SQL details"), { code }),
    );
    expect(await s.service.quote(principal, request)).toEqual({ kind });
  });
  it("denies unauthenticated principals before ownership lookup", async () => {
    const s = setup();
    expect(
      await s.service.checkout(
        { ...principal, authenticated: false },
        checkout,
      ),
    ).toEqual({ kind: "forbidden" });
    expect(s.ports.ownerUserId).not.toHaveBeenCalled();
  });
});
