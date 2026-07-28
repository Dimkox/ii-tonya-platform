import { describe, expect, it } from "vitest";
import { eventEnvelopeSchema, toUtcIso } from "./index.js";

describe("canonical contracts", () => {
  it("accepts a UTC event and rejects an offset timestamp", () => {
    const valid = {
      eventId: "018f47d6-9e75-7ca1-8a31-3fc6f06ca1c4",
      eventType: "reservation.created",
      occurredAt: "2026-07-28T10:00:00.000Z",
      correlationId: "corr-1",
      payload: { reservationId: "r-1" },
    };

    expect(eventEnvelopeSchema.parse(valid)).toEqual(valid);
    expect(() => eventEnvelopeSchema.parse({ ...valid, occurredAt: "2026-07-28T13:00:00+03:00" })).toThrow();
    expect(toUtcIso(new Date("2026-07-28T13:00:00+03:00"))).toBe("2026-07-28T10:00:00.000Z");
  });
});
