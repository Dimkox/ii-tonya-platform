import { expect, it, vi } from "vitest";
import { createFinalCallScheduler } from "./early-bird-final-call-scheduler.js";
it("polls at most once per minute, catches up immediately and stops safely", async () => {
  let now = 1000;
  const run = vi.fn().mockResolvedValue({ queued: 0 });
  const scheduler = createFinalCallScheduler({ run }, () => now);
  expect(await scheduler.run()).toEqual({ queued: 0 });
  expect(await scheduler.run()).toBeNull();
  now += 59999;
  expect(await scheduler.run()).toBeNull();
  now++;
  expect(await scheduler.run()).toEqual({ queued: 0 });
  scheduler.stop();
  expect(await scheduler.run()).toBeNull();
  expect(run).toHaveBeenCalledTimes(2);
  expect(run.mock.calls[0]?.[0]).toBe(20);
  expect(run.mock.calls[0]?.[1]).toBeInstanceOf(AbortSignal);
});
