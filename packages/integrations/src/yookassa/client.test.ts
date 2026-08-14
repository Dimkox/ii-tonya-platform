import { describe, expect, it, vi } from "vitest";
import {
  YooKassaTerminalError,
  YooKassaUnknownOutcomeError,
  createYooKassaClient,
  formatRubMinor,
  type CreateYooKassaPayment,
  type YooKassaClientConfig,
  type YooKassaTransport,
} from "./client.js";

const config: YooKassaClientConfig = {
  mode: "test",
  shopId: "test-shop",
  secretKey: "test-secret-not-live",
};

const command: CreateYooKassaPayment = {
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
};

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
