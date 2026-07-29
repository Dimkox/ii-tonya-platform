import { describe, expect, it } from "vitest";
import {
  BookingDataIntegrityError,
  normalizeBookingTimestamp,
  normalizeNullableBookingTimestamp,
} from "../../packages/db/src/repositories/booking-repository.js";

describe("booking timestamp normalization", () => {
  it("normalizes PostgreSQL strings and Date values to the same instant", () => {
    const expected = new Date("2026-07-28T10:00:00.123Z");

    expect(normalizeBookingTimestamp(
      "2026-07-28 10:00:00.123+00",
      "slots.observed_at",
    )).toEqual(expected);
    expect(normalizeBookingTimestamp(
      expected,
      "slots.observed_at",
    )).toEqual(expected);
    expect(normalizeNullableBookingTimestamp(null, "slots.observed_at")).toBeNull();
  });

  it.each([
    ["not-a-timestamp"],
    [new Date(Number.NaN)],
  ])("fails closed for invalid timestamp %s", (value) => {
    expect(() => normalizeBookingTimestamp(
      value,
      "reservations.reserved_until",
    )).toThrow(BookingDataIntegrityError);
    expect(() => normalizeBookingTimestamp(
      value,
      "reservations.reserved_until",
    )).toThrow("Invalid database timestamp: reservations.reserved_until");
  });
});
