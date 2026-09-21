import { describe, expect, it } from "vitest";

import { loadEnv } from "./env.js";

const base = (extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv => ({
  DATABASE_URL: "postgresql://user:password@localhost/test",
  ALLOW_INSECURE_LOCAL_DATABASE: "true",
  ...extra,
});

describe("client privacy flag", () => {
  it("is off unless stated explicitly", () => {
    expect(loadEnv(base()).features.clientPrivacy).toBe(false);
  });

  it("rejects privacy routes without the session that authenticates them", () => {
    expect(() => loadEnv(base({ CLIENT_PRIVACY_ENABLED: "true" }))).toThrow(
      "client_privacy_requires_client_session",
    );
  });

  it("turns on together with client sessions", () => {
    expect(
      loadEnv(
        base({
          CLIENT_SESSION_ENABLED: "true",
          CLIENT_PRIVACY_ENABLED: "true",
        }),
      ).features.clientPrivacy,
    ).toBe(true);
  });
});
