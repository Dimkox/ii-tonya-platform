import { describe, expect, it, vi } from "vitest";
import {
  cancelReservationLifecycle,
  processDueLifecycleBatch,
  scheduleReservationLifecycle,
} from "./lifecycle-scheduler.js";

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
      cancelReservationLifecycle(
        repository,
        "550e8400-e29b-41d4-a716-446655440000",
        "bad reason!",
      ),
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
      scheduleReservationLifecycle(
        repository,
        "550e8400-e29b-41d4-a716-446655440000",
      ),
    ).resolves.toBe(3);
    await expect(
      cancelReservationLifecycle(
        repository,
        "550e8400-e29b-41d4-a716-446655440000",
        "reservation_cancelled",
      ),
    ).resolves.toBe(2);
  });
});
