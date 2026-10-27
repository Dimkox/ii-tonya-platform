import { describe, expect, it, vi } from "vitest";
import { createClientBookingService } from "./client-booking-service.js";

const principal = {
  authenticated: true,
  active: true,
  userId: "00000000-0000-4000-8000-000000000101",
} as const;
const handle = (index: number): `bk1.${string}` =>
  `bk1.${String(index).padStart(43, "A")}`;
const row = (index: number) => ({
  bookingHandle: handle(index),
  state: "reserved" as const,
  startsAt: new Date("2026-10-10T12:00:00Z"),
  reservedUntil: new Date("2026-10-09T12:00:00Z"),
  internalId: "must-not-escape",
});
const setup = (rows = [row(1)], kind: "found" | "not_found" = "found") => {
  const listOwnedActive = vi.fn(async () =>
    kind === "found" ? { kind, bookings: rows } : { kind },
  );
  const service = createClientBookingService({
    repository: {
      reserveProtectedChoice: async () => ({ kind: "not_found" }),
      cancelOwnedByHandle: async () => ({ kind: "not_found" }),
      listOwnedActive,
    },
  });
  return { service, listOwnedActive };
};

describe("owner booking page projection", () => {
  it.each([0, 20, 21])(
    "bounds %i rows and exposes a continuation only for overflow",
    async (count) => {
      const { service } = setup(
        Array.from({ length: count }, (_, i) => row(i)),
      );
      const page = await service.list(principal);
      expect(page.bookings).toHaveLength(Math.min(count, 20));
      expect(page.nextCursor).toBe(count === 21 ? handle(19) : null);
    },
  );
  it("projects only public fields with canonical UTC dates", async () => {
    const { service, listOwnedActive } = setup();
    expect(await service.list(principal, handle(0))).toEqual({
      bookings: [
        {
          bookingHandle: handle(1),
          state: "reserved",
          startsAt: "2026-10-10T12:00:00.000Z",
          reservedUntil: "2026-10-09T12:00:00.000Z",
        },
      ],
      nextCursor: null,
    });
    expect(listOwnedActive).toHaveBeenCalledWith({
      userId: principal.userId,
      after: handle(0),
    });
  });
  it("rejects an absent or foreign cursor identically", async () => {
    await expect(
      setup([], "not_found").service.list(principal, handle(0)),
    ).rejects.toThrow("client_booking_not_found");
  });
  it("denies inactive principals before repository access", async () => {
    const { service, listOwnedActive } = setup();
    await expect(
      service.list({ ...principal, active: false } as never),
    ).rejects.toThrow("client_booking_unauthorized");
    expect(listOwnedActive).not.toHaveBeenCalled();
  });
  it("rejects malformed cursors before repository access", async () => {
    const { service, listOwnedActive } = setup();
    await expect(service.list(principal, "bad")).rejects.toThrow(
      "client_booking_invalid_request",
    );
    expect(listOwnedActive).not.toHaveBeenCalled();
  });
  it("never serializes invalid database timestamps", async () => {
    const invalid = row(1);
    invalid.startsAt = new Date(NaN);
    await expect(setup([invalid]).service.list(principal)).rejects.toThrow(
      "client_booking_invalid_timestamp",
    );
  });
});
