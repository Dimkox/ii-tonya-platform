import { describe, expect, it, vi } from "vitest";
import { expireExpertResidencyOrders } from "./expert-residency-expiry.js";

describe("expert residency expiry", () => {
  it("passes the exact deadline and bounded batch to PostgreSQL authority", async () => {
    const deadline = new Date("2026-08-11T08:00:00.000Z");
    const expireDueBatch = vi.fn(async () => ({
      examined: 1,
      changed: 1,
      failed: 0,
    }));

    await expect(
      expireExpertResidencyOrders({ expireDueBatch }, deadline, 100),
    ).resolves.toEqual({ examined: 1, changed: 1, failed: 0 });
    expect(expireDueBatch).toHaveBeenCalledWith({
      now: deadline,
      batchSize: 100,
    });
  });

  it("rejects unbounded batches", async () => {
    await expect(
      expireExpertResidencyOrders(
        { expireDueBatch: vi.fn() },
        new Date("2026-08-11T08:00:00.000Z"),
        1_001,
      ),
    ).rejects.toThrow("invalid_expert_residency_expiry_input");
  });
});
