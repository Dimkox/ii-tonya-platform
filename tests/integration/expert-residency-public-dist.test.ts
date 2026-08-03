import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";

describe("expert residency public distribution boundary", () => {
  it("does not expose a signing fixture and rejects common forgeries", async () => {
    const entry = pathToFileURL(
      resolve("packages/integrations/dist/index.js"),
    ).href;
    const publicApi = (await import(entry)) as Record<string, unknown> & {
      assertVerifiedExpertResidencyPaymentEvent(value: unknown): void;
    };
    expect(publicApi.verifiedEventFixture).toBeUndefined();
    const symbolForgery = {
      [Symbol.for("ii-tonya.verified-expert-residency-event")]: true,
    };
    for (const forgery of [
      { kind: "settled" },
      Object.freeze({}),
      symbolForgery,
    ]) {
      expect(() =>
        publicApi.assertVerifiedExpertResidencyPaymentEvent(forgery),
      ).toThrow("verified_event_required");
    }
  });
});
