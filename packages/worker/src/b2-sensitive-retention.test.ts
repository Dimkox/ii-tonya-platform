import { describe, expect, it, vi } from "vitest";
import { runB2SensitiveRetention } from "./b2-sensitive-retention.js";

describe("B2 sensitive retention capability", () => {
  it("is default-off and does not invoke storage", async () => {
    const purgeExpired = vi.fn();
    await expect(
      runB2SensitiveRetention({
        enabled: false,
        repository: { purgeExpired },
        now: () => new Date(0),
        batchSize: 100,
      }),
    ).resolves.toEqual({
      inboundPurged: 0,
      outboxRedacted: 0,
      proposalsRedacted: 0,
    });
    expect(purgeExpired).not.toHaveBeenCalled();
  });
});
