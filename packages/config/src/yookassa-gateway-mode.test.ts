import { expect, it } from "vitest";
import { loadEnv } from "./env.js";
const base = {
  DATABASE_URL: "postgresql://local:local@localhost/test",
  ALLOW_INSECURE_LOCAL_DATABASE: "true",
  PAYMENT_PROVIDER: "yookassa_gateway",
  PAYMENTS_ENABLED: "true",
  YOOKASSA_ENABLED: "true",
  YOOKASSA_MODE: "live",
  YOOKASSA_SHOP_ID: "123",
  YOOKASSA_RETURN_URL: "https://ii-tonya.ru/payments/return",
  YOOKASSA_RECEIPT_VAT_CODE: "1",
  YOOKASSA_RECEIPT_PAYMENT_SUBJECT: "service",
  YOOKASSA_RECEIPT_PAYMENT_MODE: "full_prepayment",
  YOOKASSA_GATEWAY_CONFIG_FILE: "/etc/ii-tonya/gateway-api.json",
};
it("activates only explicit gateway mode without exposing a direct merchant credential", () => {
  const config = loadEnv(base);
  expect(config.integrations.payments).toBe(true);
  expect(config.features.yookassa).toBe(true);
  expect(config.yookassa).toBeUndefined();
  expect(config.yookassaGateway).toMatchObject({
    configurationFile: "/etc/ii-tonya/gateway-api.json",
    mode: "live",
    shopId: "123",
  });
});
it("rejects incomplete, disabled or mixed direct/gateway configuration", () => {
  for (const mutation of [
    { PAYMENTS_ENABLED: "false" },
    { YOOKASSA_ENABLED: "false" },
    { YOOKASSA_GATEWAY_CONFIG_FILE: "relative.json" },
    { YOOKASSA_SECRET_KEY: "merchant-must-not-reach-api" },
    { YOOKASSA_SECRET_REF: "env://YOOKASSA_SECRET_KEY" },
  ])
    expect(() => loadEnv({ ...base, ...mutation })).toThrow();
  expect(() =>
    loadEnv({
      DATABASE_URL: base.DATABASE_URL,
      ALLOW_INSECURE_LOCAL_DATABASE: "true",
      YOOKASSA_GATEWAY_CONFIG_FILE: "/etc/ii-tonya/orphan.json",
    }),
  ).toThrow();
});

it("permits an isolated worker descriptor without an API configuration path", () => {
  const { YOOKASSA_GATEWAY_CONFIG_FILE, ...worker } = base;
  void YOOKASSA_GATEWAY_CONFIG_FILE;
  const config = loadEnv({
    ...worker,
    YOOKASSA_GATEWAY_WORKER_CONFIG_FILE: "/etc/ii-tonya/gateway-worker.json",
  });
  expect(config.yookassaGateway).toMatchObject({
    workerConfigFile: "/etc/ii-tonya/gateway-worker.json",
  });
  expect(config.yookassaGateway?.configurationFile).toBeUndefined();
});
