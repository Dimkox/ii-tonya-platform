import { expect, it, vi } from "vitest";
import { reconcileEarlyBirdReviews } from "./early-bird-review-reconciler.js";
const events = [
  { applicationId: "app-a", eventId: "event-a" },
  { applicationId: "app-b", eventId: "event-b" },
];
it("replays durable approvals without a manager session and advances the cursor", async () => {
  const list = vi.fn(async () => events);
  const afterApproval = vi.fn(async () => {});
  expect(
    await reconcileEarlyBirdReviews({ list }, { afterApproval }, undefined, 2),
  ).toEqual({ processed: 2, failed: 0, cursor: "event-b" });
  expect(afterApproval.mock.calls).toEqual([[events[0]], [events[1]]]);
  expect(list).toHaveBeenCalledWith(undefined, 2);
});
it("isolates a failing event and retries it on the next full cycle", async () => {
  let fail = true;
  const afterApproval = vi.fn(async ({ eventId }: (typeof events)[number]) => {
    if (fail && eventId === "event-a") throw new Error("offline");
  });
  const reader = { list: async () => events };
  expect(
    await reconcileEarlyBirdReviews(reader, { afterApproval }, undefined, 2),
  ).toEqual({ processed: 1, failed: 1, cursor: "event-b" });
  expect(afterApproval.mock.calls).toEqual([[events[0]], [events[1]]]);
  fail = false;
  expect(
    await reconcileEarlyBirdReviews(reader, { afterApproval }, undefined, 2),
  ).toEqual({ processed: 2, failed: 0, cursor: "event-b" });
});
it("starts only when explicitly invoked and schedules scans without overlapping", async () => {
  vi.useFakeTimers();
  try {
    const list = vi.fn(async () => []);
    const afterApproval = vi.fn(async () => {});
    const { startEarlyBirdReviewReconciler } =
      await import("./early-bird-review-reconciler.js");
    const stop = startEarlyBirdReviewReconciler(
      { list },
      { afterApproval },
      { intervalMs: 1000, onError: vi.fn() },
    );
    await vi.advanceTimersByTimeAsync(1000);
    expect(list).toHaveBeenCalledTimes(1);
    stop();
    await vi.advanceTimersByTimeAsync(1000);
    expect(list).toHaveBeenCalledTimes(1);
  } finally {
    vi.useRealTimers();
  }
});
it("reports a failed event without exposing the exception", async () => {
  vi.useFakeTimers();
  try {
    const { startEarlyBirdReviewReconciler } =
      await import("./early-bird-review-reconciler.js");
    const onError = vi.fn();
    const stop = startEarlyBirdReviewReconciler(
      { list: async () => events },
      {
        afterApproval: async ({ eventId }) => {
          if (eventId === "event-a") throw new Error("private data");
        },
      },
      { intervalMs: 1000, onError },
    );
    await vi.advanceTimersByTimeAsync(1000);
    expect(onError).toHaveBeenCalledWith({ kind: "event", count: 1 });
    stop();
  } finally {
    vi.useRealTimers();
  }
});
it("times out a stuck event, advances and does not launch a duplicate while it remains in flight", async () => {
  vi.useFakeTimers();
  try {
    let release!: () => void;
    const stuck = new Promise<void>((resolve) => {
      release = resolve;
    });
    const afterApproval = vi.fn(
      async ({ eventId }: (typeof events)[number]) => {
        if (eventId === "event-a") await stuck;
      },
    );
    const reader = { list: async () => events };
    const first = reconcileEarlyBirdReviews(
      reader,
      { afterApproval },
      undefined,
      2,
      1000,
    );
    await vi.advanceTimersByTimeAsync(1000);
    expect(await first).toEqual({ processed: 1, failed: 1, cursor: "event-b" });
    const second = await reconcileEarlyBirdReviews(
      reader,
      { afterApproval },
      undefined,
      2,
      1000,
    );
    expect(second).toEqual({ processed: 1, failed: 1, cursor: "event-b" });
    expect(
      afterApproval.mock.calls.filter(([e]) => e.eventId === "event-a"),
    ).toHaveLength(1);
    release();
    await vi.advanceTimersByTimeAsync(0);
  } finally {
    vi.useRealTimers();
  }
});
it("bounds a stuck reader and does not overlap its still-running query", async () => {
  vi.useFakeTimers();
  try {
    let finish!: (value: typeof events) => void;
    const pending = new Promise<typeof events>((resolve) => {
      finish = resolve;
    });
    const list = vi.fn(() => pending);
    const reader = { list };
    const first = reconcileEarlyBirdReviews(
      reader,
      { afterApproval: async () => {} },
      undefined,
      2,
      1000,
    );
    const rejected = expect(first).rejects.toThrow(
      "early_bird_operation_timeout",
    );
    await vi.advanceTimersByTimeAsync(1000);
    await rejected;
    await expect(
      reconcileEarlyBirdReviews(
        reader,
        { afterApproval: async () => {} },
        undefined,
        2,
        1000,
      ),
    ).rejects.toThrow("early_bird_reader_inflight");
    expect(list).toHaveBeenCalledTimes(1);
    finish([]);
    await vi.advanceTimersByTimeAsync(0);
  } finally {
    vi.useRealTimers();
  }
});
