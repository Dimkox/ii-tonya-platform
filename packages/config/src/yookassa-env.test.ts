import { describe, expect, it } from "vitest";
import { loadEnv } from "./env.js";

const base = (): NodeJS.ProcessEnv => ({
  DATABASE_URL: "postgresql://postgres:postgres@localhost/test",
  ALLOW_INSECURE_LOCAL_DATABASE: "true",
});

describe("YooKassa environment contract", () => {
  it("is disabled by default and exposes no credential", () => {
    const config = loadEnv(base());
    expect(config.features.yookassa).toBe(false);
    expect(config.integrations.payments).toBe(false);
    expect(config.yookassa).toBeUndefined();
  });

  it("rejects partial activation before runtime composition", () => {
    expect(() => loadEnv({ ...base(), YOOKASSA_ENABLED: "true" })).toThrow(
      "yookassa_configuration_incomplete",
    );
  });

  it("returns only a secret reference for a complete synthetic test config", () => {
    const config = loadEnv({
      ...base(),
      YOOKASSA_ENABLED: "true",
      PAYMENTS_ENABLED: "true",
      PAYMENT_PROVIDER: "yookassa",
      YOOKASSA_MODE: "test",
      YOOKASSA_SHOP_ID: "123456",
      YOOKASSA_SECRET_KEY: "synthetic-test-secret",
      YOOKASSA_SECRET_REF: "env://YOOKASSA_SECRET_KEY",
      YOOKASSA_RETURN_URL: "https://ii-tonya.ru/payments/return",
      YOOKASSA_RECEIPT_VAT_CODE: "1",
      YOOKASSA_RECEIPT_PAYMENT_SUBJECT: "service",
      YOOKASSA_RECEIPT_PAYMENT_MODE: "full_payment",
    });
    expect(config.integrations.payments).toBe(true);
    expect(config.features.yookassa).toBe(true);
    expect(config.yookassa?.secretReference).toBe("env://YOOKASSA_SECRET_KEY");
    expect(JSON.stringify(config)).not.toContain("synthetic-test-secret");
  });

  it("keeps rollback disabled when stored credentials remain present", () => {
    const config = loadEnv({
      ...base(),
      YOOKASSA_ENABLED: "false",
      PAYMENTS_ENABLED: "false",
      PAYMENT_PROVIDER: "disabled",
      YOOKASSA_MODE: "live",
      YOOKASSA_SHOP_ID: "123456",
      YOOKASSA_SECRET_KEY: "stored-but-disabled-secret",
      YOOKASSA_SECRET_REF: "env://YOOKASSA_SECRET_KEY",
      YOOKASSA_RETURN_URL: "https://ii-tonya.ru/payments/return",
      YOOKASSA_RECEIPT_VAT_CODE: "1",
      YOOKASSA_RECEIPT_PAYMENT_SUBJECT: "service",
      YOOKASSA_RECEIPT_PAYMENT_MODE: "full_payment",
    });
    expect(config.features.yookassa).toBe(false);
    expect(config.integrations.payments).toBe(false);
    expect(config.yookassa).toBeUndefined();
    expect(JSON.stringify(config)).not.toContain("stored-but-disabled-secret");
  });
});
