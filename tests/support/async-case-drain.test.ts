import { afterEach, expect, it, vi } from "vitest";
import { createAsyncCaseDrainFence } from "./async-case-drain.js";
function deferred() {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});
it("waits for the entire deferred body after the runner has returned before permitting reset", async () => {
  const fence = createAsyncCaseDrainFence({ drainTimeoutMs: 100 });
  const body = deferred();
  const result = fence.run(() => body.promise);
  // Model the runner abandoning its await on timeout, without settling the body.
  let runnerReturned = false;
  await Promise.resolve().then(() => {
    runnerReturned = true;
  });
  expect(runnerReturned).toBe(true);
  expect(() => fence.assertReady()).toThrow("async_case_body_still_running");
  let drained = false;
  const cleanup = fence.drain().then(() => {
    drained = true;
  });
  await Promise.resolve();
  expect(drained).toBe(false);
  body.resolve();
  await cleanup;
  await result;
  expect(drained).toBe(true);
  expect(() => fence.assertReady()).not.toThrow();
});
it("observes rejection immediately while preserving the original rejection for the runner", async () => {
  const fence = createAsyncCaseDrainFence({ drainTimeoutMs: 100 });
  const body = deferred();
  const error = new Error("case_failed_after_runner_timeout");
  const result = fence.run(() => body.promise);
  body.reject(error);
  // Intentionally drain before attaching the runner's later assertion.
  await fence.drain();
  await expect(result).rejects.toBe(error);
  expect(() => fence.assertReady()).not.toThrow();
});
it("bounds a stuck cleanup and permanently prevents a later fixture reset or body even if it eventually ends", async () => {
  vi.useFakeTimers();
  const fence = createAsyncCaseDrainFence({ drainTimeoutMs: 20 });
  const body = deferred();
  const result = fence.run(() => body.promise);
  const drained = expect(fence.drain()).rejects.toThrow(
    "async_case_drain_timeout",
  );
  await vi.advanceTimersByTimeAsync(20);
  await drained;
  const reset = vi.fn();
  expect(() => {
    fence.assertReady();
    reset();
  }).toThrow("async_case_drain_poisoned");
  expect(reset).not.toHaveBeenCalled();
  const anotherBody = vi.fn(async () => {});
  await expect(fence.run(anotherBody)).rejects.toThrow(
    "async_case_drain_poisoned",
  );
  expect(anotherBody).not.toHaveBeenCalled();
  body.resolve();
  await result;
  expect(() => fence.assertReady()).toThrow("async_case_drain_poisoned");
});
it("permits the next completed setup hook immediately after its awaited body settles", async () => {
  const fence = createAsyncCaseDrainFence({ drainTimeoutMs: 100 });
  await fence.run(async () => {});
  expect(() => fence.assertReady()).not.toThrow();
});

it("poisons on elapsed monotonic deadline even when the timer callback is delayed behind body completion", async () => {
  let now = 0;
  vi.spyOn(performance, "now").mockImplementation(() => now);
  const fence = createAsyncCaseDrainFence({ drainTimeoutMs: 100 });
  const body = deferred();
  const result = fence.run(() => body.promise);
  const cleanup = expect(fence.drain()).rejects.toThrow(
    "async_case_drain_timeout",
  );
  // Model an occupied event loop: monotonic time advanced, timer not dispatched.
  now = 101;
  body.resolve();
  await cleanup;
  await result;
  expect(() => fence.assertReady()).toThrow("async_case_drain_poisoned");
});
