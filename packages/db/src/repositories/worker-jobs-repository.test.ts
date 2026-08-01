import { describe, expect, it, vi } from "vitest";
import type { DrizzleDb } from "../client.js";
import { PostgresWorkerJobsRepository } from "./worker-jobs-repository.js";

describe("PostgreSQL worker job repository", () => {
  it("executes expiry as one repository-owned transaction", async () => {
    const execute = vi.fn(async () => ({
      rows: [{ examined: 2, changed: 2, failed: 0 }],
    }));
    const transaction = vi.fn(async (work: (tx: { execute: typeof execute }) => unknown) =>
      work({ execute }));
    const repository = new PostgresWorkerJobsRepository({
      transaction,
    } as unknown as DrizzleDb);

    await expect(repository.expireDueBatch({
      now: new Date("2026-07-28T10:00:00.000Z"),
      batchSize: 100,
    })).resolves.toEqual({ examined: 2, changed: 2, failed: 0 });

    expect(transaction).toHaveBeenCalledOnce();
    expect(execute).toHaveBeenCalledOnce();
  });

  it("executes safety escalation as one repository-owned transaction", async () => {
    const execute = vi.fn(async () => ({
      rows: [{ examined: 2, escalated: 1, unchanged: 1 }],
    }));
    const transaction = vi.fn(async (work: (tx: { execute: typeof execute }) => unknown) =>
      work({ execute }));
    const repository = new PostgresWorkerJobsRepository({
      transaction,
    } as unknown as DrizzleDb);

    await expect(repository.processDueBatch({
      now: new Date("2026-07-28T10:00:00.000Z"),
      batchSize: 100,
    })).resolves.toEqual({ examined: 2, escalated: 1, unchanged: 1 });

    expect(transaction).toHaveBeenCalledOnce();
    expect(execute).toHaveBeenCalledOnce();
  });

  it("delivers safety escalation to the durable operator queue atomically", async () => {
    const execute = vi.fn(async () => ({ rows: [{ delivered: 1 }] }));
    const transaction = vi.fn(async (work: (tx: { execute: typeof execute }) => unknown) =>
      work({ execute }));
    const repository = new PostgresWorkerJobsRepository({
      transaction,
    } as unknown as DrizzleDb);

    await expect(repository.deliverSafetyEscalationsBatch(100)).resolves.toEqual({
      delivered: 1,
    });
    expect(transaction).toHaveBeenCalledOnce();
    expect(execute).toHaveBeenCalledOnce();
  });
});
