import { describe, expect, it } from "vitest";
import { loadEnv } from "./env.js";

const minimal = {
  NODE_ENV: "test",
  DATABASE_URL: "postgresql://u:p@db.example.test:5432/app?sslmode=verify-full",
};

describe("PAYMENTS_PILOT_* config (SCRUM-518)", () => {
  it("is absent by default", () => {
    expect(loadEnv(minimal).paymentsPilot).toBeUndefined();
  });
  it("parses one principal and a RUB cap into minor units", () => {
    expect(
      loadEnv({
        ...minimal,
        PAYMENTS_PILOT_ALLOWLIST: "42",
        PAYMENTS_PILOT_MAX_AMOUNT_RUB: "10",
      }).paymentsPilot,
    ).toEqual({
      principalId: "42",
      maxAmountMinor: 1000n,
      checkoutEnabled: false,
    });
  });
  it.each([
    { PAYMENTS_PILOT_ALLOWLIST: "42" },
    { PAYMENTS_PILOT_MAX_AMOUNT_RUB: "10" },
    { PAYMENTS_PILOT_ALLOWLIST: "1,2", PAYMENTS_PILOT_MAX_AMOUNT_RUB: "10" },
    { PAYMENTS_PILOT_ALLOWLIST: "42", PAYMENTS_PILOT_MAX_AMOUNT_RUB: "11" },
    // Checkout needs a UUID client principal, the direct shop and client sessions.
    {
      PAYMENTS_PILOT_ALLOWLIST: "42",
      PAYMENTS_PILOT_MAX_AMOUNT_RUB: "10",
      PAYMENTS_PILOT_CHECKOUT_ENABLED: "true",
    },
    { PAYMENTS_PILOT_CHECKOUT_ENABLED: "true" },
  ])("rejects %j", (extra) => {
    expect(() => loadEnv({ ...minimal, ...extra })).toThrow();
  });
});
