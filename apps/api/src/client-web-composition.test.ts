import { expect, it } from "vitest";
import { loadEnv } from "../../../packages/config/src/env.js";
import { createDefaultLifecycle } from "./server.js";
const base = {
  DATABASE_URL: "postgresql://localhost/test",
  ALLOW_INSECURE_LOCAL_DATABASE: "true",
  CLIENT_SESSION_ENABLED: "true",
  CLIENT_PRIVACY_ENABLED: "true",
  CLIENT_WEB_ORIGIN: "https://example.invalid",
  CLIENT_TELEGRAM_LOGIN_BOT_USERNAME: "synthetic_bot",
  TELEGRAM_BOT_TOKEN: "123456789:" + "T".repeat(35),
};
it("composes authentication with configured credentials while Telegram live integration remains disabled", () => {
  const config = loadEnv(base);
  expect(config.integrations.telegram).toBe(false);
  expect(() => createDefaultLifecycle().preflight(config)).not.toThrow();
});
it("rejects missing credentials and invalid/nonexact browser origins", () => {
  expect(() =>
    createDefaultLifecycle().preflight(
      loadEnv({ ...base, TELEGRAM_BOT_TOKEN: "" }),
    ),
  ).toThrow();
  for (const origin of [
    "http://example.invalid",
    "https://example.invalid/path",
    "https://example.invalid/",
    "https://example.invalid?query=1",
  ])
    expect(() => loadEnv({ ...base, CLIENT_WEB_ORIGIN: origin })).toThrow();
});
it("bounds the entire bot username including its bot suffix to 5..32 characters", () => {
  for (const name of ["aabot", "a".repeat(29) + "bot"])
    expect(() =>
      loadEnv({ ...base, CLIENT_TELEGRAM_LOGIN_BOT_USERNAME: name }),
    ).not.toThrow();
  for (const name of ["abot", "a".repeat(30) + "bot"])
    expect(() =>
      loadEnv({ ...base, CLIENT_TELEGRAM_LOGIN_BOT_USERNAME: name }),
    ).toThrow();
});
