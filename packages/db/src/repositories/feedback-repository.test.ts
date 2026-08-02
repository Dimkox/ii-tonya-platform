import { describe, expect, it } from "vitest";
import {
  FeedbackIdempotencyConflictError,
  assertFeedbackReplayMatches,
} from "./feedback-repository.js";

const canonical = {
  userId: "user-1",
  reservationId: "reservation-1",
  score: 2,
  contentHash: "content-hash-1",
  negativePolicyVersion: "negative-v1",
} as const;

describe("feedback source event semantic replay", () => {
  it.each([
    ["user", { ...canonical, userId: "user-2" }],
    ["reservation", { ...canonical, reservationId: "reservation-2" }],
    ["score", { ...canonical, score: 3 }],
    ["text hash", { ...canonical, contentHash: "content-hash-2" }],
    ["policy", { ...canonical, negativePolicyVersion: "negative-v2" }],
  ] as const)("rejects changed %s without leaking stored identifiers", (_field, replay) => {
    expect(() => assertFeedbackReplayMatches(canonical, replay)).toThrow(FeedbackIdempotencyConflictError);
    expect(() => assertFeedbackReplayMatches(canonical, replay)).toThrow("Feedback source event conflicts with its original request");
  });

  it("accepts an exact canonical replay", () => {
    expect(() => assertFeedbackReplayMatches(canonical, { ...canonical })).not.toThrow();
  });
});
