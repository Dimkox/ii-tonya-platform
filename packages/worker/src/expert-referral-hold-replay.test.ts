import { describe, expect, it, vi } from "vitest";
import { replayHeldRewards } from "./expert-referral-hold-replay.js";

describe("expert referral held-reward replay job", () => {
  it("reports a cancelled hold without ever granting it", async () => {
    const replayDueBatch = vi.fn(async () => ({
      examined: 1,
      granted: 0,
      debtRepaid: 0,
      ineligible: 0,
      cancelled: 1,
      stillHeld: 0,
      failed: 0,
    }));

    await expect(
      replayHeldRewards(
        { replayDueBatch },
        new Date("2026-09-02T00:00:00.000Z"),
        1,
      ),
    ).resolves.toEqual({
      examined: 1,
      granted: 0,
      debtRepaid: 0,
      ineligible: 0,
      cancelled: 1,
      stillHeld: 0,
      failed: 0,
    });
  });

  it.each([0, 1_001])(
    "rejects unsafe batch size %s before replay",
    async (batchSize) => {
      const replayDueBatch = vi.fn();

      await expect(
        replayHeldRewards(
          { replayDueBatch },
          new Date("2026-09-02T00:00:00.000Z"),
          batchSize,
        ),
      ).rejects.toThrow("invalid_batch_size");
      expect(replayDueBatch).not.toHaveBeenCalled();
    },
  );
});
