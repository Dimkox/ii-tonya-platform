import { createHash } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import { createClientBookingPrincipalResolver } from "./client-booking-principal-resolver.js";

const token = `cs1.${"A".repeat(43)}` as const;
const userId = "00000000-0000-4000-8000-000000000101";

describe("client booking principal resolver", () => {
  it("uses only exact bearer grammar and the booking-write repository capability", async () => {
    const resolveBooking = vi.fn(async () => ({
      kind: "resolved" as const,
      principal: {
        authenticated: true as const,
        active: true as const,
        userId,
      },
    }));
    const resolver = createClientBookingPrincipalResolver({ resolveBooking });

    await expect(resolver.resolve(`Bearer ${token}`)).resolves.toEqual({
      kind: "resolved",
      principal: { authenticated: true, active: true, userId },
    });
    expect(resolveBooking).toHaveBeenCalledWith(
      `sha256:${createHash("sha256").update(token).digest("hex")}`,
    );
    await expect(resolver.resolve(`bearer ${token}`)).resolves.toEqual({
      kind: "denied",
    });
  });

  it("fails closed on malformed or unavailable repository results", async () => {
    const malformed = createClientBookingPrincipalResolver({
      resolveBooking: async () => ({ kind: "resolved", principal: { userId } }),
    });
    await expect(malformed.resolve(`Bearer ${token}`)).resolves.toEqual({
      kind: "denied",
    });
    const unavailable = createClientBookingPrincipalResolver({
      resolveBooking: async () => {
        throw new Error("database unavailable");
      },
    });
    await expect(unavailable.resolve(`Bearer ${token}`)).resolves.toEqual({
      kind: "unavailable",
    });
  });
});
