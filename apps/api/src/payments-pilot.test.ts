import Fastify from "fastify";
import { describe, expect, it, vi, type Mock } from "vitest";
import type { RuntimeConfig } from "@ii-tonya/config";
import type { PaymentsPilotLedger, PaymentsPilotRecord } from "@ii-tonya/db";
import type { YooKassaClient, YooKassaPayment } from "@ii-tonya/integrations";
import {
  createPaymentsPilotServerOptions,
  paymentsPilotRoutes,
  PaymentsPilotService,
} from "./payments-pilot.js";
import { yookassaWebhookRoutes } from "./routes/yookassa-webhook.js";

const principalId = "11111111-2222-4333-8444-555555555555";
const stranger = "99999999-2222-4333-8444-555555555555";
const paymentId = "2f4b6d0d-000f-5000-9000-000000000601";
const pilot = { principalId, maxAmountMinor: 1000n };

const payment = (
  overrides: Partial<YooKassaPayment> = {},
): YooKassaPayment => ({
  id: paymentId,
  status: "pending",
  paid: false,
  amount: { value: "10.00", currency: "RUB" },
  test: false,
  createdAt: "2026-11-04T00:00:00.000Z",
  metadata: { purpose: "payments_pilot" },
  confirmation: { type: "redirect", url: "https://yoomoney.ru/checkout/x" },
  refundable: false,
  ...overrides,
});

const memoryLedger = () => {
  const records = new Map<string, PaymentsPilotRecord>();
  const ledger: PaymentsPilotLedger = {
    beginCheckout: vi.fn(async (input) => ({
      idempotencyKey: input.idempotencyKey,
    })),
    recordCreated: vi.fn(async (input) => {
      records.set(input.providerPaymentId, {
        providerPaymentId: input.providerPaymentId,
        principalId: input.principalId,
        amountMinor: input.amountMinor,
        status: "pending",
      });
    }),
    recordStatus: vi.fn(async (input) => {
      const current = records.get(input.providerPaymentId)!;
      records.set(input.providerPaymentId, {
        ...current,
        status: input.status,
      });
    }),
    find: vi.fn(async (id) => records.get(id) ?? null),
  };
  return { ledger, records };
};

const service = (
  client: {
    createPayment: Mock<YooKassaClient["createPayment"]>;
    getPayment: Mock<YooKassaClient["getPayment"]>;
  } = {
    createPayment: vi.fn(async () => payment()),
    getPayment: vi.fn(async () => payment({ status: "succeeded", paid: true })),
  },
) => {
  const { ledger, records } = memoryLedger();
  return {
    client,
    ledger,
    records,
    service: new PaymentsPilotService({
      client,
      ledger,
      pilot,
      returnUrl: "https://ii-tonya.ru/pay/return",
      receipt: {
        vatCode: 1,
        paymentSubject: "service",
        paymentMode: "full_payment",
      },
      newIdempotencyKey: () => "idem-key-0001-pilot",
    }),
  };
};

describe("payments pilot service (SCRUM-518)", () => {
  it("creates a capped live payment for the allow-listed principal and stores it", async () => {
    const { client, ledger, records, service: pilotService } = service();
    const result = await pilotService.checkout({
      principalId,
      email: "owner@ii-tonya.ru",
    });
    expect(result).toEqual({
      paymentId,
      confirmationUrl: "https://yoomoney.ru/checkout/x",
      amountMinor: 1000n,
    });
    expect(client.createPayment).toHaveBeenCalledWith(
      expect.objectContaining({
        amountMinor: 1000n,
        idempotencyKey: "idem-key-0001-pilot",
        metadata: { purpose: "payments_pilot" },
      }),
    );
    expect(ledger.beginCheckout).toHaveBeenCalledWith(
      expect.objectContaining({ idempotencyKey: "idem-key-0001-pilot" }),
    );
    expect(
      vi.mocked(ledger.beginCheckout).mock.invocationCallOrder[0],
    ).toBeLessThan(client.createPayment.mock.invocationCallOrder[0]!);
    expect(records.get(paymentId)?.status).toBe("pending");
  });

  it("reuses the durable checkout key after an uncertain provider response", async () => {
    const client = {
      createPayment: vi
        .fn<YooKassaClient["createPayment"]>()
        .mockRejectedValueOnce(new Error("synthetic response lost"))
        .mockResolvedValueOnce(payment()),
      getPayment: vi.fn<YooKassaClient["getPayment"]>(async () => payment()),
    };
    const parts = service(client);
    vi.mocked(parts.ledger.beginCheckout)
      .mockResolvedValueOnce({ idempotencyKey: "durable-operation-key" })
      .mockResolvedValueOnce({ idempotencyKey: "durable-operation-key" });
    await expect(
      parts.service.checkout({ principalId, email: "owner@ii-tonya.ru" }),
    ).rejects.toThrow("synthetic response lost");
    await expect(
      parts.service.checkout({ principalId, email: "owner@ii-tonya.ru" }),
    ).resolves.toMatchObject({ paymentId });
    expect(parts.client.createPayment).toHaveBeenCalledTimes(2);
    expect(
      parts.client.createPayment.mock.calls.map(
        (call) => call[0].idempotencyKey,
      ),
    ).toEqual(["durable-operation-key", "durable-operation-key"]);
  });

  it("refuses another principal before any provider call", async () => {
    const { client, service: pilotService } = service();
    await expect(
      pilotService.checkout({ principalId: stranger, email: "a@b.ru" }),
    ).rejects.toThrow("payments_pilot_refused:principal");
    expect(client.createPayment).not.toHaveBeenCalled();
  });

  it("stores the provider-verified status from a webhook and ignores foreign payments", async () => {
    const { client, records, service: pilotService } = service();
    await pilotService.checkout({ principalId, email: "owner@ii-tonya.ru" });
    const notification = {
      type: "notification" as const,
      event: "payment.succeeded" as const,
      object: { id: paymentId },
    };
    expect(await pilotService.handleNotification(notification)).toBe(
      "complete",
    );
    expect(client.getPayment).toHaveBeenCalledWith(paymentId);
    expect(records.get(paymentId)?.status).toBe("succeeded");
    expect(
      await pilotService.handleNotification({
        ...notification,
        object: { id: "3f4b6d0d-000f-5000-9000-000000000602" },
      }),
    ).toBe("absent");
  });

  it("rejects a provider object whose amount or purpose differs", async () => {
    const { service: pilotService } = service({
      createPayment: vi.fn(async () => payment()),
      getPayment: vi.fn(async () =>
        payment({ amount: { value: "100.00", currency: "RUB" } }),
      ),
    });
    await pilotService.checkout({ principalId, email: "owner@ii-tonya.ru" });
    await expect(pilotService.refresh(paymentId)).rejects.toThrow(
      "payments_pilot_provider_mismatch",
    );
  });
});

describe("payments pilot routes", () => {
  const build = async () => {
    const parts = service();
    const app = Fastify();
    await app.register(paymentsPilotRoutes, {
      service: parts.service,
      principals: {
        resolve: async (authorization: string) =>
          authorization === "Bearer owner"
            ? {
                kind: "resolved" as const,
                principal: {
                  authenticated: true,
                  active: true,
                  userId: principalId,
                },
              }
            : authorization === "Bearer other"
              ? {
                  kind: "resolved" as const,
                  principal: {
                    authenticated: true,
                    active: true,
                    userId: stranger,
                  },
                }
              : { kind: "denied" as const },
      } as never,
    });
    return { app, ...parts };
  };

  it("requires a session and returns the confirmation URL to the pilot principal", async () => {
    const { app } = await build();
    const anonymous = await app.inject({
      method: "POST",
      url: "/v1/payments-pilot/checkout",
      payload: { email: "owner@ii-tonya.ru" },
    });
    expect(anonymous.statusCode).toBe(401);
    const other = await app.inject({
      method: "POST",
      url: "/v1/payments-pilot/checkout",
      headers: { authorization: "Bearer other" },
      payload: { email: "owner@ii-tonya.ru" },
    });
    expect(other.statusCode).toBe(403);
    const ok = await app.inject({
      method: "POST",
      url: "/v1/payments-pilot/checkout",
      headers: { authorization: "Bearer owner" },
      payload: { email: "owner@ii-tonya.ru" },
    });
    expect(ok.statusCode).toBe(201);
    expect(ok.json()).toEqual({
      paymentId,
      confirmationUrl: "https://yoomoney.ru/checkout/x",
      amountRub: "10.00",
    });
    const status = await app.inject({
      method: "GET",
      url: `/v1/payments-pilot/payments/${paymentId}`,
      headers: { authorization: "Bearer owner" },
    });
    expect(status.json()).toEqual({
      paymentId,
      status: "succeeded",
      amountRub: "10.00",
    });
    const foreign = await app.inject({
      method: "GET",
      url: `/v1/payments-pilot/payments/${paymentId}`,
      headers: { authorization: "Bearer other" },
    });
    expect(foreign.statusCode).toBe(404);
  });
});

it("composes the live pilot into native startup dependencies", async () => {
  const { loadEnv } = await import("@ii-tonya/config");
  const { createDefaultLifecycle } = await import("./server.js");
  const config = loadEnv({
    DATABASE_URL: "postgresql://local:local@localhost/test",
    ALLOW_INSECURE_LOCAL_DATABASE: "true",
    PAYMENTS_ENABLED: "true",
    PAYMENT_PROVIDER: "yookassa",
    YOOKASSA_ENABLED: "true",
    YOOKASSA_MODE: "live",
    PAYMENTS_PILOT_ALLOWLIST: principalId,
    PAYMENTS_PILOT_MAX_AMOUNT_RUB: "10",
    YOOKASSA_SHOP_ID: "123456",
    YOOKASSA_SECRET_KEY: "fixture_only_value_x",
    YOOKASSA_SECRET_REF: "env://YOOKASSA_SECRET_KEY",
    YOOKASSA_RETURN_URL: "https://ii-tonya.ru/pay/return",
    YOOKASSA_RECEIPT_VAT_CODE: "1",
    YOOKASSA_RECEIPT_PAYMENT_SUBJECT: "service",
    YOOKASSA_RECEIPT_PAYMENT_MODE: "full_payment",
  });
  const lifecycle = createDefaultLifecycle(
    createPaymentsPilotServerOptions(config, {} as never, {
      env: { YOOKASSA_SECRET_KEY: "fixture_only_value_x" },
    }),
  );
  const dependencies = await lifecycle.dependencies(config, {} as never);
  expect(dependencies.paymentsPilot).toBeInstanceOf(PaymentsPilotService);
});

describe("payments pilot server options", () => {
  const config = (overrides: Partial<RuntimeConfig> = {}) =>
    ({
      features: { yookassa: true },
      paymentsPilot: { ...pilot, checkoutEnabled: false },
      yookassa: {
        mode: "live",
        shopId: "123456",
        secretReference: "env://YOOKASSA_SECRET_KEY",
        returnUrl: "https://ii-tonya.ru/pay/return",
        receipt: {
          vatCode: 1,
          paymentSubject: "service",
          paymentMode: "full_payment",
        },
      },
      ...overrides,
    }) as unknown as RuntimeConfig;
  const env = { YOOKASSA_SECRET_KEY: "fixture_only_value_x" };

  it("stays off without a pilot or with YooKassa disabled", () => {
    expect(
      createPaymentsPilotServerOptions(
        config({ paymentsPilot: undefined } as never),
        {} as never,
        { env },
      ),
    ).toBeUndefined();
    expect(
      createPaymentsPilotServerOptions(
        config({ features: { yookassa: false } } as never),
        {} as never,
        { env },
      ),
    ).toBeUndefined();
  });

  it("refuses the test shop and missing credentials", () => {
    expect(() =>
      createPaymentsPilotServerOptions(
        config({ yookassa: { ...config().yookassa!, mode: "test" } }),
        {} as never,
        { env },
      ),
    ).toThrow("payments_pilot_live_mode_required");
    expect(() =>
      createPaymentsPilotServerOptions(config(), {} as never, { env: {} }),
    ).toThrow("payments_pilot_credentials_unavailable");
  });

  it("enforces the cap in the real client and routes webhooks through the pilot", async () => {
    const { ledger, records } = memoryLedger();
    const bodies: unknown[] = [];
    const transport = vi.fn(async (_url: string, init: RequestInit) => {
      if (init.body) bodies.push(JSON.parse(String(init.body)));
      return new Response(
        JSON.stringify({
          id: paymentId,
          status: init.method === "POST" ? "pending" : "succeeded",
          paid: init.method !== "POST",
          amount: { value: "10.00", currency: "RUB" },
          test: false,
          created_at: "2026-11-04T00:00:00.000Z",
          metadata: { purpose: "payments_pilot" },
          confirmation: {
            type: "redirect",
            confirmation_url: "https://yoomoney.ru/checkout/x",
          },
          refundable: false,
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    });
    const options = createPaymentsPilotServerOptions(config(), {} as never, {
      env,
      transport,
      ledger,
    })!;
    await options.paymentsPilot.checkout({
      principalId,
      email: "owner@ii-tonya.ru",
    });
    expect(bodies[0]).toMatchObject({
      amount: { value: "10.00", currency: "RUB" },
      capture: true,
    });
    const app = Fastify();
    const complete = vi.fn(async () => undefined);
    await app.register(yookassaWebhookRoutes, {
      ...options.yookassaWebhook,
      effectivePeerAddress: () => "185.71.76.4",
      inbox: {
        claim: async () => ({ kind: "claimed", claimId: "c1" }),
        complete,
        fail: async () => undefined,
      },
    });
    const response = await app.inject({
      method: "POST",
      url: "/v1/webhooks/yookassa",
      payload: {
        type: "notification",
        event: "payment.succeeded",
        object: { id: paymentId },
      },
    });
    expect(response.statusCode).toBe(200);
    expect(complete).toHaveBeenCalledWith("c1");
    expect(records.get(paymentId)?.status).toBe("succeeded");
    const unknown = await app.inject({
      method: "POST",
      url: "/v1/webhooks/yookassa",
      payload: {
        type: "notification",
        event: "payment.succeeded",
        object: { id: "3f4b6d0d-000f-5000-9000-000000000602" },
      },
    });
    expect(unknown.statusCode).toBe(503);
  });
});
