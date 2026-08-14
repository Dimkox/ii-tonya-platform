import { describe, expect, it, vi } from "vitest";
import type { ExpertResidencyCheckoutCommand } from "@ii-tonya/contracts";
import {
  YooKassaTerminalError,
  YooKassaUnknownOutcomeError,
  type YooKassaClient,
} from "./client.js";
import type {
  YooKassaOperation,
  YooKassaOperationPort,
  YooKassaReceiptContactPort,
} from "./operation-port.js";
import { YooKassaExpertResidencyPaymentAdapter } from "./payment-adapter.js";

const checkout: ExpertResidencyCheckoutCommand = {
  orderId: "00000000-0000-4000-8000-000000000401",
  amountMinor: "50000",
  currency: "RUB",
  idempotencyKey: "checkout-00000001",
};

const operation: YooKassaOperation = {
  id: "00000000-0000-4000-8000-000000000402",
  orderId: checkout.orderId,
  paymentAttemptId: "00000000-0000-4000-8000-000000000403",
  kind: "create_payment",
  mode: "test",
  amountMinor: checkout.amountMinor,
  currency: "RUB",
  requestDigest: `sha256:${"d".repeat(64)}`,
  idempotencyKey: "00000000-0000-4000-8000-000000000404",
  status: "claimed",
};

const payment = {
  id: "2f4b6d0d-000f-5000-9000-000000000401",
  status: "pending" as const,
  paid: false,
  amount: { value: "500.00", currency: "RUB" as const },
  test: true,
  createdAt: "2026-08-14T10:00:00.000Z",
  metadata: { order_id: checkout.orderId },
  confirmation: {
    type: "redirect" as const,
    url: "https://yoomoney.ru/checkout/payments/v2/contract",
  },
  refundable: false,
};

const operationPort = (): YooKassaOperationPort => ({
  findByProviderObject: vi.fn(async () => null),
  claim: vi.fn(async () => operation),
  bindProviderObject: vi.fn(async (_id, providerObjectId) => ({
    ...operation,
    providerObjectId,
    status: "pending",
  })),
  markUnknown: vi.fn(async () => undefined),
  resolve: vi.fn(async () => undefined),
  claimReconciliationBatch: vi.fn(async () => []),
});

const client = (): YooKassaClient => ({
  createPayment: vi.fn(async () => payment),
  getPayment: vi.fn(async () => payment),
  createRefund: vi.fn(async () => {
    throw new Error("unused");
  }),
  getRefund: vi.fn(async () => {
    throw new Error("unused");
  }),
});

const contacts = (
  available = true,
  contact: {
    readonly email?: string;
    readonly phone?: string;
    readonly authorityReference?: string;
  } = { email: "fixture@example.invalid" },
): YooKassaReceiptContactPort => ({
  receiptContactForOrder: vi.fn(async () => (available ? contact : null)),
});

describe("YooKassaExpertResidencyPaymentAdapter", () => {
  it("claims before POST and returns only the bound redirect", async () => {
    const operations = operationPort();
    const provider = client();
    const adapter = new YooKassaExpertResidencyPaymentAdapter({
      client: provider,
      operations,
      contacts: contacts(),
      mode: "test",
      returnUrl: "https://ii-tonya.ru/payments/return",
      receipt: {
        vatCode: 1,
        paymentSubject: "service",
        paymentMode: "full_payment",
      },
    });

    await expect(adapter.createCheckout(checkout)).resolves.toEqual({
      kind: "created",
      paymentId: payment.id,
      checkoutUrl: payment.confirmation.url,
    });
    expect(operations.claim).toHaveBeenCalledBefore(
      provider.createPayment as ReturnType<typeof vi.fn>,
    );
    expect(operations.bindProviderObject).toHaveBeenCalledWith(
      operation.id,
      payment.id,
    );
  });

  it("fails before network when the server-owned receipt contact is absent", async () => {
    const provider = client();
    const adapter = new YooKassaExpertResidencyPaymentAdapter({
      client: provider,
      operations: operationPort(),
      contacts: contacts(false),
      mode: "test",
      returnUrl: "https://ii-tonya.ru/payments/return",
      receipt: {
        vatCode: 1,
        paymentSubject: "service",
        paymentMode: "full_payment",
      },
    });
    await expect(adapter.createCheckout(checkout)).rejects.toThrow(
      "yookassa_receipt_contact_unavailable",
    );
    expect(provider.createPayment).not.toHaveBeenCalled();
  });

  it("creates a refund from a durable command and returns only its provider ID", async () => {
    const operations = operationPort();
    const provider = client();
    provider.createRefund = vi.fn(async () => ({
      id: "2f4b6d0d-000f-5000-9000-000000000499",
      paymentId: payment.id,
      status: "pending",
      amount: { value: "100.00", currency: "RUB" },
      createdAt: "2026-08-14T10:00:00.000Z",
    }));
    const adapter = new YooKassaExpertResidencyPaymentAdapter({
      client: provider,
      operations,
      contacts: contacts(),
      mode: "test",
      returnUrl: "https://ii-tonya.ru/payments/return",
      receipt: {
        vatCode: 1,
        paymentSubject: "service",
        paymentMode: "full_payment",
      },
    });

    await expect(
      adapter.refund({
        orderId: checkout.orderId,
        paymentId: payment.id,
        amountMinor: "10000",
        currency: "RUB",
        idempotencyKey: "refund-00000001",
      }),
    ).resolves.toEqual({
      kind: "pending",
      refundId: "2f4b6d0d-000f-5000-9000-000000000499",
    });
  });

  it("marks terminal refund rejection failed and permits a later refund", async () => {
    const operations = operationPort();
    const provider = client();
    provider.createRefund = vi
      .fn()
      .mockRejectedValueOnce(new YooKassaTerminalError("yookassa_http_400"))
      .mockResolvedValueOnce({
        id: "refund-valid",
        paymentId: payment.id,
        status: "pending",
        amount: { value: "100.00", currency: "RUB" },
        createdAt: "2026-08-14T10:00:00.000Z",
      });
    const adapter = new YooKassaExpertResidencyPaymentAdapter({
      client: provider,
      operations,
      contacts: contacts(),
      mode: "test",
      returnUrl: "https://ii-tonya.ru/payments/return",
      receipt: {
        vatCode: 1,
        paymentSubject: "service",
        paymentMode: "full_payment",
      },
    });
    const refund = {
      orderId: checkout.orderId,
      paymentId: payment.id,
      amountMinor: "10000",
      currency: "RUB" as const,
      idempotencyKey: "refund-terminal-1",
    };

    await expect(adapter.refund(refund)).rejects.toMatchObject({
      code: "yookassa_http_400",
    });
    expect(operations.resolve).toHaveBeenCalledWith(operation.id, "failed");
    await expect(
      adapter.refund({ ...refund, idempotencyKey: "refund-valid-2" }),
    ).resolves.toMatchObject({ kind: "pending" });
  });

  it.each([
    new YooKassaUnknownOutcomeError(),
    new YooKassaTerminalError("yookassa_refund_binding_mismatch"),
    new Error("provider_binding_ambiguous"),
  ])("keeps ambiguous refund failure unknown", async (failure) => {
    const operations = operationPort();
    const provider = client();
    provider.createRefund = vi.fn(async () => {
      throw failure;
    });
    const adapter = new YooKassaExpertResidencyPaymentAdapter({
      client: provider,
      operations,
      contacts: contacts(),
      mode: "test",
      returnUrl: "https://ii-tonya.ru/payments/return",
      receipt: {
        vatCode: 1,
        paymentSubject: "service",
        paymentMode: "full_payment",
      },
    });

    await expect(
      adapter.refund({
        orderId: checkout.orderId,
        paymentId: payment.id,
        amountMinor: "10000",
        currency: "RUB",
        idempotencyKey: "refund-ambiguous-1",
      }),
    ).rejects.toBe(failure);
    expect(operations.markUnknown).toHaveBeenCalledWith(operation.id);
    expect(operations.resolve).not.toHaveBeenCalled();
  });

  it("persists a versioned digest without raw receipt contact PII", async () => {
    const emailOperations = operationPort();
    const otherEmailOperations = operationPort();
    const otherAuthorityOperations = operationPort();
    const fallbackEmailOperations = operationPort();
    const otherFallbackEmailOperations = operationPort();
    const phoneOperations = operationPort();
    const makeAdapter = (
      operations: YooKassaOperationPort,
      contact: {
        readonly email?: string;
        readonly phone?: string;
        readonly authorityReference?: string;
      },
    ) =>
      new YooKassaExpertResidencyPaymentAdapter({
        client: client(),
        operations,
        contacts: contacts(true, contact),
        mode: "test",
        returnUrl: "https://ii-tonya.ru/payments/return",
        receipt: {
          vatCode: 1,
          paymentSubject: "service",
          paymentMode: "full_payment",
        },
      });

    await makeAdapter(emailOperations, {
      email: "first.secret@example.invalid",
      authorityReference: "consent:customer-401",
    }).createCheckout(checkout);
    await makeAdapter(otherEmailOperations, {
      email: "other.secret@example.invalid",
      authorityReference: "consent:customer-401",
    }).createCheckout(checkout);
    await makeAdapter(otherAuthorityOperations, {
      email: "first.secret@example.invalid",
      authorityReference: "consent:customer-402",
    }).createCheckout(checkout);
    await makeAdapter(fallbackEmailOperations, {
      email: "fallback-one@example.invalid",
    }).createCheckout(checkout);
    await makeAdapter(otherFallbackEmailOperations, {
      email: "fallback-two@example.invalid",
    }).createCheckout(checkout);
    await makeAdapter(phoneOperations, {
      phone: "+79990000000",
      authorityReference: "consent:customer-401",
    }).createCheckout(checkout);

    const emailClaim = vi.mocked(emailOperations.claim).mock.calls[0]?.[0];
    const otherEmailClaim = vi.mocked(otherEmailOperations.claim).mock
      .calls[0]?.[0];
    const otherAuthorityClaim = vi.mocked(otherAuthorityOperations.claim).mock
      .calls[0]?.[0];
    const fallbackEmailClaim = vi.mocked(fallbackEmailOperations.claim).mock
      .calls[0]?.[0];
    const otherFallbackEmailClaim = vi.mocked(
      otherFallbackEmailOperations.claim,
    ).mock.calls[0]?.[0];
    const phoneClaim = vi.mocked(phoneOperations.claim).mock.calls[0]?.[0];
    expect(emailClaim?.requestDigest).toMatch(/^sha256:[0-9a-f]{64}$/u);
    expect(phoneClaim?.requestDigest).toMatch(/^sha256:[0-9a-f]{64}$/u);
    expect(JSON.stringify(emailClaim)).not.toContain(
      "first.secret@example.invalid",
    );
    expect(JSON.stringify(otherEmailClaim)).not.toContain(
      "other.secret@example.invalid",
    );
    expect(JSON.stringify(phoneClaim)).not.toContain("+79990000000");
    expect(JSON.stringify(fallbackEmailClaim)).not.toContain(
      "fallback-one@example.invalid",
    );
    expect(emailClaim?.requestDigest).toBe(otherEmailClaim?.requestDigest);
    expect(emailClaim?.requestDigest).not.toBe(
      otherAuthorityClaim?.requestDigest,
    );
    expect(fallbackEmailClaim?.requestDigest).toBe(
      otherFallbackEmailClaim?.requestDigest,
    );
    expect(emailClaim?.requestDigest).not.toBe(phoneClaim?.requestDigest);
  });
});
