import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import {
  OutboxLeaseLostError,
  PostgresOutboxRepository,
} from "../../packages/db/src/index.js";
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
  now = new Date(),
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
    const now = new Date();
    const repository = new PostgresOutboxRepository(testDb.db);
    const id = await testDb.insertOutbox({
      topic: "planerka.reserve",
      reconciliationKey: "reservation:provider-key-1",
    });
    const [claimed] = await repository.claim(
      1,
      "dispatch-a",
      new Date(now.getTime() + 30_000),
      3,
    );
    await repository.recordAttemptStarted(
      id,
      "dispatch-a",
      "attempt-1",
      claimed!.reconciliationKey,
      now,
    );
    await repository.markUnknownOutcome(
      id,
      "dispatch-a",
      "attempt-1",
      "reservation:provider-key-1",
      "response_timeout",
      new Date(now.getTime() + 1_000),
    );
    const [firstReconciliation] = await repository.claimUnknown(
      1,
      "reconciler-a",
      new Date(now.getTime() + 90_000),
      3,
    );
    expect(firstReconciliation).toMatchObject({
      id,
      reconciliationKey: "reservation:provider-key-1",
      reconciliationAttempt: 1,
    });

    expect(
      await repository.recoverExpiredReconciliationLeases(
        new Date(now.getTime() + 91_000),
      ),
    ).toBe(1);
    const [recovered] = await repository.claimUnknown(
      1,
      "reconciler-b",
      new Date(now.getTime() + 150_000),
      3,
    );
    expect(recovered).toMatchObject({
      id,
      reconciliationKey: "reservation:provider-key-1",
      reconciliationAttempt: 2,
    });
  });

  it("turns an expired dispatch lease into unknown outcome before any resend", async () => {
    const now = new Date();
    const repository = new PostgresOutboxRepository(testDb.db);
    const id = await testDb.insertOutbox({
      topic: "selarti.send",
      reconciliationKey: "message:provider-key-1",
    });
    await repository.claim(
      1,
      "dispatch-a",
      new Date(now.getTime() + 30_000),
      3,
    );

    expect(
      await repository.recoverExpiredDispatchLeases(
        new Date(now.getTime() + 31_000),
      ),
    ).toBe(1);
    expect(await testDb.outboxStatus(id)).toBe("unknown_outcome");
    expect(
      await repository.claim(
        1,
        "must-not-resend",
        new Date(now.getTime() + 90_000),
        3,
      ),
    ).toEqual([]);
  });

  it("rejects an outcome reconciliation key that differs from the stable command key", async () => {
    const now = new Date();
    const repository = new PostgresOutboxRepository(testDb.db);
    const id = await testDb.insertOutbox({
      topic: "telegram.send",
      reconciliationKey: "message:stable-key",
    });
    const [claimed] = await repository.claim(
      1,
      "dispatch-a",
      new Date(now.getTime() + 30_000),
      3,
    );
    await repository.recordAttemptStarted(
      id,
      "dispatch-a",
      "attempt-key",
      claimed!.reconciliationKey,
      now,
    );

    await expect(
      repository.markUnknownOutcome(
        id,
        "dispatch-a",
        "attempt-key",
        "message:different-key",
        "response_timeout",
        new Date(now.getTime() + 1_000),
      ),
    ).rejects.toThrow("reconciliation key");
    expect(await testDb.outboxStatus(id)).toBe("processing");
  });

  it("rejects stale dispatch and reconciliation workers with a typed lease-lost error", async () => {
    const now = new Date();
    const repository = new PostgresOutboxRepository(testDb.db);
    const id = await testDb.insertOutbox({
      topic: "selarti.send",
      reconciliationKey: "message:lease-key",
    });
    const [claimed] = await repository.claim(
      1,
      "dispatch-owner",
      new Date(now.getTime() + 30_000),
      3,
    );

    await expect(
      repository.recordAttemptStarted(
        id,
        "wrong-owner",
        "attempt-lease",
        claimed!.reconciliationKey,
        now,
      ),
    ).rejects.toBeInstanceOf(OutboxLeaseLostError);

    await repository.recordAttemptStarted(
      id,
      "dispatch-owner",
      "attempt-lease",
      claimed!.reconciliationKey,
      now,
    );
    await repository.recoverExpiredDispatchLeases(
      new Date(now.getTime() + 31_000),
    );
    await expect(
      repository.succeed(
        id,
        "dispatch-owner",
        new Date(now.getTime() + 31_000),
      ),
    ).rejects.toBeInstanceOf(OutboxLeaseLostError);
    expect(await testDb.outboxStatus(id)).toBe("unknown_outcome");

    const [unknown] = await repository.claimUnknown(
      1,
      "reconciliation-owner",
      new Date(now.getTime() + 90_000),
      3,
    );
    await expect(
      repository.succeedAfterReconciliation(
        unknown!.id,
        "wrong-owner",
        new Date(now.getTime() + 60_000),
      ),
    ).rejects.toBeInstanceOf(OutboxLeaseLostError);
    expect(await testDb.outboxStatus(id)).toBe("reconciling");
  });

  it("terminalizes database rows already at either budget before external work", async () => {
    const repository = new PostgresOutboxRepository(testDb.db);
    const dispatch = vi.fn();
    const reconcile = vi.fn();
    const dispatchId = await testDb.insertOutbox({
      topic: "telegram.send",
      reconciliationKey: "message:dispatch-exhausted",
      attempt: 3,
    });
    const reconciliationId = await testDb.insertUnknownOutbox({
      attempt: 2,
      reconciliationAttempt: 2,
      reconciliationKey: "message:reconciliation-exhausted",
    });

    await runOutboxBatch(runnerDeps(repository, dispatch, reconcile));

    expect(dispatch).not.toHaveBeenCalled();
    expect(reconcile).not.toHaveBeenCalled();
    expect(await testDb.outboxStatus(dispatchId)).toBe("dead_letter");
    expect(await testDb.outboxStatus(reconciliationId)).toBe("dead_letter");
    expect(await testDb.ownerAlertReasons(dispatchId)).toEqual([
      "dispatch_attempts_exhausted_before_claim",
    ]);
    expect(await testDb.ownerAlertReasons(reconciliationId)).toEqual([
      "unknown_outcome_reconciliation_exhausted_before_claim",
    ]);
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
        new Date(),
      ),
    );
    expect(await testDb.outboxStatus(notAppliedId)).toBe("dead_letter");
    expect(await testDb.ownerAlertReasons(notAppliedId)).toEqual([
      "dispatch_attempts_exhausted_after_reconciliation",
    ]);
  });
});
