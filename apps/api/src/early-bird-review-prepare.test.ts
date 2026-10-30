import { expect, it, vi } from "vitest";
import { wrapEarlyBirdReview } from "./early-bird-review-prepare.js";
const eventId = "2526c71d-803f-4c3d-9b57-74e902170001";
const applicationId = "2526c71d-803f-4c3d-9b57-74e902170002";
function review(action: string, replay = false) {
  return {
    confirm: vi.fn(async () => ({ eventId, action, replay })),
    preview: vi.fn(),
    closeUnknown: vi.fn(),
    expireRequests: vi.fn(),
  };
}
it("after an approved manager decision triggers preparation for both first confirmation and replay", async () => {
  const r = review("APPROVED_BASIC");
  const afterApproval = vi.fn(async () => {});
  const wrapped = wrapEarlyBirdReview(r, { afterApproval });
  expect(
    await wrapped.confirm("session", applicationId, "preview", "hash"),
  ).toEqual({ eventId, action: "APPROVED_BASIC", replay: false });
  expect(afterApproval).toHaveBeenCalledWith({ applicationId, eventId });
  await wrapEarlyBirdReview(review("APPROVED_EXCLUSIVE", true), {
    afterApproval,
  }).confirm("session", applicationId, "preview", "hash");
  expect(afterApproval).toHaveBeenCalledTimes(2);
});
it("is default off and does not invoke preparation for rejection", async () => {
  const prepare = vi.fn();
  const r = review("REJECT_HARD");
  await wrapEarlyBirdReview(r, { afterApproval: prepare }).confirm(
    "session",
    applicationId,
    "preview",
    "hash",
  );
  await wrapEarlyBirdReview(review("APPROVED_BASIC")).confirm(
    "session",
    applicationId,
    "preview",
    "hash",
  );
  expect(prepare).not.toHaveBeenCalled();
});
it("propagates failure so an idempotent confirmation replay can retry preparation", async () => {
  const prepare = vi.fn(async () => {
    throw new Error("not ready");
  });
  await expect(
    wrapEarlyBirdReview(review("APPROVED_BASIC"), {
      afterApproval: prepare,
    }).confirm("session", applicationId, "preview", "hash"),
  ).rejects.toThrow("not ready");
});
it("bounds a stuck preparation without cancelling or duplicating it on confirmation replay", async () => {
  vi.useFakeTimers();
  try {
    let finish!: () => void;
    const pending = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const afterApproval = vi.fn(() => pending);
    const wrapped = wrapEarlyBirdReview(review("APPROVED_BASIC"), {
      afterApproval,
    });
    const first = wrapped.confirm("session", applicationId, "preview", "hash");
    const rejected = expect(first).rejects.toThrow(
      "early_bird_operation_timeout",
    );
    await vi.advanceTimersByTimeAsync(5000);
    await rejected;
    const second = wrapped.confirm("session", applicationId, "preview", "hash");
    await vi.advanceTimersByTimeAsync(0);
    expect(afterApproval).toHaveBeenCalledTimes(1);
    finish();
    await expect(second).resolves.toMatchObject({ eventId });
  } finally {
    vi.useRealTimers();
  }
});
