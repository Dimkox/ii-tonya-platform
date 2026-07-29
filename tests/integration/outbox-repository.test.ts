import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { PostgresOutboxRepository } from "../../packages/db/src/index.js";
import {
  startTestPostgres,
  type TestDatabase,
} from "../../packages/db/src/testkit/postgres.js";
import { runOutboxBatch } from "../../packages/worker/src/outbox-runner.js";

let testDb: TestDatabase;

beforeAll(async () => {
  testDb = await startTestPostgres();
  await testDb.migrate();
}, 120_000);
beforeEach(async () => testDb.reset());
afterAll(async () => testDb?.stop(), 120_000);

const runnerDeps = (
  repository: PostgresOutboxRepository,
  dispatch: ReturnType<typeof vi.fn>,
  reconcile: ReturnType<typeof vi.fn>,
  now = new Date("2026-07-28T11:00:00.000Z"),
) => ({
  repository,
  dispatcher: { dispatch },
  reconciler: { reconcile },
  now: () => now,
  retryDelayMs: () => 1_000,
  maxAttempts: 3,
  maxReconciliationAttempts: 2,
  batchSize: 10,
  workerId: "worker-budget",
  newAttemptId: () => "attempt-test",
});

describe("PostgreSQL unknown-outcome lifecycle", () => {
  it("round-trips the reconciliation key and recovers a crashed reconciliation lease", async () => {
    const repository = new PostgresOutboxRepository(testDb.db);
    const id = await testDb.insertOutbox({
      topic: "planerka.reserve",
      reconciliationKey: "reservation:provider-key-1",
    });
    const [claimed] = await repository.claim(
      1,
      "dispatch-a",
      new Date("2026-07-28T10:00:30.000Z"),
    );
    await repository.recordAttemptStarted(
      id,
      "attempt-1",
      claimed!.reconciliationKey,
      new Date("2026-07-28T10:00:00.000Z"),
    );
    await repository.markUnknownOutcome(
      id,
      "attempt-1",
      "reservation:provider-key-1",
      "response_timeout",
    );
    const [firstReconciliation] = await repository.claimUnknown(
      1,
      "reconciler-a",
      new Date("2026-07-28T10:01:30.000Z"),
    );
    expect(firstReconciliation).toMatchObject({
      id,
      reconciliationKey: "reservation:provider-key-1",
      reconciliationAttempt: 1,
    });

    expect(
      await repository.recoverExpiredReconciliationLeases(
        new Date("2026-07-28T10:01:31.000Z"),
      ),
    ).toBe(1);
    const [recovered] = await repository.claimUnknown(
      1,
      "reconciler-b",
      new Date("2026-07-28T10:02:30.000Z"),
    );
    expect(recovered).toMatchObject({
      id,
      reconciliationKey: "reservation:provider-key-1",
      reconciliationAttempt: 2,
    });
  });

  it("turns an expired dispatch lease into unknown outcome before any resend", async () => {
    const repository = new PostgresOutboxRepository(testDb.db);
    const id = await testDb.insertOutbox({
      topic: "selarti.send",
      reconciliationKey: "message:provider-key-1",
    });
    await repository.claim(
      1,
      "dispatch-a",
      new Date("2026-07-28T10:00:30.000Z"),
    );

    expect(
      await repository.recoverExpiredDispatchLeases(
        new Date("2026-07-28T10:00:31.000Z"),
      ),
    ).toBe(1);
    expect(await testDb.outboxStatus(id)).toBe("unknown_outcome");
    expect(
      await repository.claim(
        1,
        "must-not-resend",
        new Date("2026-07-28T10:01:30.000Z"),
      ),
    ).toEqual([]);
  });

  it("rejects an outcome reconciliation key that differs from the stable command key", async () => {
    const repository = new PostgresOutboxRepository(testDb.db);
    const id = await testDb.insertOutbox({
      topic: "telegram.send",
      reconciliationKey: "message:stable-key",
    });
    const [claimed] = await repository.claim(
      1,
      "dispatch-a",
      new Date("2026-07-28T10:00:30.000Z"),
    );
    await repository.recordAttemptStarted(
      id,
      "attempt-key",
      claimed!.reconciliationKey,
      new Date("2026-07-28T10:00:00.000Z"),
    );

    await expect(
      repository.markUnknownOutcome(
        id,
        "attempt-key",
        "message:different-key",
        "response_timeout",
      ),
    ).rejects.toThrow("reconciliation key");
    expect(await testDb.outboxStatus(id)).toBe("processing");
  });

  it("never retries beyond either budget and atomically alerts the owner", async () => {
    const repository = new PostgresOutboxRepository(testDb.db);
    const dispatch = vi.fn();
    const reconcile = vi.fn().mockResolvedValue("still_unknown");
    const unknownId = await testDb.insertUnknownOutbox({
      attempt: 3,
      reconciliationAttempt: 1,
      reconciliationKey: "telegram:message-2",
    });

    await runOutboxBatch(runnerDeps(repository, dispatch, reconcile));

    expect(await testDb.outboxStatus(unknownId)).toBe("dead_letter");
    expect(await testDb.ownerAlertReasons(unknownId)).toEqual([
      "unknown_outcome_reconciliation_exhausted",
    ]);
    expect(await testDb.deadLetterReasons(unknownId)).toEqual([
      "unknown_outcome_reconciliation_exhausted",
    ]);
    expect(dispatch).not.toHaveBeenCalled();

    const notAppliedId = await testDb.insertUnknownOutbox({
      attempt: 3,
      reconciliationAttempt: 0,
      reconciliationKey: "planerka:reservation-3",
    });
    reconcile.mockResolvedValueOnce("not_applied");
    await runOutboxBatch(
      runnerDeps(
        repository,
        dispatch,
        reconcile,
        new Date("2026-07-28T11:01:00.000Z"),
      ),
    );
    expect(await testDb.outboxStatus(notAppliedId)).toBe("dead_letter");
    expect(await testDb.ownerAlertReasons(notAppliedId)).toEqual([
      "dispatch_attempts_exhausted_after_reconciliation",
    ]);
  });
});
