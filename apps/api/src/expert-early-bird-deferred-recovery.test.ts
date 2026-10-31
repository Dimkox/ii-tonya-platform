import { expect, it, vi } from "vitest";
import { EarlyBirdDeferredRecovery } from "./expert-early-bird-deferred-recovery.js";

it("recovers only a bound payment for the scoped user after fresh provider checks", async () => {
  const userId = crypto.randomUUID(),
    invoiceId = crypto.randomUUID(),
    grantId = crypto.randomUUID();
  const scope = {
    botId: "bot",
    botKey: "bot",
    telegramUserId: "1",
    chatId: "1",
    offerId: crypto.randomUUID(),
    choiceId: crypto.randomUUID(),
    accountId: crypto.randomUUID(),
  };
  const metadata = {
    order_id: invoiceId,
    operation_id: invoiceId,
    user_id: userId,
    purpose: "early_bird_deferred",
    stage: "subscription",
    pricing_policy: "owner_test_10_20_v1",
    pricing_grant_id: grantId,
  };
  const getPayment = vi.fn().mockResolvedValue({
    id: "pay1",
    status: "pending",
    paid: false,
    test: false,
    amount: { value: "20.00", currency: "RUB" },
    metadata,
    confirmation: { url: "https://yoomoney.ru/checkout" },
  });
  const resolver = { resolve: vi.fn().mockResolvedValue({ userId }) },
    bound = {
      find: vi
        .fn()
        .mockResolvedValue({ userId, invoiceId, providerId: "pay1" }),
    },
    verifier = {
      verify: vi.fn().mockResolvedValue({
        invoiceId,
        operationId: invoiceId,
        userId,
        providerId: "pay1",
        amountMinor: "2000",
        mode: "live",
        stage: "subscription",
        policy: "owner_test_10_20_v1",
        grantId,
      }),
    };
  const recovery = new EarlyBirdDeferredRecovery(
    resolver as never,
    bound as never,
    verifier as never,
    { getPayment } as never,
  );
  expect(await recovery.find(scope, invoiceId)).toEqual({
    kind: "ready",
    invoiceId,
    paymentId: "pay1",
    confirmationUrl: "https://yoomoney.ru/checkout",
  });
  expect(verifier.verify).toHaveBeenCalledOnce();
  bound.find.mockResolvedValue({
    userId: crypto.randomUUID(),
    invoiceId,
    providerId: "pay1",
  });
  expect(await recovery.find(scope, invoiceId)).toEqual({
    kind: "unavailable",
  });
  expect(getPayment).toHaveBeenCalledOnce();
});

it("recovers an unbound dispatch through bounded LIST and fresh verification/binding without another POST", async () => {
  const invoiceId = crypto.randomUUID(),
    userId = crypto.randomUUID();
  const scope = { accountId: crypto.randomUUID() } as never;
  const proof = {
    invoiceId,
    operationId: invoiceId,
    userId,
    providerId: "pay1",
    amountMinor: "2000",
    mode: "live",
    stage: "subscription",
    policy: "wave1_standard_v1",
    grantId: null,
  };
  const payment = {
    id: "pay1",
    createdAt: "2026-11-01T12:00:00Z",
    status: "pending",
    paid: false,
    test: false,
    amount: { value: "20.00", currency: "RUB" },
    metadata: {
      order_id: invoiceId,
      operation_id: invoiceId,
      user_id: userId,
      purpose: "early_bird_deferred",
      stage: "subscription",
      pricing_policy: "wave1_standard_v1",
    },
    confirmation: { url: "https://yoomoney.ru/checkout" },
  };
  const bind = vi.fn().mockResolvedValue(undefined),
    listPayments = vi.fn().mockResolvedValue({
      items: [
        {
          id: "pay1",
          createdAt: payment.createdAt,
          test: false,
          metadata: payment.metadata,
        },
      ],
    }),
    verify = vi.fn().mockResolvedValue(proof);
  const recovery = new EarlyBirdDeferredRecovery(
    { resolve: async () => ({ userId }) } as never,
    { find: async () => null } as never,
    { verify } as never,
    { getPayment: async () => payment } as never,
    {
      source: {
        read: async () => ({
          kind: "unknown",
          createdFrom: "2026-11-01T11:55:00Z",
          createdBefore: "2026-11-02T11:55:00Z",
        }),
      },
      listPayments,
      bind,
    },
  );
  expect(await recovery.find(scope, invoiceId)).toMatchObject({
    kind: "ready",
    paymentId: "pay1",
  });
  expect(bind).toHaveBeenCalledWith(proof);
  expect(listPayments).toHaveBeenCalledWith({
    createdFrom: "2026-11-01T11:55:00Z",
    createdTo: "2026-11-02T11:55:00Z",
    limit: 100,
  });
  listPayments.mockResolvedValue({ items: [] });
  expect(await recovery.find(scope, invoiceId)).toEqual({
    kind: "reconcile",
    invoiceId,
  });
  expect(bind).toHaveBeenCalledTimes(1);
});

it("permits initial preparation only for a scoped invoice with no dispatch marker", async () => {
  const invoiceId = crypto.randomUUID(),
    userId = crypto.randomUUID();
  const read = vi.fn().mockResolvedValue({ kind: "not_dispatched" }),
    listPayments = vi.fn(),
    bind = vi.fn(),
    verify = vi.fn();
  const recovery = new EarlyBirdDeferredRecovery(
    { resolve: async () => ({ userId }) } as never,
    { find: async () => null } as never,
    { verify } as never,
    { getPayment: vi.fn() } as never,
    { source: { read }, listPayments, bind },
  );
  expect(await recovery.find({} as never, invoiceId)).toBeNull();
  read.mockResolvedValue({ kind: "unavailable" });
  expect(await recovery.find({} as never, invoiceId)).toEqual({
    kind: "unavailable",
  });
  expect(listPayments).not.toHaveBeenCalled();
  expect(bind).not.toHaveBeenCalled();
  expect(verify).not.toHaveBeenCalled();
});
it("keeps ambiguous or truncated unknown discovery in reconciliation without binding", async () => {
  const invoiceId = crypto.randomUUID(),
    userId = crypto.randomUUID();
  const candidate = {
    id: "pay1",
    createdAt: "2026-11-01T12:00:00Z",
    test: false,
    metadata: { order_id: invoiceId, operation_id: invoiceId },
  };
  const listPayments = vi
      .fn()
      .mockResolvedValue({ items: [candidate, { ...candidate, id: "pay2" }] }),
    bind = vi.fn(),
    verify = vi.fn();
  const recovery = new EarlyBirdDeferredRecovery(
    { resolve: async () => ({ userId }) } as never,
    { find: async () => null } as never,
    { verify } as never,
    { getPayment: vi.fn() } as never,
    {
      source: {
        read: async () => ({
          kind: "unknown",
          createdFrom: "2026-11-01T11:55:00Z",
          createdBefore: "2026-11-02T11:55:00Z",
        }),
      },
      listPayments,
      bind,
    },
  );
  expect(await recovery.find({} as never, invoiceId)).toEqual({
    kind: "reconcile",
    invoiceId,
  });
  listPayments
    .mockReset()
    .mockResolvedValueOnce({ items: [candidate], nextCursor: "page1" })
    .mockResolvedValueOnce({ items: [], nextCursor: "page2" })
    .mockResolvedValueOnce({ items: [], nextCursor: "page3" });
  expect(await recovery.find({} as never, invoiceId)).toEqual({
    kind: "reconcile",
    invoiceId,
  });
  expect(listPayments).toHaveBeenCalledTimes(3);
  expect(verify).not.toHaveBeenCalled();
  expect(bind).not.toHaveBeenCalled();
});
