import { expect, it } from "vitest";
import { loadEnv } from "./env.js";
const base = {
  DATABASE_URL: "postgresql://local:local@localhost/test",
  ALLOW_INSECURE_LOCAL_DATABASE: "true",
};
it("keeps test-pricing admin off unless explicitly enabled", () => {
  expect(loadEnv(base).features.ownerTestPricingAdmin).not.toBe(true);
  expect(
    loadEnv({ ...base, OWNER_TEST_PRICING_ADMIN_ENABLED: "true" }).features
      .ownerTestPricingAdmin,
  ).toBe(true);
  expect(() =>
    loadEnv({ ...base, OWNER_TEST_PRICING_ADMIN_ENABLED: "1" }),
  ).toThrow();
});
