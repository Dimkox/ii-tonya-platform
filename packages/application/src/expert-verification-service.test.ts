import { expect, it, vi } from "vitest";
import { createExpertVerificationService } from "./expert-verification-service.js";
const id = "00000000-0000-4000-8000-000000000001";
const sessionHash = `sha256:${"a".repeat(64)}`;
function fixture(enabled = true) {
  const listQueue = vi.fn(async () => [
    { applicationId: id, status: "pending", quote: null },
  ]);
  const applicationDetail = vi.fn(async () => ({
    applicationId: id,
    userId: id,
    status: "pending",
    contact: [],
    questionnaire: {
      status: "waiting_content",
      contentSlot: "TODO: Wait for Content Spec",
    },
    quote: null,
  }));
  const decide = vi.fn(async () => ({
    applicationId: id,
    decision: "approved" as const,
    invoiceId: id,
    replay: false,
  }));
  const createCheckout = vi.fn(async () => ({
    url: "https://yookassa.ru/checkout/synthetic",
    paymentId: "synthetic-payment",
  }));
  const invoiceForManager = vi.fn(async () => ({
    id,
    operationId: id,
    status: "pending" as const,
    operationStatus: "unknown_outcome" as const,
  }));
  const recoverCheckout = vi.fn(async () => ({
    kind: "ready" as const,
    url: "https://yookassa.ru/checkout/synthetic",
    paymentId: "synthetic-payment",
  }));
  return {
    listQueue,
    applicationDetail,
    decide,
    createCheckout,
    invoiceForManager,
    recoverCheckout,
    service: createExpertVerificationService({
      enabled,
      repository: { listQueue, applicationDetail, decide, invoiceForManager },
    }),
  };
}
it("lists bounded queue using server-resolved session authority", async () => {
  const f = fixture();
  expect(await f.service.list(sessionHash, { limit: 20 })).toMatchObject({
    kind: "ok",
    items: [{ applicationId: id }],
  });
  expect(f.listQueue).toHaveBeenCalledWith(sessionHash, 20);
});
it.each([0, 101, 1.2])(
  "rejects invalid limit%s before storage",
  async (limit) => {
    const f = fixture();
    expect(await f.service.list(sessionHash, { limit })).toEqual({
      kind: "invalid",
    });
    expect(f.listQueue).not.toHaveBeenCalled();
  },
);
it("protects detail identifiers and requires session hash", async () => {
  const f = fixture();
  expect(await f.service.detail("bad", id)).toEqual({ kind: "forbidden" });
  expect(await f.service.detail(sessionHash, "bad")).toEqual({
    kind: "invalid",
  });
  expect(f.applicationDetail).not.toHaveBeenCalled();
});
it("prepares approved invoice honestly when checkout is inactive", async () => {
  const f = fixture();
  expect(
    await f.service.decide(sessionHash, {
      applicationId: id,
      decision: "approved",
      reasonCode: "verified",
      idempotencyKey: "synthetic-key-123",
    }),
  ).toMatchObject({
    kind: "ok",
    invoiceId: id,
    payment: { status: "waiting_configuration" },
  });
});
it("never invokes checkout for rejected decision", async () => {
  const f = fixture();
  f.decide.mockResolvedValueOnce({
    applicationId: id,
    decision: "rejected",
    invoiceId: null,
    replay: false,
  } as never);
  const service = createExpertVerificationService({
    enabled: true,
    repository: f,
    checkout: {
      createCheckout: f.createCheckout,
      recoverCheckout: f.recoverCheckout,
    },
  });
  expect(
    await service.decide(sessionHash, {
      applicationId: id,
      decision: "rejected",
      reasonCode: "credentials_incomplete",
      idempotencyKey: "synthetic-key-123",
    }),
  ).toMatchObject({ kind: "ok", decision: "rejected" });
  expect(f.createCheckout).not.toHaveBeenCalled();
});
it("does not repeat provider checkout for a replayed manager decision", async () => {
  const f = fixture();
  f.decide.mockResolvedValueOnce({
    applicationId: id,
    decision: "approved",
    invoiceId: id,
    replay: true,
  });
  const service = createExpertVerificationService({
    enabled: true,
    repository: f,
    checkout: {
      createCheckout: f.createCheckout,
      recoverCheckout: f.recoverCheckout,
    },
  });
  expect(
    await service.decide(sessionHash, {
      applicationId: id,
      decision: "approved",
      reasonCode: "verified",
      idempotencyKey: "synthetic-key-123",
    }),
  ).toMatchObject({ kind: "ok", replay: true });
  expect(f.createCheckout).not.toHaveBeenCalled();
});
it("bounds storage failures without leaking PII", async () => {
  const f = fixture();
  f.listQueue.mockRejectedValueOnce(new Error("synthetic-pii-secret"));
  expect(await f.service.list(sessionHash, {})).toEqual({
    kind: "unavailable",
  });
});
it("disabled service performs no storage reads", async () => {
  const f = fixture(false);
  expect(await f.service.list(sessionHash, {})).toEqual({ kind: "disabled" });
  expect(f.listQueue).not.toHaveBeenCalled();
});
it("rejects unsolicited amount/owner/purpose authority fields", async () => {
  const f = fixture();
  expect(
    await f.service.decide(sessionHash, {
      applicationId: id,
      decision: "approved",
      reasonCode: "verified",
      idempotencyKey: "synthetic-key-123",
      amountMinor: "1",
    } as never),
  ).toEqual({ kind: "invalid" });
  expect(f.decide).not.toHaveBeenCalled();
});

it("recovers an immutable invoice without repeating manager decision or blind POST", async () => {
  const f = fixture();
  const service = createExpertVerificationService({
    enabled: true,
    repository: f,
    checkout: {
      createCheckout: f.createCheckout,
      recoverCheckout: f.recoverCheckout,
    },
  });
  expect(await service.checkout(sessionHash, id)).toMatchObject({
    kind: "ok",
    payment: { status: "ready" },
  });
  expect(f.invoiceForManager).toHaveBeenCalledWith(sessionHash, id);
  expect(f.recoverCheckout).toHaveBeenCalledWith({
    invoiceId: id,
    operationId: id,
  });
  expect(f.createCheckout).not.toHaveBeenCalled();
  expect(f.decide).not.toHaveBeenCalled();
});
it("does not recover a deleted or unauthorized owner's invoice", async () => {
  const f = fixture();
  f.invoiceForManager.mockResolvedValueOnce(null as never);
  const service = createExpertVerificationService({
    enabled: true,
    repository: f,
    checkout: {
      createCheckout: f.createCheckout,
      recoverCheckout: f.recoverCheckout,
    },
  });
  expect(await service.checkout(sessionHash, id)).toEqual({
    kind: "not_found",
  });
  expect(f.recoverCheckout).not.toHaveBeenCalled();
});

it("accepts YooKassa's documented YooMoney-hosted confirmation page", async () => {
  const f = fixture();
  f.recoverCheckout.mockResolvedValueOnce({
    kind: "ready",
    url: `https://yoomoney.ru/checkout/payments/v2/contract?orderId=${id}`,
    paymentId: "synthetic-payment",
  });
  const service = createExpertVerificationService({
    enabled: true,
    repository: f,
    checkout: {
      createCheckout: f.createCheckout,
      recoverCheckout: f.recoverCheckout,
    },
  });
  expect(await service.checkout(sessionHash, id)).toMatchObject({
    kind: "ok",
    payment: {
      status: "ready",
      url: `https://yoomoney.ru/checkout/payments/v2/contract?orderId=${id}`,
    },
  });
});
it("rejects confirmation URLs outside the approved provider hosts", async () => {
  const f = fixture();
  f.recoverCheckout.mockResolvedValueOnce({
    kind: "ready",
    url: "https://synthetic-untrusted.invalid/pay",
    paymentId: "synthetic-payment",
  });
  const service = createExpertVerificationService({
    enabled: true,
    repository: f,
    checkout: {
      createCheckout: f.createCheckout,
      recoverCheckout: f.recoverCheckout,
    },
  });
  expect(await service.checkout(sessionHash, id)).toEqual({
    kind: "unavailable",
  });
});
