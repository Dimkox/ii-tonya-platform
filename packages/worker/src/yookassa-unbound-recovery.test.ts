import { describe, expect, it, vi } from "vitest";
import { runYooKassaUnboundRecoveryBatch } from "./yookassa-unbound-recovery.js";

describe("bounded YooKassa unbound recovery job", () => {
  it("performs no repository or crypto work while disabled", async () => {
    const claimBatch = vi.fn();
    const recover = vi.fn();
    await expect(runYooKassaUnboundRecoveryBatch({ enabled: false, limit: 5, claimBatch, recover }))
      .resolves.toEqual({ kind: "disabled", examined: 0 });
    expect(claimBatch).not.toHaveBeenCalled();
    expect(recover).not.toHaveBeenCalled();
  });

  it("claims and processes only the configured bounded batch", async () => {
    const claims = [{ operationId: "one" }, { operationId: "two" }];
    const recover = vi.fn(async () => ({ kind: "rescheduled" as const }));
    await expect(runYooKassaUnboundRecoveryBatch({
      enabled: true, limit: 2,
      claimBatch: vi.fn(async (input) => { expect(input.limit).toBe(2); return claims; }),
      recover,
    })).resolves.toEqual({ kind: "completed", examined: 2, bound: 0, rescheduled: 2, manualReview: 0 });
    expect(recover).toHaveBeenCalledTimes(2);
  });
});
