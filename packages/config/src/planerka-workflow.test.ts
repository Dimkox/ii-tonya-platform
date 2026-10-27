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
