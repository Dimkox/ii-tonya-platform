import { describe, expect, it, vi } from "vitest";
import {
  boundedFullJitterDelay,
  runOutboxBatch,
} from "../../packages/worker/src/outbox-runner.js";
import { fakeOutboxRepository } from "../../packages/worker/src/outbox-runner.testkit.js";

const baseDeps = () => ({
  now: () => new Date("2026-07-28T10:00:00.000Z"),
  retryDelayMs: () => 1_000,
  maxAttempts: 3,
  maxReconciliationAttempts: 3,
  batchSize: 10,
  workerId: "worker-test",
  newAttemptId: () => "attempt-1",
});

describe("outbox runner", () => {
  it("bounds exponential full jitter independently for each schedule", () => {
    expect(boundedFullJitterDelay(1, 1_000, 30_000, () => 0)).toBe(0);
    expect(boundedFullJitterDelay(4, 1_000, 5_000, () => 0.5)).toBe(2_500);
    expect(
      boundedFullJitterDelay(20, 1_000, 5_000, () => 0.9999),
    ).toBeLessThanOrEqual(5_000);
  });

  it("retries a confirmed pre-send failure and executes the second attempt", async () => {
    const repository = fakeOutboxRepository([
      { id: "o-1", topic: "client.notify", attempt: 0 },
    ]);
    const dispatch = vi
      .fn()
      .mockResolvedValueOnce({
        kind: "not_applied",
        retryable: true,
        reasonCode: "connect_failed",
      })
      .mockResolvedValueOnce({
        kind: "applied",
        providerOperationId: "provider-1",
      });

    await runOutboxBatch({
      ...baseDeps(),
      repository,
      dispatcher: { dispatch },
      reconciler: { reconcile: vi.fn() },
    });
    repository.makeRetriesDue();
    await runOutboxBatch({
      ...baseDeps(),
      repository,
      dispatcher: { dispatch },
      reconciler: { reconcile: vi.fn() },
      newAttemptId: () => "attempt-2",
    });

    expect(repository.retryCalls).toEqual([
      {
        id: "o-1",
        at: "2026-07-28T10:00:01.000Z",
        reasonCode: "connect_failed",
      },
    ]);
    expect(repository.succeedCalls).toEqual(["o-1"]);
    expect(dispatch).toHaveBeenCalledTimes(2);
  });

  it("reconciles a timeout after provider commit before any resend", async () => {
    const repository = fakeOutboxRepository([
      { id: "o-2", topic: "planerka.reserve", attempt: 0 },
    ]);
    const dispatch = vi.fn().mockResolvedValue({
      kind: "unknown_outcome",
      reconciliationKey: "reserve:o-2",
      reasonCode: "response_timeout",
    });
    const reconcile = vi.fn().mockResolvedValue("applied");

    await runOutboxBatch({
      ...baseDeps(),
      repository,
      dispatcher: { dispatch },
      reconciler: { reconcile },
    });
    repository.makeUnknownClaimable();
    await runOutboxBatch({
      ...baseDeps(),
      repository,
      dispatcher: { dispatch },
      reconciler: { reconcile },
      now: () => new Date("2026-07-28T10:01:00.000Z"),
      newAttemptId: () => "must-not-dispatch",
    });

    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(reconcile).toHaveBeenCalledTimes(1);
    expect(repository.succeedCalls).toEqual(["o-2"]);
  });

  it("recovers a crash after provider success as unknown and reconciles without resend", async () => {
    const repository = fakeOutboxRepository([
      { id: "o-3", topic: "selarti.send", attempt: 0 },
    ]);
    repository.failNextLocalSuccessWrite();
    const dispatch = vi
      .fn()
      .mockResolvedValue({ kind: "applied", providerOperationId: "message-3" });
    const reconcile = vi.fn().mockResolvedValue("applied");

    await expect(
      runOutboxBatch({
        ...baseDeps(),
        repository,
        dispatcher: { dispatch },
        reconciler: { reconcile },
        newAttemptId: () => "attempt-crash",
      }),
    ).rejects.toThrow("simulated local acknowledgement failure");

    await repository.recoverExpiredDispatchLeases(
      new Date("2026-07-28T10:01:00.000Z"),
    );
    repository.makeUnknownClaimable();
    await runOutboxBatch({
      ...baseDeps(),
      repository,
      dispatcher: { dispatch },
      reconciler: { reconcile },
    });

    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(reconcile).toHaveBeenCalledTimes(1);
  });

  it("dead-letters a permanent not-applied result without another dispatch", async () => {
    const repository = fakeOutboxRepository([
      { id: "o-4", topic: "telegram.send", attempt: 0 },
    ]);
    const dispatch = vi.fn().mockResolvedValue({
      kind: "not_applied",
      retryable: false,
      reasonCode: "recipient_blocked",
    });

    await runOutboxBatch({
      ...baseDeps(),
      repository,
      dispatcher: { dispatch },
      reconciler: { reconcile: vi.fn() },
      newAttemptId: () => "attempt-permanent",
    });

    expect(repository.deadLetterCalls).toEqual([
      { id: "o-4", reasonCode: "recipient_blocked" },
    ]);
    expect(repository.retryCalls).toEqual([]);
    expect(dispatch).toHaveBeenCalledTimes(1);
  });

  it("dead-letters an exhausted ambiguous result without dispatching", async () => {
    const repository = fakeOutboxRepository([
      { id: "o-5", topic: "telegram.send", attempt: 3 },
    ]);
    repository.makeUnknown("o-5", 2);
    const dispatch = vi.fn();
    const reconcile = vi.fn().mockResolvedValue("still_unknown");

    await runOutboxBatch({
      ...baseDeps(),
      repository,
      dispatcher: { dispatch },
      reconciler: { reconcile },
    });

    expect(repository.deadLetterCalls).toEqual([
      { id: "o-5", reasonCode: "unknown_outcome_reconciliation_exhausted" },
    ]);
    expect(dispatch).not.toHaveBeenCalled();
  });
});
