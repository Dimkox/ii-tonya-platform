import { describe, expect, it, vi } from "vitest";
import type { DrizzleDb } from "../client.js";
import { PostgresExpertReferralWorkerRepository } from "./expert-referral-worker-repository.js";

const now = new Date("2026-08-11T08:00:00.000Z");

function replayDb() {
  const execute = vi.fn(async () => ({
    rows: [{ expertId: "00000000-0000-4000-8000-000000000001" }],
  }));
  return {
    db: {
      transaction: vi.fn(async (callback: (tx: { execute: typeof execute }) => Promise<unknown>) =>
        callback({ execute })),
    } as unknown as DrizzleDb,
    execute,
  };
}

describe("PostgresExpertReferralWorkerRepository", () => {
  it("maps DB-authoritative expiry release counts", async () => {
    const releaseExpiredOrders = vi.fn(async () => ({ examined: 1, released: 1 }));
    const repo = new PostgresExpertReferralWorkerRepository({} as DrizzleDb, {
      residency: { releaseExpiredOrders },
      heldRewards: { replayHeldReward: vi.fn() },
    });

    await expect(repo.expireDueBatch({ now, batchSize: 100 })).resolves.toEqual({
      examined: 1,
      changed: 1,
      failed: 0,
    });
    expect(releaseExpiredOrders).toHaveBeenCalledWith(100);
  });

  it("claims held rewards with a bounded transaction and counts terminal cancellation", async () => {
    const { db } = replayDb();
    const replayHeldReward = vi.fn(async () => ({
      kind: "not_granted" as const,
      reason: "not_pending",
    }));
    const repo = new PostgresExpertReferralWorkerRepository(db, {
      residency: { releaseExpiredOrders: vi.fn() },
      heldRewards: { replayHeldReward },
    });

    await expect(repo.replayDueBatch({ now, batchSize: 25 })).resolves.toEqual({
      examined: 1,
      granted: 0,
      cancelled: 1,
    });
    expect(replayHeldReward).toHaveBeenCalledWith(
      "00000000-0000-4000-8000-000000000001",
    );
  });

  it("leaves a gate-closed hold pending instead of reporting cancellation", async () => {
    const { db } = replayDb();
    const repo = new PostgresExpertReferralWorkerRepository(db, {
      residency: { releaseExpiredOrders: vi.fn() },
      heldRewards: {
        replayHeldReward: vi.fn(async () => ({
          kind: "not_granted" as const,
          reason: "gate_closed",
        })),
      },
    });

    await expect(repo.replayDueBatch({ now, batchSize: 25 })).resolves.toEqual({
      examined: 1,
      granted: 0,
      cancelled: 0,
    });
  });

  it("rejects unbounded repository claims", async () => {
    const repo = new PostgresExpertReferralWorkerRepository({} as DrizzleDb, {
      residency: { releaseExpiredOrders: vi.fn() },
      heldRewards: { replayHeldReward: vi.fn() },
    });

    await expect(
      repo.expireDueBatch({ now, batchSize: 1_001 }),
    ).rejects.toThrow("invalid_expert_referral_worker_batch");
  });
});
