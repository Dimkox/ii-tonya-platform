import { createHash } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import {
  ClientBookingConflictError,
  ClientBookingNotFoundError,
  createClientBookingService,
} from "./client-booking-service.js";
import { createBookingService } from "./booking-service.js";

const userId = "00000000-0000-4000-8000-000000000101";
const choiceHandle = `ch1.${"A".repeat(43)}` as const;
const bookingHandle = `bk1.${"B".repeat(43)}` as const;
const choiceDigest = `sha256:${createHash("sha256")
  .update(choiceHandle)
  .digest("hex")}` as const;

describe("client booking application boundary", () => {
  it("uses the 60-minute booking confirmation buffer and rejects invalid overrides", async () => {
    const reserveAndPublish = vi.fn(async () => ({
      kind: "unavailable" as const,
      reason: "deadline",
    }));
    const repository = {
      searchSlots: async () => [],
      reserveAndPublish,
      transitionAndPublish: vi.fn(),
      transitionFromTelegramCallback: vi.fn(),
      listAuthorizedExpertSchedule: vi.fn(),
    };
    await createBookingService({
      repository,
      clock: { now: () => new Date("2026-08-14T10:00:00.000Z") },
    }).reserve({
      idempotencyKey: "server-derived",
      userId,
      slotId: "00000000-0000-4000-8000-000000000102",
      now: new Date(0),
      correlationId: "buffer",
    });
    expect(reserveAndPublish).toHaveBeenCalledWith(
      expect.objectContaining({ confirmationBufferMs: 3_600_000 }),
    );
    expect(() =>
      createBookingService({
        repository,
        clock: { now: () => new Date() },
        confirmationBufferMs: 0,
      }),
    ).toThrow("Invalid booking confirmation buffer");
  });

  it("derives all authority and idempotency from the principal and protected handle", async () => {
    const reserveProtectedChoice = vi.fn(async () => ({
      kind: "reserved" as const,
      bookingHandle,
      reservationStatus: "reserved" as const,
      reservedUntil: new Date("2026-08-16T11:00:00.000Z"),
    }));
    const service = createClientBookingService({
      repository: {
        reserveProtectedChoice,
        cancelOwnedByHandle: async () => ({ kind: "not_found" as const }),
        listOwnedActive: vi.fn(),
      },
      generateBookingHandle: () => bookingHandle,
      newCorrelationId: () => "reserve-correlation",
    });

    await expect(
      service.reserve(
        { authenticated: true, active: true, userId },
        { choiceHandle },
      ),
    ).resolves.toEqual({
      created: true,
      bookingHandle,
      state: "reserved",
      reservedUntil: "2026-08-16T11:00:00.000Z",
    });
    expect(reserveProtectedChoice).toHaveBeenCalledWith({
      userId,
      choiceDigest,
      idempotencyKey: createHash("sha256")
        .update(`client-booking-reserve-v1\0${userId}\0${choiceDigest}`)
        .digest("hex"),
      bookingHandle,
      correlationId: "reserve-correlation",
      minimumLeadMs: 86_400_000,
      slotFreshnessMs: 900_000,
      confirmationBufferMs: 3_600_000,
    });
  });

  it("rejects hostile principals and malformed handles before repository access", async () => {
    const reserveProtectedChoice = vi.fn();
    const service = createClientBookingService({
      repository: {
        reserveProtectedChoice,
        cancelOwnedByHandle: vi.fn(),
        listOwnedActive: vi.fn(),
      },
    });

    await expect(
      service.reserve({ authenticated: false } as never, { choiceHandle }),
    ).rejects.toThrow("client_booking_unauthorized");
    await expect(
      service.reserve(
        { authenticated: true, active: true, userId },
        { choiceHandle: `${choiceHandle}x` },
      ),
    ).rejects.toThrow("client_booking_invalid_request");
    expect(reserveProtectedChoice).not.toHaveBeenCalled();
  });

  it("retries only booking-handle collisions and preserves replay state", async () => {
    const reserveProtectedChoice = vi
      .fn()
      .mockResolvedValueOnce({ kind: "handle_collision" as const })
      .mockResolvedValueOnce({
        kind: "replayed" as const,
        bookingHandle,
        reservationStatus: "booked" as const,
        reservedUntil: new Date("2026-08-16T11:00:00.000Z"),
      });
    let handleAttempt = 0;
    const service = createClientBookingService({
      repository: {
        reserveProtectedChoice,
        cancelOwnedByHandle: vi.fn(),
        listOwnedActive: vi.fn(),
      },
      generateBookingHandle: () => {
        handleAttempt += 1;
        return `bk1.${String(handleAttempt).padStart(43, "A")}` as const;
      },
    });

    await expect(
      service.reserve(
        { authenticated: true, active: true, userId },
        { choiceHandle },
      ),
    ).resolves.toMatchObject({
      created: false,
      bookingHandle,
      state: "booked",
    });
    expect(reserveProtectedChoice).toHaveBeenCalledTimes(2);
  });

  it("normalizes protected absence and conflict without leaking details", async () => {
    const repository = {
      reserveProtectedChoice: vi
        .fn()
        .mockResolvedValueOnce({ kind: "not_found" as const })
        .mockResolvedValueOnce({ kind: "conflict" as const }),
      cancelOwnedByHandle: vi.fn(),
      listOwnedActive: vi.fn(),
    };
    const service = createClientBookingService({ repository });
    const principal = {
      authenticated: true as const,
      active: true as const,
      userId,
    };

    await expect(
      service.reserve(principal, { choiceHandle }),
    ).rejects.toBeInstanceOf(ClientBookingNotFoundError);
    await expect(
      service.reserve(principal, { choiceHandle }),
    ).rejects.toBeInstanceOf(ClientBookingConflictError);
  });

  it("cancels only by owner plus bk1 and projects both cancellation actors equally", async () => {
    const cancelOwnedByHandle = vi
      .fn()
      .mockResolvedValueOnce({ kind: "cancelled" as const })
      .mockResolvedValueOnce({ kind: "replayed" as const });
    const service = createClientBookingService({
      repository: {
        reserveProtectedChoice: vi.fn(),
        cancelOwnedByHandle,
        listOwnedActive: vi.fn(),
      },
      newCorrelationId: () => "cancel-correlation",
    });
    const principal = {
      authenticated: true as const,
      active: true as const,
      userId,
    };

    await expect(service.cancel(principal, bookingHandle)).resolves.toEqual({
      bookingHandle,
      state: "cancelled",
    });
    await expect(service.cancel(principal, bookingHandle)).resolves.toEqual({
      bookingHandle,
      state: "cancelled",
    });
    expect(cancelOwnedByHandle).toHaveBeenCalledWith({
      userId,
      bookingHandle,
      correlationId: "cancel-correlation",
    });
  });
});
