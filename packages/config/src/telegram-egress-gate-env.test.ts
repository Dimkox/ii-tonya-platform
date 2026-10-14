import { describe, expect, it } from "vitest";

import { loadEnv } from "./env.js";

const base = (extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv => ({
  DATABASE_URL: "postgresql://user:password@localhost/test",
  ALLOW_INSECURE_LOCAL_DATABASE: "true",
  ...extra,
});

describe("telegram egress consent gate flag", () => {
  it("is off unless stated explicitly", () => {
    expect(loadEnv(base()).features.telegramEgressConsentGate).toBe(false);
  });

  it("rejects a gate without the channel it is supposed to guard", () => {
    expect(() =>
      loadEnv(base({ TELEGRAM_EGRESS_CONSENT_GATE_ENABLED: "true" })),
    ).toThrow("telegram_egress_consent_gate_requires_dispatch");
  });

  it("turns on together with the telegram dispatch channel", () => {
    expect(
      loadEnv(
        base({
          B2_TELEGRAM_DISPATCH_ENABLED: "true",
          TELEGRAM_EGRESS_CONSENT_GATE_ENABLED: "true",
        }),
      ).features.telegramEgressConsentGate,
    ).toBe(true);
  });
});
