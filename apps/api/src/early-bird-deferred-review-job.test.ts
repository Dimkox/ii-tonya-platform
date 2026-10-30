import { expect, it, vi } from "vitest";
import { createDeferredReviewJob } from "./early-bird-deferred-review-job.js";
it("walks committed approvals, resets scan, and does not start work after stop", async () => {
  const list = vi
      .fn()
      .mockResolvedValueOnce([{ applicationId: "app", eventId: "event" }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]),
    afterApproval = vi.fn();
  const job = createDeferredReviewJob({ list }, { afterApproval });
  const controller = new AbortController();
  expect(await job.run(20, controller.signal)).toMatchObject({ processed: 1 });
  expect(afterApproval).toHaveBeenCalledOnce();
  await job.run(20, controller.signal);
  await job.run(20, controller.signal);
  expect(list.mock.calls.map((call) => call[0])).toEqual([
    undefined,
    "event",
    undefined,
  ]);
  controller.abort();
  expect(await job.run(20, controller.signal)).toBeNull();
  expect(list).toHaveBeenCalledTimes(3);
});
it("does not start preparation when shutdown happens during the approval read", async () => {
  let finish!: (value: { applicationId: string; eventId: string }[]) => void;
  const list = vi.fn(
      () =>
        new Promise<{ applicationId: string; eventId: string }[]>((resolve) => {
          finish = resolve;
        }),
    ),
    afterApproval = vi.fn(),
    job = createDeferredReviewJob({ list }, { afterApproval }),
    controller = new AbortController();
  const pending = job.run(20, controller.signal);
  await Promise.resolve();
  controller.abort();
  finish([{ applicationId: "app", eventId: "event" }]);
  expect(await pending).toBeNull();
  expect(afterApproval).not.toHaveBeenCalled();
});
it("allows an already-started idempotent preparation to finish after shutdown without starting another", async () => {
  let finish!: () => void;
  const started = new Promise<void>((resolve) => {
      finish = resolve;
    }),
    afterApproval = vi.fn(() => started),
    list = vi
      .fn()
      .mockResolvedValue([{ applicationId: "app", eventId: "event" }]),
    job = createDeferredReviewJob({ list }, { afterApproval }),
    controller = new AbortController();
  const running = job.run(20, controller.signal);
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  expect(afterApproval).toHaveBeenCalledOnce();
  controller.abort();
  expect(await job.run(20, controller.signal)).toBeNull();
  finish();
  expect(await running).toEqual({ processed: 1, failed: 0 });
  expect(afterApproval).toHaveBeenCalledOnce();
});
