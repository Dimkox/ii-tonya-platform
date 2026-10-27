import { describe, expect, it, vi } from "vitest";
import { createYooKassaClient } from "./client.js";
import { YooKassaExpertResidencyPaymentAdapter } from "./payment-adapter.js";
import type {
  ClaimYooKassaOperationCommand,
  YooKassaOperation,
  YooKassaOperationPort,
} from "./operation-port.js";

const checkout = {
  orderId: "00000000-0000-4000-8000-000000000801",
  amountMinor: "50000",
  currency: "RUB" as const,
  idempotencyKey: "first-send-checkout",
};
const initial: YooKassaOperation = {
  id: "00000000-0000-4000-8000-000000000802",
  orderId: checkout.orderId,
  paymentAttemptId: "00000000-0000-4000-8000-000000000803",
  kind: "create_payment",
  mode: "test",
  amountMinor: "50000",
  currency: "RUB",
  requestDigest: `sha256:${"a".repeat(64)}`,
  idempotencyKey: "00000000-0000-4000-8000-000000000804",
  status: "unknown_outcome",
};
function fixture(existing?: YooKassaOperation) {
  let stored = existing;
  let authority: string | undefined;
  const events: string[] = [];
  const body = {
    id: "payment-admitted",
    status: "pending",
    paid: false,
    amount: { value: "500.00", currency: "RUB" },
    test: true,
    created_at: "2026-10-13T00:00:00.000Z",
    metadata: { order_id: checkout.orderId },
    confirmation: {
      type: "redirect",
      confirmation_url: "https://yoomoney.ru/checkout/test",
    },
    refundable: false,
  };
  const claimInitialPayment = vi.fn(
    async (command: ClaimYooKassaOperationCommand) => {
      if (authority !== undefined && authority !== command.requestDigest)
        throw new Error("YOOKASSA_IDEMPOTENCY_CONFLICT");
      authority = command.requestDigest;
      const fresh = stored === undefined;
      stored ??= { ...initial, requestDigest: command.requestDigest };
      events.push("commit");
      return {
        kind: fresh
          ? ("initial_send_admitted" as const)
          : ("existing" as const),
        operation: stored,
      };
    },
  );
  const operations: YooKassaOperationPort & {
    claimInitialPayment: typeof claimInitialPayment;
  } = {
    claimInitialPayment,
    claim: vi.fn(async () => stored ?? initial),
    findByProviderObject: vi.fn(async () => null),
    bindProviderObject: vi.fn(async (_id, providerObjectId) => {
      events.push("bind");
      stored = { ...stored!, providerObjectId, status: "pending" };
      return stored;
    }),
    markUnknown: vi.fn(async () => {
      events.push("unknown");
    }),
    resolve: vi.fn(async () => {
      events.push("resolve");
    }),
    claimReconciliationBatch: vi.fn(async () => []),
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
    mode: "test" as const,
    returnUrl: "https://example.invalid/return",
    contacts: {
      receiptContactForOrder: async () => ({
        email: "fixture@example.invalid",
        authorityReference: "payer:fixture",
      }),
    },
    receipt: {
      vatCode: 1 as const,
      paymentSubject: "service",
      paymentMode: "full_payment",
    },
  };
  return {
    adapter: new YooKassaExpertResidencyPaymentAdapter(deps),
    deps,
    operations,
    transport,
    events,
    body,
  };
}

describe("initial payment send admission", () => {
  it("commits before one POST and binds the redirect", async () => {
    const f = fixture();
    await expect(f.adapter.createCheckout(checkout)).resolves.toMatchObject({
      kind: "created",
      paymentId: "payment-admitted",
    });
    expect(f.events).toEqual(["commit", "POST", "bind"]);
    expect(f.operations.claim).not.toHaveBeenCalled();
    expect(
      JSON.stringify(f.operations.claimInitialPayment.mock.calls),
    ).not.toContain("fixture@example.invalid");
  });
  it("allows only one POST across concurrent invocations", async () => {
    const f = fixture();
    const outcomes = await Promise.allSettled([
      f.adapter.createCheckout(checkout),
      f.adapter.createCheckout(checkout),
    ]);
    expect(outcomes.filter((x) => x.status === "fulfilled")).toHaveLength(1);
    expect(f.events.filter((x) => x === "POST")).toHaveLength(1);
    expect(f.operations.resolve).not.toHaveBeenCalled();
  });
  it.each(["claimed", "pending", "unknown_outcome"] as const)(
    "never resends an existing unbound %s operation",
    async (status) => {
      const f = fixture({ ...initial, status });
      await expect(f.adapter.createCheckout(checkout)).rejects.toThrow(
        "yookassa_unknown_outcome",
      );
      expect(f.transport).not.toHaveBeenCalled();
      expect(f.operations.resolve).not.toHaveBeenCalled();
    },
  );
  it("reads an existing binding with GET only", async () => {
    const f = fixture({ ...initial, providerObjectId: "payment-admitted" });
    await expect(f.adapter.createCheckout(checkout)).resolves.toMatchObject({
      kind: "created",
    });
    expect(f.events).toEqual(["commit", "GET"]);
  });
  it.each(["id", "order", "amount", "mode"])(
    "rejects a bound %s mismatch",
    async (mismatch) => {
      const f = fixture({ ...initial, providerObjectId: "payment-admitted" });
      if (mismatch === "id") f.body.id = "another-payment";
      if (mismatch === "order") f.body.metadata.order_id = "another-order";
      if (mismatch === "amount") f.body.amount.value = "501.00";
      if (mismatch === "mode") f.body.test = false;
      await expect(f.adapter.createCheckout(checkout)).rejects.toThrow();
      expect(f.events.filter((x) => x === "POST")).toHaveLength(0);
    },
  );
  it("rejects changed authority on the same command", async () => {
    const f = fixture();
    await f.adapter.createCheckout(checkout);
    await expect(
      f.adapter.createCheckout({ ...checkout, amountMinor: "50001" }),
    ).rejects.toThrow("YOOKASSA_IDEMPOTENCY_CONFLICT");
    expect(f.events.filter((x) => x === "POST")).toHaveLength(1);
  });
  it("fails closed without the atomic capability", async () => {
    const f = fixture();
    Reflect.deleteProperty(f.operations, "claimInitialPayment");
    await expect(f.adapter.createCheckout(checkout)).rejects.toThrow(
      "yookassa_initial_send_capability_unavailable",
    );
    expect(f.operations.claim).not.toHaveBeenCalled();
    expect(f.transport).not.toHaveBeenCalled();
  });
  it("rejects exact-body recovery before admission", async () => {
    const f = fixture();
    const adapter = new YooKassaExpertResidencyPaymentAdapter({
      ...f.deps,
      replayProtector: { protect: vi.fn() },
    });
    await expect(adapter.createCheckout(checkout)).rejects.toThrow(
      "yookassa_initial_send_recovery_unsupported",
    );
    expect(f.operations.claimInitialPayment).not.toHaveBeenCalled();
    expect(f.transport).not.toHaveBeenCalled();
  });
  it("does not send on ambiguous admission commit", async () => {
    const f = fixture();
    f.operations.claimInitialPayment.mockRejectedValueOnce(
      new Error("commit_response_lost"),
    );
    await expect(f.adapter.createCheckout(checkout)).rejects.toThrow();
    expect(f.transport).not.toHaveBeenCalled();
    expect(f.operations.resolve).not.toHaveBeenCalled();
  });
  it.each(["post", "bind"])(
    "preserves uncertainty after ambiguous %s and does not resend",
    async (point) => {
      const f = fixture();
      if (point === "post")
        f.transport.mockRejectedValueOnce(new Error("connection_lost"));
      else
        vi.mocked(f.operations.bindProviderObject).mockRejectedValueOnce(
          new Error("commit_response_lost"),
        );
      await expect(f.adapter.createCheckout(checkout)).rejects.toThrow();
      await expect(f.adapter.createCheckout(checkout)).rejects.toThrow(
        "yookassa_unknown_outcome",
      );
      expect(f.transport).toHaveBeenCalledOnce();
      expect(f.operations.resolve).not.toHaveBeenCalled();
    },
  );
});
