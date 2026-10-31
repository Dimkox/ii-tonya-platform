import { describe, expect, it, vi } from "vitest";
import {
  YooKassaTerminalError,
  YooKassaUnknownOutcomeError,
  createYooKassaClient,
  formatRubMinor,
  serializeYooKassaPaymentRequest,
  type CreateYooKassaPayment,
  type YooKassaClientConfig,
  type YooKassaTransport,
} from "./client.js";

const config: YooKassaClientConfig = {
  mode: "test",
  shopId: "test-shop",
  secretKey: "test-secret-not-live",
};

const command = {
  amountMinor: 50_000n,
  idempotencyKey: "d5cab70e-c30f-4baf-9da0-e8f633c475f8",
  description: "Expert residency",
  returnUrl: "https://ii-tonya.ru/payments/return",
  metadata: { order_id: "order-7" },
  receipt: {
    customer: { email: "fixture@example.invalid" },
    item: {
      description: "Expert residency",
      vatCode: 1,
      paymentSubject: "service",
      paymentMode: "full_payment",
    },
  },
} satisfies CreateYooKassaPayment;

const payment = {
  id: "2f4b6d0d-000f-5000-9000-000000000001",
  status: "pending",
  paid: false,
  amount: { value: "500.00", currency: "RUB" },
  test: true,
  created_at: "2026-08-14T10:00:00.000Z",
  captured_at: "2026-08-14T10:05:00.000Z",
  metadata: { order_id: "order-7" },
  confirmation: {
    type: "redirect",
    confirmation_url: "https://yoomoney.ru/checkout/payments/v2/contract",
  },
  refundable: false,
  payment_method: { type: "bank_card", card: { last4: "0000" } },
  recipient: { account_id: "discard-me" },
};

const jsonResponse = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

describe("YooKassaClient", () => {
  it("uses one canonical serializer for the first payment POST", async () => {
    const body = serializeYooKassaPaymentRequest(command);
    const transport = vi.fn<YooKassaTransport>(async (_url, init) => {
      expect(init.body).toBe(body);
      return jsonResponse(200, payment);
    });
    await createYooKassaClient(config, transport).createPayment(command);
    expect(transport).toHaveBeenCalledOnce();
  });
  it("uses the fixed v3 payment endpoint, Basic Auth, and the stable idempotency key", async () => {
    const transport = vi.fn<YooKassaTransport>(async () =>
      jsonResponse(200, payment),
    );
    const client = createYooKassaClient(config, transport);

    const result = await client.createPayment(command);

    expect(transport).toHaveBeenCalledTimes(1);
    const [url, init] = transport.mock.calls[0]!;
    expect(url).toBe("https://api.yookassa.ru/v3/payments");
    expect(init.method).toBe("POST");
    expect(new Headers(init.headers).get("Authorization")).toMatch(/^Basic /u);
    expect(new Headers(init.headers).get("Idempotence-Key")).toBe(
      command.idempotencyKey,
    );
    expect(JSON.parse(String(init.body))).toMatchObject({
      amount: { value: "500.00", currency: "RUB" },
      capture: true,
      confirmation: { type: "redirect" },
    });
    expect(result).not.toHaveProperty("payment_method");
    expect(result).not.toHaveProperty("recipient");
    expect(result.capturedAt).toBe("2026-08-14T10:05:00.000Z");
  });

  it.each([
    [1n, "0.01"],
    [100n, "1.00"],
    [100_001n, "1000.01"],
  ])("converts %s kopecks exactly", (minor, expected) => {
    expect(formatRubMinor(minor)).toBe(expected);
  });

  it.each([0n, -1n, 1_000_000_000_000n])(
    "rejects invalid minor amount %s",
    (minor) =>
      expect(() => formatRubMinor(minor)).toThrow("yookassa_amount_invalid"),
  );

  it("uses only validated IDs in authoritative GET paths", async () => {
    const transport = vi.fn<YooKassaTransport>(async () =>
      jsonResponse(200, payment),
    );
    const client = createYooKassaClient(config, transport);

    await client.getPayment(payment.id);
    expect(transport.mock.calls[0]?.[0]).toBe(
      `https://api.yookassa.ru/v3/payments/${payment.id}`,
    );
    await expect(client.getPayment("../refunds")).rejects.toThrow(
      "yookassa_provider_id_invalid",
    );
  });

  it.each([429, 500, 503])(
    "maps HTTP %s to an unknown outcome",
    async (status) => {
      const client = createYooKassaClient(config, async () =>
        jsonResponse(status, { description: "must not leak" }),
      );
      await expect(client.createPayment(command)).rejects.toBeInstanceOf(
        YooKassaUnknownOutcomeError,
      );
    },
  );

  it("maps deterministic failures to a sanitized terminal error", async () => {
    const client = createYooKassaClient(config, async () =>
      jsonResponse(401, { description: "secret provider detail" }),
    );
    const failure = await client
      .createPayment(command)
      .catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(YooKassaTerminalError);
    expect(String(failure)).not.toContain("secret provider detail");
    expect(String(failure)).not.toContain(config.secretKey);
  });

  it("rejects a response whose test mode does not match the client", async () => {
    const client = createYooKassaClient(config, async () =>
      jsonResponse(200, { ...payment, test: false }),
    );
    await expect(client.createPayment(command)).rejects.toThrow(
      "yookassa_mode_mismatch",
    );
  });
});

it("serializes a single 30-ruble payment with distinct 10 and 20 ruble receipt items", () => {
  const request = {
    ...command,
    amountMinor: 3000n,
    receipt: {
      customer: { email: "fixture@example.invalid" },
      items: [
        {
          ...command.receipt.item,
          description: "Онбординг",
          amountMinor: 1000n,
        },
        { ...command.receipt.item, description: "Тариф", amountMinor: 2000n },
      ],
    },
  } satisfies CreateYooKassaPayment;
  const body = JSON.parse(serializeYooKassaPaymentRequest(request));
  expect(body.amount).toEqual({ value: "30.00", currency: "RUB" });
  expect(body.receipt.items).toMatchObject([
    { description: "Онбординг", amount: { value: "10.00", currency: "RUB" } },
    { description: "Тариф", amount: { value: "20.00", currency: "RUB" } },
  ]);
});

it("rejects a composite receipt that does not add up to the charged amount", () => {
  const request = {
    ...command,
    amountMinor: 3000n,
    receipt: {
      customer: { email: "fixture@example.invalid" },
      items: [
        { ...command.receipt.item, amountMinor: 1000n },
        { ...command.receipt.item, amountMinor: 1999n },
      ],
    },
  } satisfies CreateYooKassaPayment;
  expect(() => serializeYooKassaPaymentRequest(request)).toThrow(
    "yookassa_receipt_amount_invalid",
  );
});

it("rejects a malformed composite receipt before any provider request", async () => {
  const transport = vi.fn<YooKassaTransport>();
  const client = createYooKassaClient(config, transport);
  const request = {
    ...command,
    amountMinor: 3000n,
    receipt: {
      customer: { email: "fixture@example.invalid" },
      items: [
        { ...command.receipt.item, description: "", amountMinor: 1000n },
        { ...command.receipt.item, amountMinor: 2000n },
      ],
    },
  } satisfies CreateYooKassaPayment;
  await expect(client.createPayment(request)).rejects.toThrow(
    "yookassa_receipt_item_invalid",
  );
  expect(transport).not.toHaveBeenCalled();
});

it("rejects a sparse composite receipt before any provider request", async () => {
  const transport = vi.fn<YooKassaTransport>();
  const items = new Array(2);
  items[0] = { ...command.receipt.item, amountMinor: 3000n };
  const request = {
    ...command,
    amountMinor: 3000n,
    receipt: { customer: { email: "fixture@example.invalid" }, items },
  } as unknown as CreateYooKassaPayment;
  await expect(
    createYooKassaClient(config, transport).createPayment(request),
  ).rejects.toThrow("yookassa_receipt_amount_invalid");
  expect(transport).not.toHaveBeenCalled();
});

it("serializes the same composite amounts that were validated", () => {
  let reads = 0;
  const request = {
    ...command,
    amountMinor: 3000n,
    receipt: {
      customer: { email: "fixture@example.invalid" },
      items: [
        {
          ...command.receipt.item,
          get amountMinor() {
            return ++reads === 1 ? 1000n : 2000n;
          },
        },
        { ...command.receipt.item, amountMinor: 2000n },
      ],
    },
  } satisfies CreateYooKassaPayment;
  const body = JSON.parse(serializeYooKassaPaymentRequest(request));
  expect(
    body.receipt.items.map(
      (item: { amount: { value: string } }) => item.amount.value,
    ),
  ).toEqual(["10.00", "20.00"]);
});

it("charges and verifies the same payment amount even when input has an accessor", async () => {
  let reads = 0;
  const request = {
    ...command,
    get amountMinor() {
      return ++reads === 1 ? 3000n : 50000n;
    },
    receipt: {
      customer: { email: "fixture@example.invalid" },
      items: [
        { ...command.receipt.item, amountMinor: 1000n },
        { ...command.receipt.item, amountMinor: 2000n },
      ],
    },
  } satisfies CreateYooKassaPayment;
  const transport = vi.fn<YooKassaTransport>(async (_url, init) => {
    expect(JSON.parse(String(init.body)).amount.value).toBe("30.00");
    return jsonResponse(200, {
      ...payment,
      amount: { value: "30.00", currency: "RUB" },
    });
  });
  await expect(
    createYooKassaClient(config, transport).createPayment(request),
  ).resolves.toBeDefined();
});
