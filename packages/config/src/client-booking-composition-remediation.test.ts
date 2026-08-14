import { describe, expect, it } from "vitest";

import { loadEnv } from "./env.js";

const base = (extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv => ({
  DATABASE_URL: "postgresql://user:password@localhost/test",
  ALLOW_INSECURE_LOCAL_DATABASE: "true",
  ...extra,
});

describe("client booking feature dependency chain", () => {
  it.each([
    { CLIENT_BOOKING_ENABLED: "true" },
    {
      CLIENT_SESSION_ENABLED: "true",
      CLIENT_BOOKING_ENABLED: "true",
    },
    {
      CLIENT_SESSION_ENABLED: "true",
      CLIENT_CATALOG_ENABLED: "true",
      CLIENT_BOOKING_RESERVE_ENABLED: "true",
    },
  ])("rejects an incomplete booking composition", (flags) => {
    expect(() => loadEnv(base(flags))).toThrow(
      "client_booking_configuration_incomplete",
    );
  });

  it("accepts the complete default-off dependency chain", () => {
    expect(
      loadEnv(
        base({
          CLIENT_SESSION_ENABLED: "true",
          CLIENT_CATALOG_ENABLED: "true",
          CLIENT_BOOKING_ENABLED: "true",
          CLIENT_BOOKING_RESERVE_ENABLED: "true",
        }),
      ).features,
    ).toMatchObject({
      clientSession: true,
      clientCatalog: true,
      clientBooking: true,
      clientBookingReserve: true,
    });
  });
});
