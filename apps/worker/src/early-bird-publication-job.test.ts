import { describe, expect, it, vi } from "vitest";
import { createEarlyBirdPublicationJob } from "./early-bird-publication-job.js";

describe("early bird publication worker", () => {
  it("continues past a stale candidate and publishes the next reviewed candidate", async () => {
    const activate = vi
      .fn()
      .mockRejectedValueOnce(new Error("stale"))
      .mockResolvedValueOnce(undefined);
    const scan = vi.fn().mockResolvedValueOnce([
      { userId: "u1", sourceId: "s1" },
      { userId: "u2", sourceId: "s2" },
    ]);
    const run = createEarlyBirdPublicationJob({ scan, activate });
    expect(await run(2)).toEqual({ attempted: 2, published: 1, failed: 1 });
    expect(activate).toHaveBeenCalledTimes(2);
  });
  it("does not scan when cancelled and rejects unbounded batches", async () => {
    const store = { scan: vi.fn(), activate: vi.fn() };
    const run = createEarlyBirdPublicationJob(store);
    const controller = new AbortController();
    controller.abort();
    expect(await run(1, controller.signal)).toEqual({
      attempted: 0,
      published: 0,
      failed: 0,
    });
    expect(store.scan).not.toHaveBeenCalled();
    await expect(run(51)).rejects.toThrow(
      "early_bird_publication_limit_invalid",
    );
  });
});
