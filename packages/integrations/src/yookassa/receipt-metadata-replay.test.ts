import { describe, expect, it, vi } from "vitest";
import { createYooKassaClient } from "./client.js";
import { createPayerReceiptSource } from "./payer-receipt-source.js";
import { YooKassaExpertResidencyPaymentAdapter } from "./payment-adapter.js";
import type {
  ClaimYooKassaOperationCommand,
  YooKassaOperation,
  YooKassaOperationPort,
  YooKassaReceiptContact,
  YooKassaReceiptContactPort,
} from "./operation-port.js";

const checkout = {
  orderId: "00000000-0000-4000-8000-000000000901",
  amountMinor: "50000",
  currency: "RUB" as const,
  idempotencyKey: "metadata-replay-checkout",
};
const reference = "payer-receipt:00000000-0000-4000-8000-000000000905";
// Fixed fixtures from the pre-change v1 JSON byte layout, including property order.
const digests = {
  email:
    "sha256:7b678048fd9824e2240dcbadd2aad7f436063931f9a11c32414cb204f8b66cb1",
  phone:
    "sha256:87aaf7bcc789bccc458eb66ba167ee9e25a200d42c720b2726fb7f4121052d6b",
};
const initial: YooKassaOperation = {
  id: "00000000-0000-4000-8000-000000000902",
  orderId: checkout.orderId,
  paymentAttemptId: "00000000-0000-4000-8000-000000000903",
  kind: "create_payment",
  mode: "test",
  amountMinor: "50000",
  currency: "RUB",
  requestDigest: digests.email,
  idempotencyKey: "00000000-0000-4000-8000-000000000904",
  status: "unknown_outcome",
};
type Authority = {
  contactKind: "email" | "phone";
  authorityReference: string;
};

function fixture(existing?: YooKassaOperation) {
  let stored = existing;
  const events: string[] = [];
  const reader = {
    receiptAuthorityForOrder: vi.fn(
      async (orderId: string): Promise<Authority | null> => {
        if (orderId !== checkout.orderId) return null;
        events.push("metadata");
        // Input property order must not alter the historic digest.
        return { authorityReference: reference, contactKind: "email" };
      },
    ),
    receiptContactForOrder: vi.fn(
      async (orderId: string): Promise<YooKassaReceiptContact | null> => {
        if (orderId !== checkout.orderId) return null;
        events.push("contact");
        return { email: "payer@example.test", authorityReference: reference };
      },
    ),
  };
  const claimInitialPayment = vi.fn(
    async (command: ClaimYooKassaOperationCommand) => {
      if (stored && stored.requestDigest !== command.requestDigest)
        throw new Error("YOOKASSA_IDEMPOTENCY_CONFLICT");
      const fresh = stored === undefined;
      stored ??= { ...initial, requestDigest: command.requestDigest };
      events.push("admitted");
      return {
        kind: fresh
          ? ("initial_send_admitted" as const)
          : ("existing" as const),
        operation: stored,
      };
    },
  );
  const operations: YooKassaOperationPort = {
    claimInitialPayment,
    claim: vi.fn(async () => {
      throw new Error("legacy_claim_forbidden");
    }),
    findByProviderObject: vi.fn(async () => null),
    bindProviderObject: vi.fn(async (_id, providerObjectId) => {
      events.push("bound");
      stored = { ...stored!, providerObjectId, status: "pending" };
      return stored;
    }),
    markUnknown: vi.fn(async () => {
      events.push("unknown");
      stored = { ...stored!, status: "unknown_outcome" };
    }),
    resolve: vi.fn(async (_id, status) => {
      stored = { ...stored!, status };
    }),
    claimReconciliationBatch: vi.fn(async () => []),
  };
  const body = {
    id: "payment-replay",
    status: "pending",
    paid: false,
    amount: { value: "500.00", currency: "RUB" },
    test: true,
    created_at: "2026-10-14T00:00:00.000Z",
    metadata: { order_id: checkout.orderId },
    confirmation: {
      type: "redirect",
      confirmation_url: "https://yoomoney.ru/checkout/replay",
    },
    refundable: false,
  };
  const transport = vi.fn(async (_url: string, init: RequestInit) => {
    events.push(init.method!);
    return Response.json(body);
  });
  const deps = {
    client: createYooKassaClient(
      { shopId: "test-shop", secretKey: "synthetic-secret", mode: "test" },
      transport,
    ),
    operations,
    contacts: createPayerReceiptSource(reader),
    mode: "test" as const,
    returnUrl: "https://example.invalid/return",
    receipt: {
      vatCode: 1 as const,
      paymentSubject: "service",
      paymentMode: "full_payment",
    },
  };
  return {
    adapter: new YooKassaExpertResidencyPaymentAdapter(deps),
    deps,
    reader,
    operations,
    claimInitialPayment,
    transport,
    events,
    body,
    stored: () => stored,
  };
}

describe("receipt metadata replay", () => {
  it.each(["unavailable", "throwing"])(
    "GET-verifies a bound purchase with %s plaintext",
    async (state) => {
      const f = fixture({ ...initial, providerObjectId: "payment-replay" });
      if (state === "throwing")
        f.reader.receiptContactForOrder.mockRejectedValue(
          new Error("private key material"),
        );
      else f.reader.receiptContactForOrder.mockResolvedValue(null);
      await expect(f.adapter.createCheckout(checkout)).resolves.toEqual({
        kind: "created",
        paymentId: "payment-replay",
        checkoutUrl: f.body.confirmation.confirmation_url,
      });
      expect(f.events).toEqual(["metadata", "admitted", "GET"]);
      expect(f.reader.receiptContactForOrder).not.toHaveBeenCalled();
      expect(f.reader.receiptAuthorityForOrder).toHaveBeenCalledWith(
        checkout.orderId,
      );
      expect(f.transport.mock.calls[0]?.[0]).toBe(
        "https://api.yookassa.ru/v3/payments/payment-replay",
      );
      expect(f.claimInitialPayment.mock.calls[0]?.[0]).toMatchObject({
        commandId: "5e4f4023-82d8-5085-a48f-92e30b3e0739",
        requestDigest: digests.email,
      });
    },
  );

  it.each(["claimed", "pending", "unknown_outcome"] as const)(
    "keeps an existing unbound %s admission unknown without contact or POST",
    async (status) => {
      const f = fixture({ ...initial, status });
      await expect(f.adapter.createCheckout(checkout)).rejects.toThrow(
        "yookassa_unknown_outcome",
      );
      expect(f.events).toEqual(["metadata", "admitted"]);
      expect(f.reader.receiptContactForOrder).not.toHaveBeenCalled();
      expect(f.transport).not.toHaveBeenCalled();
      expect(f.operations.resolve).not.toHaveBeenCalled();
    },
  );

  it.each(["failed", "canceled", "succeeded"] as const)(
    "preserves terminal unbound %s behavior without disclosure",
    async (status) => {
      const f = fixture({ ...initial, status });
      await expect(f.adapter.createCheckout(checkout)).rejects.toThrow(
        "yookassa_operation_terminal",
      );
      expect(f.reader.receiptContactForOrder).not.toHaveBeenCalled();
      expect(f.transport).not.toHaveBeenCalled();
    },
  );

  it.each([
    "id",
    "order",
    "amount",
    "currency",
    "mode",
    "missing confirmation",
    "http",
    "malformed url",
  ])(
    "rejects a provider %s mismatch without disclosure or POST",
    async (mismatch) => {
      const f = fixture({ ...initial, providerObjectId: "payment-replay" });
      if (mismatch === "id") f.body.id = "another-payment";
      if (mismatch === "order") f.body.metadata.order_id = "another-order";
      if (mismatch === "amount") f.body.amount.value = "501.00";
      if (mismatch === "currency") f.body.amount.currency = "USD";
      if (mismatch === "mode") f.body.test = false;
      if (mismatch === "missing confirmation")
        Reflect.deleteProperty(f.body, "confirmation");
      if (mismatch === "http")
        f.body.confirmation.confirmation_url =
          "http://example.invalid/checkout";
      if (mismatch === "malformed url")
        f.body.confirmation.confirmation_url = "private invalid url";
      await expect(f.adapter.createCheckout(checkout)).rejects.toThrow(
        /^yookassa_/u,
      );
      expect(f.events).toEqual(["metadata", "admitted", "GET"]);
      expect(f.reader.receiptContactForOrder).not.toHaveBeenCalled();
    },
  );

  it.each(["absent", "null", "throwing", "kind", "reference", "undefined"])(
    "fails closed on %s payer metadata without plaintext fallback",
    async (failure) => {
      const f = fixture({ ...initial, providerObjectId: "payment-replay" });
      let reader: YooKassaReceiptContactPort = f.reader;
      if (failure === "absent")
        reader = { receiptContactForOrder: f.reader.receiptContactForOrder };
      if (failure === "null")
        f.reader.receiptAuthorityForOrder.mockResolvedValue(null);
      if (failure === "throwing")
        f.reader.receiptAuthorityForOrder.mockRejectedValue(
          new Error("private database details"),
        );
      if (failure === "kind")
        f.reader.receiptAuthorityForOrder.mockResolvedValue({
          contactKind: "fax",
          authorityReference: reference,
        } as unknown as Authority);
      if (failure === "reference")
        f.reader.receiptAuthorityForOrder.mockResolvedValue({
          contactKind: "email",
          authorityReference: "payer@example.test",
        });
      if (failure === "undefined")
        f.reader.receiptAuthorityForOrder.mockResolvedValue(
          undefined as unknown as Authority,
        );
      const adapter = new YooKassaExpertResidencyPaymentAdapter({
        ...f.deps,
        contacts: createPayerReceiptSource(reader),
      });
      await expect(adapter.createCheckout(checkout)).rejects.toThrow(
        "yookassa_receipt_contact_unavailable",
      );
      expect(f.reader.receiptContactForOrder).not.toHaveBeenCalled();
      expect(f.claimInitialPayment).not.toHaveBeenCalled();
      expect(f.transport).not.toHaveBeenCalled();
    },
  );

  it.each(["email", "phone"] as const)(
    "admits before disclosing a matching %s with byte-compatible digest",
    async (kind) => {
      const f = fixture();
      f.reader.receiptAuthorityForOrder.mockImplementation(async () => {
        f.events.push("metadata");
        return { authorityReference: reference, contactKind: kind };
      });
      f.reader.receiptContactForOrder.mockImplementation(async () => {
        f.events.push("contact");
        return {
          [kind]: kind === "email" ? "payer@example.test" : "+79990000001",
          authorityReference: reference,
        };
      });
      await expect(f.adapter.createCheckout(checkout)).resolves.toMatchObject({
        kind: "created",
        paymentId: "payment-replay",
      });
      expect(f.events).toEqual([
        "metadata",
        "admitted",
        "contact",
        "POST",
        "bound",
      ]);
      expect(f.claimInitialPayment.mock.calls[0]?.[0]).toEqual({
        commandId: "5e4f4023-82d8-5085-a48f-92e30b3e0739",
        orderId: checkout.orderId,
        kind: "create_payment",
        mode: "test",
        amountMinor: "50000",
        currency: "RUB",
        requestDigest: digests[kind],
      });
      const sent = JSON.parse(f.transport.mock.calls[0]![1].body as string);
      expect(sent.receipt.customer).toEqual(
        kind === "email"
          ? { email: "payer@example.test" }
          : { phone: "+79990000001" },
      );
      expect(sent.amount).toEqual({ value: "500.00", currency: "RUB" });
      expect(f.transport.mock.calls[0]![1].headers).toMatchObject({
        "Idempotence-Key": initial.idempotencyKey,
      });
      f.events.length = 0;
      await f.adapter.createCheckout(checkout);
      expect(f.events).toEqual(["metadata", "admitted", "GET"]);
      expect(f.reader.receiptContactForOrder).toHaveBeenCalledOnce();
    },
  );

  it("replays an admission made by an explicit legacy contact-only source", async () => {
    const f = fixture();
    const legacy = new YooKassaExpertResidencyPaymentAdapter({
      ...f.deps,
      contacts: { receiptContactForOrder: f.reader.receiptContactForOrder },
    });
    await legacy.createCheckout(checkout);
    expect(f.events).toEqual(["contact", "admitted", "POST", "bound"]);
    expect(f.stored()?.requestDigest).toBe(digests.email);
    f.events.length = 0;
    await f.adapter.createCheckout(checkout);
    expect(f.events).toEqual(["metadata", "admitted", "GET"]);
    expect(f.reader.receiptContactForOrder).toHaveBeenCalledOnce();
  });

  it.each([
    "absent",
    "throwing",
    "neither",
    "both",
    "kind",
    "reference",
    "malformed authority",
  ])(
    "consumes admission when fresh disclosure is %s and never retries it",
    async (failure) => {
      const f = fixture();
      const contacts: Record<string, YooKassaReceiptContact | null> = {
        absent: null,
        neither: { authorityReference: reference },
        both: {
          email: "payer@example.test",
          phone: "+79990000001",
          authorityReference: reference,
        },
        kind: { phone: "+79990000001", authorityReference: reference },
        reference: {
          email: "payer@example.test",
          authorityReference: "payer-receipt:another",
        },
        "malformed authority": {
          email: "payer@example.test",
          authorityReference: "private@example.test",
        },
      };
      f.reader.receiptContactForOrder.mockImplementation(async () => {
        f.events.push("contact");
        if (failure === "throwing")
          throw new Error("private decryption details");
        return contacts[failure]!;
      });
      await expect(f.adapter.createCheckout(checkout)).rejects.toThrow(
        "yookassa_unknown_outcome",
      );
      expect(f.events).toEqual(["metadata", "admitted", "contact", "unknown"]);
      expect(f.stored()?.status).toBe("unknown_outcome");
      await expect(f.adapter.createCheckout(checkout)).rejects.toThrow(
        "yookassa_unknown_outcome",
      );
      expect(f.reader.receiptContactForOrder).toHaveBeenCalledOnce();
      expect(f.transport).not.toHaveBeenCalled();
      expect(f.operations.resolve).not.toHaveBeenCalled();
    },
  );

  it("does not disclose on an ambiguous admission commit", async () => {
    const f = fixture();
    f.claimInitialPayment.mockRejectedValue(new Error("commit_response_lost"));
    await expect(f.adapter.createCheckout(checkout)).rejects.toThrow(
      "commit_response_lost",
    );
    expect(f.reader.receiptContactForOrder).not.toHaveBeenCalled();
    expect(f.transport).not.toHaveBeenCalled();
  });

  it("does not disclose or GET when retained authority conflicts with the admission", async () => {
    const f = fixture({ ...initial, providerObjectId: "payment-replay" });
    f.reader.receiptAuthorityForOrder.mockResolvedValue({
      contactKind: "email",
      authorityReference: "payer-receipt:other",
    });
    await expect(f.adapter.createCheckout(checkout)).rejects.toThrow(
      "YOOKASSA_IDEMPOTENCY_CONFLICT",
    );
    expect(f.reader.receiptContactForOrder).not.toHaveBeenCalled();
    expect(f.transport).not.toHaveBeenCalled();
  });

  it.each([400, 500])(
    "preserves initial HTTP %s failure classification",
    async (status) => {
      const f = fixture();
      f.transport.mockResolvedValue(
        new Response("private provider detail", { status }),
      );
      await expect(f.adapter.createCheckout(checkout)).rejects.toThrow(
        status === 400 ? "yookassa_http_400" : "yookassa_unknown_outcome",
      );
      expect(f.stored()?.status).toBe(
        status === 400 ? "failed" : "unknown_outcome",
      );
      await expect(f.adapter.createCheckout(checkout)).rejects.toThrow(
        status === 400
          ? "yookassa_operation_terminal"
          : "yookassa_unknown_outcome",
      );
      expect(f.reader.receiptContactForOrder).toHaveBeenCalledOnce();
      expect(f.transport).toHaveBeenCalledOnce();
    },
  );
});
