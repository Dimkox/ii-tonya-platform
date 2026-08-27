import { describe, expect, it } from "vitest";

import { sanitizeTelemetry } from "./logger.js";
import { clientBookingMetricLabels } from "./metrics.js";

describe("client booking observability", () => {
  it("accepts only fixed low-cardinality booking labels", () => {
    expect(
      clientBookingMetricLabels({ operation: "reserve", outcome: "created" }),
    ).toEqual({ operation: "reserve", outcome: "created" });
    expect(() =>
      clientBookingMetricLabels({
        operation: "reserve",
        outcome: "created",
        bookingHandle: `bk1.${"A".repeat(43)}`,
      }),
    ).toThrow("invalid_client_booking_metric_labels");
  });

  it("redacts handles, digests and IDs from keys and free text", () => {
    const result = JSON.stringify(
      sanitizeTelemetry({
        bookingHandle: `bk1.${"A".repeat(43)}`,
        message: `choice ch1.${"B".repeat(43)}`,
        reservationId: "00000000-0000-4000-8000-000000000101",
      }),
    );
    expect(result).not.toContain("bk1.");
    expect(result).not.toContain("ch1.");
    expect(result).not.toContain("00000000-0000-4000-8000-000000000101");
  });
});
