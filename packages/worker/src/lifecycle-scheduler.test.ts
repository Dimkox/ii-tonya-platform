import { describe, expect, it, vi } from "vitest";
import {
  cancelReservationLifecycle,
  processDueLifecycleBatch,
  scheduleReservationLifecycle,
} from "./lifecycle-scheduler.js";

const reservationId = "00000000-0000-4000-8000-000000000001";

describe("lifecycle scheduler", () => {
  it("rejects invalid batch bounds before repository use", async () => {
    const repository = { processDueLifecycleBatch: vi.fn() };
    await expect(
      processDueLifecycleBatch(repository, { now: new Date(), batchSize: 0 }),
    ).rejects.toThrow("Invalid lifecycle batch size");
    expect(repository.processDueLifecycleBatch).not.toHaveBeenCalled();
  });

  it("validates reservation UUID and bounded machine cancellation reason", async () => {
    const repository = {
      scheduleReservationLifecycle: vi.fn(),
      cancelReservationLifecycle: vi.fn(),
      processDueLifecycleBatch: vi.fn(),
    };
    await expect(
      scheduleReservationLifecycle(repository, "not-a-uuid"),
    ).rejects.toThrow("Invalid reservation UUID");
    await expect(
      cancelReservationLifecycle(repository, "not-a-uuid", "booking_cancelled"),
    ).rejects.toThrow("Invalid reservation UUID");
    await expect(
      cancelReservationLifecycle(repository, reservationId, "bad reason!"),
    ).rejects.toThrow("Invalid lifecycle cancellation reason");
    expect(repository.scheduleReservationLifecycle).not.toHaveBeenCalled();
    expect(repository.cancelReservationLifecycle).not.toHaveBeenCalled();
  });

  it("exposes scheduling and cancellation through the worker boundary", async () => {
    const repository = {
      scheduleReservationLifecycle: vi.fn().mockResolvedValue(3),
      cancelReservationLifecycle: vi.fn().mockResolvedValue(2),
      processDueLifecycleBatch: vi.fn(),
    };
    await expect(
      scheduleReservationLifecycle(repository, reservationId),
    ).resolves.toBe(3);
    await expect(
      cancelReservationLifecycle(
        repository,
        reservationId,
        "reservation_cancelled",
      ),
    ).resolves.toBe(2);
  });
});
