import { expect, it, vi } from "vitest";
import {
  createExpertPersonalOfferRunner,
  renderPersonalOffer,
  formatPersonalOfferMoney,
} from "./expert-personal-offer-service.js";
const row = { scheduleId: "schedule", quoteId: "quote" };
const binding = {
  orderId: "order",
  userId: "user",
  expertId: "expert",
  amountMinor: "540000",
  currency: "RUB" as const,
  providerMode: "test" as const,
  purpose: "main_residency" as const,
  paymentDeadline: "2026-10-24",
  idempotencyKey: "stored",
};
const setup = () => ({
  repository: {
    refreshDue: vi.fn(async () => [row]),
    recordLink: vi.fn(async () => true),
  },
  financial: {
    createScheduledMainInvoice: vi.fn(async () => ({
      orderId: "order",
      cashMinor: "540000",
      currency: "RUB" as const,
      status: "payment_pending",
    })),
    checkoutBindingForSchedule: vi.fn(async () => binding),
    verifyMainCheckoutForSchedule: vi.fn(async () => true),
  },
  mainCheckout: {
    strictFirstSendCancellation: true as const,
    createOrRecover: vi.fn(async () => ({
      kind: "ready" as const,
      orderId: "order",
      paymentId: "payment",
      url: "https://pay.yookassa.ru/payment",
    })),
  },
});
it("reprices before verification without issuing an early main link", async () => {
  const s = setup();
  s.financial.createScheduledMainInvoice.mockRejectedValue(
    new Error("gate not ready"),
  );
  expect(
    await createExpertPersonalOfferRunner({ enabled: true, ...s }).runOnce(),
  ).toEqual({ refreshed: 1, links: 0 });
  expect(s.repository.refreshDue).toHaveBeenCalledWith(10);
  expect(s.mainCheckout.createOrRecover).not.toHaveBeenCalled();
});
it("recovers stored schedule binding and persists only reverified payment", async () => {
  const s = setup();
  expect(
    await createExpertPersonalOfferRunner({ enabled: true, ...s }).runOnce(),
  ).toEqual({ refreshed: 1, links: 1 });
  expect(s.financial.createScheduledMainInvoice).toHaveBeenCalledWith(
    "schedule",
    "quote",
  );
  expect(s.repository.recordLink).toHaveBeenCalledWith({
    ...row,
    orderId: "order",
    paymentId: "payment",
    url: "https://pay.yookassa.ru/payment",
  });
});
it("does not deliver a changed or expired binding", async () => {
  const s = setup();
  s.financial.verifyMainCheckoutForSchedule.mockResolvedValue(false);
  expect(
    (await createExpertPersonalOfferRunner({ enabled: true, ...s }).runOnce())
      .links,
  ).toBe(0);
  expect(s.repository.recordLink).not.toHaveBeenCalled();
});
it("stops without repricing or provider calls when disabled or closing", async () => {
  const s = setup();
  const r = createExpertPersonalOfferRunner({ enabled: false, ...s });
  await r.runOnce();
  r.stopAccepting();
  await r.runOnce();
  expect(s.repository.refreshDue).not.toHaveBeenCalled();
});
it("renders both stored prices and explicit package expiry without a manual calculator", () => {
  const text = renderPersonalOffer({
    offer_start_date: "2026-10-23",
    current_discount_stage: 3,
    discount_percent: 20,
    locked_price_monthly: "720000",
    locked_price_package: null,
    payment_link_expires_at: "2026-10-24",
    remaining_seconds: 3600,
    readiness: "select_one_month",
    payment_url: null,
  });
  expect(text).toContain("7 200 ₽");
  expect(text).toContain("Выберите один месяц явно");
  expect(text).not.toContain("Оплатить:");
});

it.each([
  ["540000", "5 400 ₽"],
  ["540001", "5 400,01 ₽"],
  ["540050", "5 400,50 ₽"],
  ["1528470", "15 284,70 ₽"],
])("formats integer kopecks %s as user rubles", (minor, expected) => {
  expect(formatPersonalOfferMoney(minor)).toBe(expected);
});
