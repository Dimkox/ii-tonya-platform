import { describe, expect, it } from "vitest";
import { expireDueReservations } from "./reservation-expiry.js";
import { expiryFixture } from "./worker-jobs.testkit.js";

describe("reservation expiry", () => {
  it("expires only due reserved rows and emits one free cancellation flow", async () => {
    const deps = expiryFixture([
      { id: "due", status: "reserved", reservedUntil: "2026-07-28T09:59:59.000Z", version: 1 },
      { id: "future", status: "reserved", reservedUntil: "2026-07-28T10:00:01.000Z", version: 1 },
      { id: "booked", status: "booked", reservedUntil: "2026-07-28T09:00:00.000Z", version: 2 },
    ]);
    const result = await expireDueReservations(
      deps,
      new Date("2026-07-28T10:00:00.000Z"),
      100,
    );

    expect(result).toEqual({ examined: 1, changed: 1, failed: 0 });
    expect(deps.outbox.topics()).toEqual([
      "planerka.cancel",
      "client.reservation_expired",
      "expert.reservation_expired",
    ]);
    expect(deps.outbox.allFree()).toBe(true);
  });

  it("bounds a transaction batch and is idempotent after the claimed rows change", async () => {
    const deps = expiryFixture([
      { id: "due-1", status: "reserved", reservedUntil: "2026-07-28T09:00:00.000Z", version: 1 },
      { id: "due-2", status: "reserved", reservedUntil: "2026-07-28T09:30:00.000Z", version: 4 },
    ]);
    const now = new Date("2026-07-28T10:00:00.000Z");

    expect(await expireDueReservations(deps, now, 1)).toEqual({
      examined: 1,
      changed: 1,
      failed: 0,
    });
    expect(await expireDueReservations(deps, now, 1)).toEqual({
      examined: 1,
      changed: 1,
      failed: 0,
    });
    expect(await expireDueReservations(deps, now, 1)).toEqual({
      examined: 0,
      changed: 0,
      failed: 0,
    });
    expect(deps.outbox.topics()).toHaveLength(6);
    expect(new Set(deps.outbox.idempotencyKeys()).size).toBe(6);
  });

  it("rejects an effectively unbounded transaction batch", async () => {
    const deps = expiryFixture([]);

    await expect(expireDueReservations(
      deps,
      new Date("2026-07-28T10:00:00.000Z"),
      1_001,
    )).rejects.toThrow("Invalid reservation expiry batch input");
  });
});
