import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { PublicExpertRecovery } from "./public-expert-recovery.js";
import type { PublicExpertPaymentSnapshot } from "./public-expert-gateway-contracts.js";
import type { YooKassaPayment } from "./contracts.js";
const now = "2027-01-11T12:00:10.000Z";
function fixture() {
  const snapshot: PublicExpertPaymentSnapshot = {
    version: 1,
    requestId: randomUUID(),
    userId: randomUUID(),
    product: "onboarding",
    kind: "onboarding_create",
    legacySourceId: randomUUID(),
    legacyOperationId: randomUUID(),
    mode: "test",
    amountMinor: "300000",
    currency: "RUB",
    idempotencyKey: randomUUID(),
    contactId: randomUUID(),
    parentPaymentId: null,
    requestDigest: `sha256:${"a".repeat(64)}`,
    bodyVersion: 1,
    bodyExpiresAt: "2027-01-11T13:00:00.000Z",
    paymentDeadline: "2027-01-11T14:00:00.000Z",
    providerDeadline: "2027-01-11T14:00:00.000Z",
    createdAt: "2027-01-11T12:00:00.000Z",
    state: "uncertain",
    providerObjectId: null,
    envelope: null,
  };
  const payment: YooKassaPayment = {
    id: "public-payment",
    status: "pending",
    paid: false,
    test: true,
    amount: { value: "3000.00", currency: "RUB" },
    createdAt: "2027-01-11T12:00:01.000Z",
    metadata: {
      purpose: "onboarding",
      order_id: snapshot.legacySourceId,
      operation_id: snapshot.legacyOperationId,
      user_id: snapshot.userId,
    },
    refundable: false,
    confirmation: {
      type: "redirect",
      url: "https://yoomoney.ru/checkout/payments/v2/contract",
    },
  };
  const events: string[] = [];
  let items = [payment],
    complete = true,
    fresh = payment,
    binds = 0,
    observations = 0;
  const deps = {
    binder: {
      candidate: async () => snapshot,
      bind: async () => {
        events.push("bind");
        binds++;
        snapshot.providerObjectId = payment.id;
        snapshot.state = "bound";
        return snapshot;
      },
    },
    observations: {
      observe: async () => {
        events.push("observe");
        observations++;
        return randomUUID();
      },
      resolve: async () => ({ kind: "not_ready" }),
    },
    transport: {
      listPayments: async () => {
        events.push("list");
        return complete
          ? { complete: true as const, items }
          : { complete: false as const, items: [] as const };
      },
      getPayment: async () => {
        events.push("get");
        return fresh;
      },
      listRefunds: async () => ({ complete: true as const, items: [] }),
      getRefund: async () => {
        throw Error("unexpected refund");
      },
      dispatch: async () => {
        throw Error("POST forbidden");
      },
    },
    now: () => now,
  };
  return {
    snapshot,
    payment,
    events,
    deps,
    setItems: (v: YooKassaPayment[]) => {
      items = v;
    },
    setComplete: (v: boolean) => {
      complete = v;
    },
    setFresh: (v: YooKassaPayment) => {
      fresh = v;
    },
    counts: () => ({ binds, observations }),
  };
}
it("binds only after complete LIST, one exact candidate, fresh matching GET; writes only GET facts", async () => {
  const f = fixture();
  const r = await new PublicExpertRecovery(f.deps).recover(
    f.snapshot.requestId,
  );
  expect(r.kind).toBe("observed");
  expect(f.events).toEqual(["list", "get", "bind", "observe"]);
  expect(f.counts()).toEqual({ binds: 1, observations: 1 });
});
it.each([
  "incomplete",
  "empty",
  "ambiguous",
  "wrong-owner",
  "wrong-amount",
  "wrong-mode",
])(
  "retains uncertainty on %s discovery without any POST or binding",
  async (kind) => {
    const f = fixture();
    if (kind === "incomplete") f.setComplete(false);
    if (kind === "empty") f.setItems([]);
    if (kind === "ambiguous")
      f.setItems([f.payment, { ...f.payment, id: "second" }]);
    if (kind === "wrong-owner")
      f.setItems([
        {
          ...f.payment,
          metadata: { ...f.payment.metadata, user_id: randomUUID() },
        },
      ]);
    if (kind === "wrong-amount")
      f.setItems([
        { ...f.payment, amount: { value: "1.00", currency: "RUB" } },
      ]);
    if (kind === "wrong-mode") f.setItems([{ ...f.payment, test: false }]);
    expect(
      (await new PublicExpertRecovery(f.deps).recover(f.snapshot.requestId))
        .kind,
    ).toBe("pending");
    expect(f.counts()).toEqual({ binds: 0, observations: 0 });
    expect(f.events).toEqual(["list"]);
  },
);
it("fresh GET mismatch cannot bind a previously matching LIST candidate", async () => {
  const f = fixture();
  f.setFresh({
    ...f.payment,
    metadata: { ...f.payment.metadata, operation_id: randomUUID() },
  });
  expect(
    (await new PublicExpertRecovery(f.deps).recover(f.snapshot.requestId)).kind,
  ).toBe("pending");
  expect(f.counts()).toEqual({ binds: 0, observations: 0 });
});
it("recovers known parent capture by fresh GET without LIST, receipt decryption or POST", async () => {
  const f = fixture();
  Object.assign(f.snapshot, {
    kind: "onboarding_capture",
    parentPaymentId: f.payment.id,
    providerObjectId: f.payment.id,
    contactId: null,
    bodyExpiresAt: null,
  });
  f.setFresh({
    ...f.payment,
    status: "succeeded",
    paid: true,
    paymentMethodType: "bank_card",
    capturedAt: "2027-01-11T12:00:02.123456Z",
  });
  expect(
    (await new PublicExpertRecovery(f.deps).recover(f.snapshot.requestId)).kind,
  ).toBe("observed");
  expect(f.events).toEqual(["get", "observe"]);
  expect(f.counts()).toEqual({ binds: 0, observations: 1 });
});
it.each(["method", "missing-capture", "before-creation", "future-capture"])(
  "rejects contradictory fresh financial fact %s",
  async (kind) => {
    const f = fixture();
    let fresh = {
      ...f.payment,
      status: "succeeded" as const,
      paid: true,
      paymentMethodType: "bank_card",
      capturedAt: "2027-01-11T12:00:02.123456Z",
    };
    if (kind === "method") fresh = { ...fresh, paymentMethodType: "cash" };
    if (kind === "missing-capture")
      fresh = { ...fresh, capturedAt: undefined! };
    if (kind === "before-creation")
      fresh = { ...fresh, capturedAt: "2027-01-11T11:00:00.000Z" };
    if (kind === "future-capture")
      fresh = { ...fresh, capturedAt: "2027-01-11T13:00:00.000Z" };
    f.setFresh(fresh);
    expect(
      (await new PublicExpertRecovery(f.deps).recover(f.snapshot.requestId))
        .kind,
    ).toBe("pending");
    expect(f.counts()).toEqual({ binds: 0, observations: 0 });
  },
);
