import { describe, expect, it, vi } from "vitest";
import { replayHeldRewards } from "./expert-referral-hold-replay.js";

describe("expert referral held reward replay", () => {
  it("preserves cancelled holds without granting credit", async () => {
    const replayDueBatch = vi.fn(async () => ({
      examined: 1,
      granted: 0,
      cancelled: 1,
    }));

    await expect(
      replayHeldRewards(
        { replayDueBatch },
        new Date("2026-08-11T08:00:00.000Z"),
        100,
      ),
    ).resolves.toEqual({ examined: 1, granted: 0, cancelled: 1 });
  });

  it("rejects invalid batch sizes", async () => {
    await expect(
      replayHeldRewards(
        { replayDueBatch: vi.fn() },
        new Date("2026-08-11T08:00:00.000Z"),
        0,
      ),
    ).rejects.toThrow("invalid_expert_referral_hold_replay_input");
  });
});
