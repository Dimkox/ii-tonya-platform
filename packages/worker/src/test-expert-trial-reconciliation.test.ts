import { describe, expect, it, vi } from "vitest";
import { reconcileTestExpertTrial } from "./test-expert-trial-reconciliation.js";

describe("test expert trial reconciliation", () => {
  it("scans bounded aged unknown/reserved rows and emits reconciliation age/outcomes", async () => {
    const reconcile = vi
      .fn()
      .mockResolvedValueOnce("applied")
      .mockResolvedValueOnce("not_applied");
    const metrics: Array<{ name: string; value: number }> = [];
    const result = await reconcileTestExpertTrial({
      limit: 25,
      minimumAgeMs: 60_000,
      now: new Date("2026-08-30T12:00:00.000Z"),
      repository: {
        scan: vi.fn(async ({ limit, before }) => {
          expect(limit).toBe(25);
          expect(before).toEqual(new Date("2026-08-30T11:59:00.000Z"));
          return [
            {
              reservationId: "r1",
              createdAt: new Date("2026-08-30T11:00:00Z"),
            },
            {
              reservationId: "r2",
              createdAt: new Date("2026-08-30T11:30:00Z"),
            },
          ];
        }),
        reconcile,
      },
      metrics: { record: (event) => metrics.push(event) },
    });
    expect(reconcile).toHaveBeenCalledTimes(2);
    expect(result).toEqual({ scanned: 2, applied: 1, released: 1, unknown: 0 });
    expect(metrics).toEqual(
      expect.arrayContaining([
        { name: "reconciliation_age", value: 3_600_000 },
        { name: "units_consumed", value: 1 },
        { name: "units_released", value: 1 },
      ]),
    );
  });

  it("rejects unbounded or too-young scans", async () => {
    const repository = { scan: vi.fn(), reconcile: vi.fn() };
    await expect(
      reconcileTestExpertTrial({
        limit: 0,
        minimumAgeMs: 60_000,
        now: new Date(),
        repository,
        metrics: { record: () => undefined },
      }),
    ).rejects.toThrow("test_expert_reconciliation_bounds_invalid");
    await expect(
      reconcileTestExpertTrial({
        limit: 101,
        minimumAgeMs: 1,
        now: new Date(),
        repository,
        metrics: { record: () => undefined },
      }),
    ).rejects.toThrow("test_expert_reconciliation_bounds_invalid");
  });
});
