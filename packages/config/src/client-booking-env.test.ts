import { describe, expect, it } from "vitest";

import { loadEnv } from "./env.js";

const base = (overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv => ({
  DATABASE_URL: "postgres://postgres:postgres@postgres:5432/ii_tonya",
  ALLOW_INSECURE_LOCAL_DATABASE: "true",
  ...overrides,
});

describe("client booking environment", () => {
  it("defaults both capabilities off and the confirmation buffer to 60 minutes", () => {
    const result = loadEnv(base());
    expect(result.features.clientBooking).toBe(false);
    expect(result.features.clientBookingReserve).toBe(false);
    expect(result.clientBookingConfirmationBufferMs).toBe(3_600_000);
  });

  it("accepts only literal boolean gates and a bounded positive minute value", () => {
    expect(
      loadEnv(
        base({
          CLIENT_SESSION_ENABLED: "true",
          CLIENT_CATALOG_ENABLED: "true",
          CLIENT_BOOKING_ENABLED: "true",
          CLIENT_BOOKING_RESERVE_ENABLED: "true",
          CLIENT_BOOKING_CONFIRMATION_BUFFER_MINUTES: "30",
        }),
      ),
    ).toMatchObject({
      features: { clientBooking: true, clientBookingReserve: true },
      clientBookingConfirmationBufferMs: 1_800_000,
    });
    for (const value of ["0", "4321", "1.5", "-1", "NaN"]) {
      expect(() =>
        loadEnv(base({ CLIENT_BOOKING_CONFIRMATION_BUFFER_MINUTES: value })),
      ).toThrow();
    }
    expect(() => loadEnv(base({ CLIENT_BOOKING_ENABLED: "TRUE" }))).toThrow();
  });
});
