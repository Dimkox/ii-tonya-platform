import { expect, it, vi } from "vitest";
import { createExpertResidencyLifecycleService } from "./expert-residency-lifecycle-service.js";
const id = "00000000-0000-4000-8000-000000000001",
  quoteId = "00000000-0000-4000-8000-000000000002";
const state = {
  revision: 4,
  status: "active" as const,
  paidUntil: "2026-11-20T00:00:00Z",
  pausedUntil: null as string | null,
  bill: {
    readiness: "ready" as const,
    id,
    cycleEnd: "2026-11-20T00:00:00Z",
    tariffVersionId: id,
    termMonths: 3 as const,
    quoteId,
    quote: {
      id: quoteId,
      priceMinor: "900000",
      currency: "RUB" as const,
      termMonths: 3 as const,
      expiresAt: "2026-11-14T00:00:00Z",
    },
    acceptanceId: null,
    orderId: null,
  },
};
const input = {
  botId: "11",
  botKey: "work",
  telegramUserId: "33",
  chatId: "33",
  updateId: "10",
  requestDigest: "a".repeat(64),
  content: { kind: "text" as const, text: "/residency" },
};
function fixture(mainCheckout?: unknown) {
  const readLifecycle = vi.fn(async () => state as typeof state | null),
    requestPause = vi.fn(async () => ({
      ...state,
      status: "paused" as const,
      pausedUntil: "2026-12-01",
      replay: false,
    })),
    resume = vi.fn(async () => ({
      ...state,
      status: "payment_required" as const,
      replay: false,
    }));
  const invoice = {
    orderId: id,
    quoteId,
    revision: 4,
    priceMinor: "900000",
    cashMinor: "900000",
    currency: "RUB" as const,
    status: "payment_pending",
    paymentDeadline: "2026-11-14T00:00:00Z",
    replay: false,
  };
  const quoteMain = vi.fn(async () => ({
      id: quoteId,
      priceMinor: "900000",
      termMonths: 3 as const,
      expiresAt: "2026-11-14T00:00:00Z",
      revision: 4,
      replay: false,
    })),
    acceptRenewalAndCreateInvoice = vi.fn(async () => invoice),
    createMainInvoice = vi.fn(async () => invoice),
    checkoutBindingForOwner = vi.fn(async () => ({
      orderId: id,
      userId: id,
      expertId: id,
      amountMinor: "900000",
      currency: "RUB" as const,
      providerMode: "test" as const,
      purpose: "main_residency" as const,
      paymentDeadline: invoice.paymentDeadline,
      idempotencyKey: "stable-renewal-key",
    })),
    verifyMainCheckoutForOwner = vi.fn(async () => true);
  const repository = { readLifecycle, requestPause, resume },
    financial = {
      quoteMain,
      acceptRenewalAndCreateInvoice,
      createMainInvoice,
      checkoutBindingForOwner,
      verifyMainCheckoutForOwner,
    };
  const service = createExpertResidencyLifecycleService({
    enabled: true,
    workBotId: "11",
    workBotKey: "work",
    paymentMode: "test",
    repository,
    financial,
    ...(mainCheckout ? { mainCheckout: mainCheckout as never } : {}),
  });
  return { service, ...repository, ...financial };
}
it("reads actual current paid coverage without granting access", async () => {
  const f = fixture();
  expect(await f.service.handleWork(input)).toMatchObject({
    status: "handled",
    text: expect.stringContaining(state.paidUntil),
  });
  expect(f.createMainInvoice).not.toHaveBeenCalled();
});
it("shows immutable provisional renewal price and explicit owner acceptance", async () => {
  const f = fixture();
  const r = await f.service.handleWork({
    ...input,
    content: { kind: "text", text: "/renewal" },
  });
  expect(r).toMatchObject({ text: expect.stringContaining("900000") });
  expect(r).toMatchObject({
    text: expect.stringContaining(`/renewal_accept ${quoteId}`),
  });
  expect(f.acceptRenewalAndCreateInvoice).not.toHaveBeenCalled();
});
it.each([1, 3] as const)(
  "quotes fresh explicit%s-month terms bound to stored bill/revision",
  async (termMonths) => {
    const f = fixture();
    await f.service.handleWork({
      ...input,
      content: { kind: "text", text: `/renewal_quote ${id} ${termMonths}` },
    });
    expect(f.quoteMain).toHaveBeenCalledWith(
      expect.objectContaining({
        requestKey: "11:10",
        renewalBillId: id,
        revision: 4,
        termMonths,
        tariffVersionId: id,
      }),
    );
  },
);
it("accepts and invoices atomically under the original update without a fake second event", async () => {
  const createOrRecover = vi.fn(async () => ({
    kind: "ready",
    orderId: id,
    paymentId: "payment-synthetic",
    url: "https://yoomoney.ru/checkout/synthetic",
  }));
  const f = fixture({ strictFirstSendCancellation: true, createOrRecover });
  const r = await f.service.handleWork({
    ...input,
    content: { kind: "text", text: `/renewal_accept ${quoteId}` },
  });
  expect(f.acceptRenewalAndCreateInvoice).toHaveBeenCalledWith(
    expect.objectContaining({
      quoteId,
      renewalBillId: id,
      revision: 4,
      requestKey: "11:10",
    }),
  );
  expect(f.createMainInvoice).not.toHaveBeenCalled();
  expect(f.verifyMainCheckoutForOwner).toHaveBeenCalledWith(
    expect.objectContaining({
      renewalAcceptedQuoteId: quoteId,
      requestKey: "11:10",
    }),
    id,
    "payment-synthetic",
  );
  expect(r).toMatchObject({
    payment: { status: "ready", url: "https://yoomoney.ru/checkout/synthetic" },
  });
});
it("explicit renewal invoice recovers current bill without accepting a different quote", async () => {
  const f = fixture();
  await f.service.handleWork({
    ...input,
    content: { kind: "text", text: "/renewal_invoice" },
  });
  expect(f.createMainInvoice).toHaveBeenCalledWith(
    expect.objectContaining({
      renewalBillId: id,
      revision: 4,
      requestKey: "11:10",
    }),
  );
  expect(f.acceptRenewalAndCreateInvoice).not.toHaveBeenCalled();
});
it("never silently switches an unavailable three-month term", async () => {
  const f = fixture();
  f.quoteMain.mockRejectedValueOnce(
    Object.assign(new Error("card_main_term_unavailable"), {
      code: "card_main_term_unavailable",
    }),
  );
  const r = await f.service.handleWork({
    ...input,
    content: { kind: "text", text: `/renewal_quote ${id} 3` },
  });
  expect(r).toMatchObject({
    text: expect.stringContaining(`/renewal_quote ${id} 1`),
  });
  expect(f.quoteMain).toHaveBeenCalledOnce();
  expect(f.createMainInvoice).not.toHaveBeenCalled();
});
it("forwards strict civil pause date to DB authority and states paid calendar continues", async () => {
  const f = fixture();
  const r = await f.service.handleWork({
    ...input,
    content: { kind: "text", text: "/pause 2026-12-01" },
  });
  expect(f.requestPause).toHaveBeenCalledWith(
    expect.objectContaining({ returnDate: "2026-12-01", requestKey: "11:10" }),
  );
  expect(r).toMatchObject({ text: expect.stringContaining("не продлевает") });
});
it.each(["2026-02-30", "2026-13-01", "0000-01-01", "2026-1-01"])(
  "rejects malformed pause date %s before DB",
  async (date) => {
    const f = fixture();
    expect(
      await f.service.handleWork({
        ...input,
        content: { kind: "text", text: `/pause ${date}` },
      }),
    ).toEqual({ status: "rejected" });
    expect(f.requestPause).not.toHaveBeenCalled();
  },
);
it("resume without paid entitlement stays payment-required", async () => {
  const f = fixture();
  const r = await f.service.handleWork({
    ...input,
    content: { kind: "text", text: "/resume" },
  });
  expect(r).toMatchObject({
    text: expect.stringContaining("требуется оплата"),
  });
  expect(f.createMainInvoice).not.toHaveBeenCalled();
});
it("same-update pause replay suppresses another notification", async () => {
  const f = fixture();
  f.requestPause.mockResolvedValueOnce({
    ...state,
    status: "paused",
    pausedUntil: "2026-12-01",
    replay: true,
  });
  expect(
    await f.service.handleWork({
      ...input,
      content: { kind: "text", text: "/pause 2026-12-01" },
    }),
  ).toEqual({ status: "duplicate" });
});
it("same-update acceptance replay never repeats provider work", async () => {
  const createOrRecover = vi.fn();
  const f = fixture({ strictFirstSendCancellation: true, createOrRecover });
  f.acceptRenewalAndCreateInvoice.mockResolvedValueOnce({
    ...(await f.createMainInvoice()),
    replay: true,
  });
  expect(
    await f.service.handleWork({
      ...input,
      content: { kind: "text", text: `/renewal_accept ${quoteId}` },
    }),
  ).toEqual({ status: "duplicate" });
  expect(createOrRecover).not.toHaveBeenCalled();
});
it("passes existing card and expert commands through untouched", async () => {
  const f = fixture();
  expect(
    await f.service.handleWork({
      ...input,
      content: { kind: "text", text: "/schedule" },
    }),
  ).toEqual({ status: "unhandled" });
  expect(f.readLifecycle).not.toHaveBeenCalled();
});
it("rejects alternate receiving scope before storage", async () => {
  const f = fixture();
  expect(await f.service.handleWork({ ...input, botId: "22" })).toEqual({
    status: "rejected",
  });
  expect(f.readLifecycle).not.toHaveBeenCalled();
});
it("does not invent a renewal bill when current storage has none", async () => {
  const f = fixture();
  f.readLifecycle.mockResolvedValueOnce({ ...state, bill: null } as never);
  const r = await f.service.handleWork({
    ...input,
    content: { kind: "text", text: "/renewal_invoice" },
  });
  expect(r).toMatchObject({ text: expect.stringContaining("не подготовлен") });
  expect(f.createMainInvoice).not.toHaveBeenCalled();
});
it("fixed service failures never expose private errors", async () => {
  const f = fixture();
  f.readLifecycle.mockRejectedValueOnce(new Error("private-error-data"));
  expect(await f.service.handleWork(input)).toEqual({ status: "unavailable" });
});

it.each([
  "/renewal",
  `/renewal_quote ${id} 1`,
  `/renewal_accept ${quoteId}`,
  "/renewal_invoice",
])("legacy %s respects the real-card migration gate", async (text) => {
  const f = fixture();
  f.readLifecycle.mockResolvedValueOnce({
    ...state,
    bill: { ...state.bill, readiness: "requires_card" },
  } as never);
  const r = await f.service.handleWork({
    ...input,
    content: { kind: "text", text },
  });
  expect(r).toMatchObject({ text: expect.stringContaining("карточк") });
  expect(JSON.stringify(r)).not.toContain("/renewal_quote");
  expect(JSON.stringify(r)).not.toContain("/renewal_accept");
  expect(f.quoteMain).not.toHaveBeenCalled();
  expect(f.acceptRenewalAndCreateInvoice).not.toHaveBeenCalled();
  expect(f.createMainInvoice).not.toHaveBeenCalled();
});
