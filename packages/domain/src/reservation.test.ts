import { describe, expect, it } from "vitest";
import { computeReservedUntil, transitionReservation } from "./reservation.js";

describe("reservation policy", () => {
  it("uses the earlier of 72 hours and slot start minus the one-hour buffer", () => {
    const createdAt = new Date("2026-07-28T10:00:00.000Z");
    expect(computeReservedUntil(
      createdAt,
      new Date("2026-07-30T12:00:00.000Z"),
      60 * 60 * 1_000,
    ).toISOString()).toBe("2026-07-30T11:00:00.000Z");
  });

  it("rejects a deadline that is not after creation", () => {
    expect(() => computeReservedUntil(
      new Date("2026-07-28T10:00:00.000Z"),
      new Date("2026-07-28T11:00:00.000Z"),
      60 * 60 * 1_000,
    )).toThrow("Reservation deadline has already passed");
  });

  it("allows only normative transitions", () => {
    expect(transitionReservation("reserved", "expert_confirm")).toBe("booked");
    expect(transitionReservation("reserved", "expire")).toBe("expired");
    expect(() => transitionReservation("expired", "expert_confirm")).toThrow("Invalid reservation transition");
    expect(transitionReservation("booked", "mark_no_show")).toBe("no_show");
  });
});
