import { describe, expect, it } from "vitest";
import { decideFinalCall } from "./early-bird-final-call.js";

const eligible = {
  paymentStatus: "ONBOARDING_ONLY" as const,
  verified: true,
  messagingConsent: true,
  triggerAtMs: Date.parse("2026-12-28T07:00:00Z"),
  clientStartAtMs: Date.parse("2027-01-10T21:00:00Z"),
  first: { status: "none" as const },
  repeat: { status: "none" as const },
};
const ms = (s: string) => Date.parse(s);

describe("early bird final-call scheduling", () => {
  it("starts at 10:00 Moscow on December 28 and catches up after a missed tick", () => {
    expect(
      decideFinalCall({ ...eligible, nowMs: ms("2026-12-28T06:59:59Z") }),
    ).toBeNull();
    expect(
      decideFinalCall({ ...eligible, nowMs: ms("2026-12-28T07:00:00Z") }),
    ).toBe("first");
    expect(
      decideFinalCall({ ...eligible, nowMs: ms("2026-12-29T11:00:00Z") }),
    ).toBe("first");
  });
  it("excludes paid, unverified and non-consenting residents", () => {
    const nowMs = ms("2026-12-28T07:00:00Z");
    expect(
      decideFinalCall({
        ...eligible,
        nowMs,
        paymentStatus: "FULLY_PREPAID_NO_DISCOUNT",
      }),
    ).toBeNull();
    expect(decideFinalCall({ ...eligible, nowMs, verified: false })).toBeNull();
    expect(
      decideFinalCall({ ...eligible, nowMs, messagingConsent: false }),
    ).toBeNull();
  });
  it("repeats no earlier than 72 hours after confirmed delivery and the next daily tick", () => {
    const first = {
      status: "delivered" as const,
      deliveredAtMs: ms("2026-12-28T10:00:00Z"),
    };
    expect(
      decideFinalCall({
        ...eligible,
        first,
        nowMs: ms("2026-12-31T10:00:00Z"),
      }),
    ).toBeNull();
    expect(
      decideFinalCall({
        ...eligible,
        first,
        nowMs: ms("2027-01-01T07:00:00Z"),
      }),
    ).toBe("repeat");
  });
  it("does not create duplicates for pending, uncertain or delivered attempts", () => {
    const nowMs = ms("2027-01-03T07:00:00Z");
    for (const status of ["pending", "uncertain"] as const) {
      expect(
        decideFinalCall({ ...eligible, nowMs, first: { status } }),
      ).toBeNull();
    }
    const first = {
      status: "delivered" as const,
      deliveredAtMs: ms("2026-12-28T07:00:00Z"),
    };
    for (const status of ["pending", "uncertain", "delivered"] as const) {
      expect(
        decideFinalCall({ ...eligible, nowMs, first, repeat: { status } }),
      ).toBeNull();
    }
  });
  it("rejects inconsistent histories and invalid confirmed delivery times", () => {
    const nowMs = ms("2027-01-03T07:00:00Z");
    expect(
      decideFinalCall({ ...eligible, nowMs, repeat: { status: "pending" } }),
    ).toBeNull();
    expect(
      decideFinalCall({ ...eligible, nowMs, first: { status: "delivered" } }),
    ).toBeNull();
    expect(
      decideFinalCall({
        ...eligible,
        nowMs,
        first: {
          status: "delivered",
          deliveredAtMs: ms("2027-01-04T07:00:00Z"),
        },
      }),
    ).toBeNull();
  });
  it("uses configured trigger and launch boundaries, and rejects invalid ranges", () => {
    const triggerAtMs = ms("2026-12-30T07:00:00Z");
    const clientStartAtMs = ms("2027-01-12T21:00:00Z");
    expect(
      decideFinalCall({
        ...eligible,
        triggerAtMs,
        clientStartAtMs,
        nowMs: triggerAtMs - 1,
      }),
    ).toBeNull();
    expect(
      decideFinalCall({
        ...eligible,
        triggerAtMs,
        clientStartAtMs,
        nowMs: triggerAtMs,
      }),
    ).toBe("first");
    expect(
      decideFinalCall({
        ...eligible,
        triggerAtMs,
        clientStartAtMs,
        nowMs: clientStartAtMs,
      }),
    ).toBeNull();
    expect(
      decideFinalCall({
        ...eligible,
        triggerAtMs: clientStartAtMs,
        clientStartAtMs,
        nowMs: clientStartAtMs,
      }),
    ).toBeNull();
  });
  it("stops when the payment deadline ends at midnight Moscow", () => {
    expect(
      decideFinalCall({ ...eligible, nowMs: ms("2027-01-10T20:59:59Z") }),
    ).toBe("first");
    expect(
      decideFinalCall({ ...eligible, nowMs: ms("2027-01-10T21:00:00Z") }),
    ).toBeNull();
  });
});

describe("configured daily schedule", () => {
  it("rounds repeat eligibility to the next configured daily tick and bounds launch", async () => {
    const { nextFinalCallTick } = await import("./early-bird-final-call.js");
    const trigger = Date.parse("2026-12-28T07:00:00Z");
    const start = Date.parse("2027-01-10T21:00:00Z");
    expect(nextFinalCallTick(trigger, trigger - 1, start)).toBe(trigger);
    expect(nextFinalCallTick(trigger, trigger + 1, start)).toBe(
      trigger + 86400000,
    );
    expect(nextFinalCallTick(trigger, start, start)).toBeNull();
    expect(nextFinalCallTick(NaN, trigger, start)).toBeNull();
  });
});
