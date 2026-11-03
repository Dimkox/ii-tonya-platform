import { expect, it } from "vitest";
import { loadEnv } from "./env.js";
const base = {
  DATABASE_URL: "postgresql://local:local@localhost/test",
  ALLOW_INSECURE_LOCAL_DATABASE: "true",
};
it("requires drain and credentials for new admission", () => {
  expect(() => loadEnv({ ...base, PLANERKA_CREATE_ENABLED: "true" })).toThrow();
});
it("retains recovery independently of new creation", () => {
  expect(
    loadEnv({
      ...base,
      PLANERKA_RECOVERY_ENABLED: "true",
      PLANERKA_API_KEY: "cal_fixture",
      PLANERKA_ACCOUNT_ID: "1",
    }),
  ).toMatchObject({ planerkaWorkflow: { createEnabled: false, accountId: 1 } });
});
it("no longer validates the legacy PLANERKA_ENABLED flag", () => {
  expect(() =>
    loadEnv({ ...base, PLANERKA_ENABLED: "true" }),
  ).not.toThrow();
  expect(loadEnv({ ...base, PLANERKA_ENABLED: "true" }).integrations.planerka).toBe(false);
});
it("enables the full Planerka workflow with recovery credentials", () => {
  expect(
    loadEnv({
      ...base,
      PLANERKA_RECOVERY_ENABLED: "true",
      PLANERKA_AVAILABILITY_ENABLED: "true",
      PLANERKA_CREATE_ENABLED: "true",
      PLANERKA_API_KEY: "cal_fixture",
      PLANERKA_ACCOUNT_ID: "42",
    }),
  ).toMatchObject({ planerkaWorkflow: { createEnabled: true, accountId: 42 } });
});
it("rejects availability without recovery credentials", () => {
  expect(() =>
    loadEnv({ ...base, PLANERKA_AVAILABILITY_ENABLED: "true", PLANERKA_RECOVERY_ENABLED: "true" }),
  ).toThrow();
});
