import { describe, expect, it, vi } from "vitest";
import { reconcileTestExpertTrial } from "./test-expert-trial-reconciliation.js";

describe("test expert trial reconciliation", () => {
  it("scans bounded aged unknown/reserved rows and emits reconciliation age/outcomes", async () => {
    const resolve = vi
      .fn()
      .mockResolvedValueOnce("applied")
      .mockResolvedValueOnce("not_applied");
    const recordAuthoritativeOutcome = vi.fn();
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
              providerRequestId: `sha256:${"a".repeat(64)}`,
              createdAt: new Date("2026-08-30T11:00:00Z"),
            },
            {
              reservationId: "r2",
              providerRequestId: `sha256:${"b".repeat(64)}`,
              createdAt: new Date("2026-08-30T11:30:00Z"),
            },
          ];
        }),
        recordAuthoritativeOutcome,
      },
      authority: { resolve },
      metrics: { record: (event) => metrics.push(event) },
    });
    expect(resolve).toHaveBeenCalledTimes(2);
    expect(recordAuthoritativeOutcome).toHaveBeenCalledTimes(2);
    expect(result).toEqual({ scanned: 2, applied: 1, released: 1, unknown: 0 });
    expect(metrics).toEqual(
      expect.arrayContaining([
        { name: "reconciliation_age", value: 3_600_000 },
        { name: "units_consumed", value: 1 },
        { name: "units_released", value: 1 },
      ]),
    );
  });

  it("retains units for delayed, lost, or ambiguous provider responses", async () => {
    const recordAuthoritativeOutcome = vi.fn();
    const result = await reconcileTestExpertTrial({
      limit: 1,
      minimumAgeMs: 60_000,
      now: new Date("2026-08-30T12:00:00.000Z"),
      repository: {
        scan: vi.fn(async () => [
          {
            reservationId: "r1",
            providerRequestId: `sha256:${"c".repeat(64)}`,
            createdAt: new Date("2026-08-29T12:00:00Z"),
          },
        ]),
        recordAuthoritativeOutcome,
      },
      authority: { resolve: vi.fn(async () => "unknown" as const) },
      metrics: { record: () => undefined },
    });
    expect(result).toEqual({ scanned: 1, applied: 0, released: 0, unknown: 1 });
    expect(recordAuthoritativeOutcome).not.toHaveBeenCalled();
  });

  it("rejects unbounded or too-young scans", async () => {
    const repository = {
      scan: vi.fn(),
      recordAuthoritativeOutcome: vi.fn(),
    };
    const authority = { resolve: vi.fn() };
    await expect(
      reconcileTestExpertTrial({
        limit: 0,
        minimumAgeMs: 60_000,
        now: new Date(),
        repository,
        authority,
        metrics: { record: () => undefined },
      }),
    ).rejects.toThrow("test_expert_reconciliation_bounds_invalid");
    await expect(
      reconcileTestExpertTrial({
        limit: 101,
        minimumAgeMs: 1,
        now: new Date(),
        repository,
        authority,
        metrics: { record: () => undefined },
      }),
    ).rejects.toThrow("test_expert_reconciliation_bounds_invalid");
  });
});
