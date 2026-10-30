import { expect, it } from "vitest";
import { loadEnv } from "@ii-tonya/config";
import { createDefaultLifecycle } from "./server.js";
it("rejects checkout activation without an explicit cancellation gateway", () => {
  const config = loadEnv({
    DATABASE_URL: "postgresql://local:local@localhost/test",
    ALLOW_INSECURE_LOCAL_DATABASE: "true",
  });
  config.expertVerification = { checkoutEnabled: true } as never;
  expect(() => createDefaultLifecycle().preflight(config)).toThrow(
    "receipt disclosure cancellation gateway required",
  );
});
