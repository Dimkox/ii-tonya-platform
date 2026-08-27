import { describe, expect, it } from "vitest";

import { assertClientCapabilityPreflight } from "./client-capability-preflight.js";

describe("client booking preflight", () => {
  it("requires the complete default-off booking capability chain", () => {
    expect(() =>
      assertClientCapabilityPreflight(
        {
          clientSession: true,
          clientCatalog: true,
          clientBooking: true,
          clientBookingReserve: true,
          workerOutboxDelivery: true,
        },
        { identityProofVerifier: true, bookingRuntime: false },
      ),
    ).toThrow("Client booking runtime capability is required");
    expect(() =>
      assertClientCapabilityPreflight(
        { clientBooking: false, clientBookingReserve: true },
        { identityProofVerifier: false, bookingRuntime: true },
      ),
    ).toThrow("Client booking reserve requires client booking routes");
  });
});
