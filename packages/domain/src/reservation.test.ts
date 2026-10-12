import { describe, expect, it } from "vitest";
import { computeReservedUntil, transitionReservation } from "./reservation.js";

describe("reservation policy", () => {
  it("uses the earlier of 72 hours and slot start minus the one-hour buffer", () => {
    const createdAt = new Date("2026-07-28T10:00:00.000Z");
    expect(
      computeReservedUntil(
        createdAt,
        new Date("2026-07-30T12:00:00.000Z"),
        60 * 60 * 1_000,
      ).toISOString(),
    ).toBe("2026-07-30T11:00:00.000Z");
  });

  it("rejects a deadline that is not after creation", () => {
    expect(() =>
      computeReservedUntil(
        new Date("2026-07-28T10:00:00.000Z"),
        new Date("2026-07-28T11:00:00.000Z"),
        60 * 60 * 1_000,
      ),
    ).toThrow("Reservation deadline has already passed");
  });

  it("uses the 72-hour cap when the slot is farther away", () => {
    expect(
      computeReservedUntil(
        new Date("2026-07-28T10:00:00.000Z"),
        new Date("2026-08-02T12:00:00.000Z"),
        60 * 60 * 1_000,
      ).toISOString(),
    ).toBe("2026-07-31T10:00:00.000Z");
  });

  it("rejects invalid dates and non-finite buffers", () => {
    const validCreatedAt = new Date("2026-07-28T10:00:00.000Z");
    const validSlotStartsAt = new Date("2026-07-29T12:00:00.000Z");
    const invalidInputs: readonly [Date, Date, number][] = [
      [new Date("invalid"), validSlotStartsAt, 0],
      [validCreatedAt, new Date("invalid"), 0],
      [validCreatedAt, validSlotStartsAt, Number.NaN],
      [validCreatedAt, validSlotStartsAt, Number.POSITIVE_INFINITY],
    ];
    for (const [createdAt, slotStartsAt, buffer] of invalidInputs) {
      expect(() =>
        computeReservedUntil(createdAt, slotStartsAt, buffer),
      ).toThrow("Invalid reservation deadline inputs");
    }
  });

  it("rejects negative buffers but permits a zero buffer with a future deadline", () => {
    const createdAt = new Date("2026-07-28T10:00:00.000Z");
    const slotStartsAt = new Date("2026-07-28T12:00:00.000Z");
    expect(() => computeReservedUntil(createdAt, slotStartsAt, -1)).toThrow(
      "Invalid reservation deadline inputs",
    );
    expect(computeReservedUntil(createdAt, slotStartsAt, 0).toISOString()).toBe(
      "2026-07-28T12:00:00.000Z",
    );
  });

  it("rejects finite buffers that produce an out-of-range deadline", () => {
    expect(() =>
      computeReservedUntil(
        new Date("2026-07-28T10:00:00.000Z"),
        new Date("2026-07-29T12:00:00.000Z"),
        Number.MAX_VALUE,
      ),
    ).toThrow("Invalid reservation deadline inputs");
  });

  it("allows only normative transitions", () => {
    expect(transitionReservation("reserved", "expert_confirm")).toBe(
      "reserved",
    );
    expect(transitionReservation("reserved", "expire")).toBe("expired");
    expect(() => transitionReservation("expired", "expert_confirm")).toThrow(
      "Invalid reservation transition",
    );
    expect(transitionReservation("booked", "mark_no_show")).toBe("no_show");
  });
});
