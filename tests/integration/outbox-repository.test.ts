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
import { sql } from "drizzle-orm";
import {
  startTestPostgres,
  type TestDatabase,
} from "../../packages/db/src/testkit/postgres.js";
import { runOutboxBatch } from "../../packages/worker/src/outbox-runner.js";
import { LOCAL_OPERATOR_CASE_OUTBOX_TOPICS } from "../../packages/worker/src/local-operator-case-outbox.js";

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
  it("filters claims, exhaustion and expired recovery to the registered local topics", async () => {
    const repository = new PostgresOutboxRepository(
      testDb.db,
      LOCAL_OPERATOR_CASE_OUTBOX_TOPICS,
    );
    const localPending = await testDb.insertOutbox({
      topic: "safety.operator_escalation",
      reconciliationKey: "local:safety-pending",
    });
    const localRetry = await testDb.insertOutbox({
      topic: "admin.negative_feedback",
      reconciliationKey: "local:feedback-retry",
    });
    await testDb.db.execute(sql`
      update integration_outbox
      set status='retry_wait',next_attempt_at=clock_timestamp()-interval '1 second'
      where id=${localRetry}::uuid
    `);
    const localUnknown = await testDb.insertUnknownOutbox({
      attempt: 1,
      reconciliationAttempt: 0,
      reconciliationKey: "local:safety-unknown",
    });
    await testDb.db.execute(sql`
      update integration_outbox
      set topic='safety.operator_escalation'
      where id=${localUnknown}::uuid
    `);

    const providerPending = await testDb.insertOutbox({
      topic: "provider.pending",
      reconciliationKey: "provider:pending",
    });
    const providerRetry = await testDb.insertOutbox({
      topic: "provider.retry",
      reconciliationKey: "provider:retry",
    });
    const providerUnknown = await testDb.insertUnknownOutbox({
      attempt: 1,
      reconciliationAttempt: 0,
      reconciliationKey: "provider:unknown",
    });
    const providerProcessing = await testDb.insertOutbox({
      topic: "provider.processing",
      reconciliationKey: "provider:processing",
    });
    const providerReconciling = await testDb.insertUnknownOutbox({
      attempt: 1,
      reconciliationAttempt: 1,
      reconciliationKey: "provider:reconciling",
    });
    const providerDispatchExhausted = await testDb.insertOutbox({
      topic: "provider.exhausted",
      reconciliationKey: "provider:dispatch-exhausted",
      attempt: 3,
    });
    const providerReconciliationExhausted = await testDb.insertUnknownOutbox({
      attempt: 1,
      reconciliationAttempt: 2,
      reconciliationKey: "provider:reconciliation-exhausted",
    });
    await testDb.db.execute(sql`
      update integration_outbox set
        status='retry_wait',next_attempt_at=clock_timestamp()-interval '1 second'
      where id=${providerRetry}::uuid
    `);
    await testDb.db.execute(sql`
      update integration_outbox set
        status='processing',attempt=1,dispatch_owner_id='provider-worker',
        dispatch_claim_token='provider-dispatch-token',
        lease_until=clock_timestamp()-interval '1 second'
      where id=${providerProcessing}::uuid
    `);
    await testDb.db.execute(sql`
      update integration_outbox set
        status='reconciling',reconciliation_owner_id='provider-worker',
        reconciliation_claim_token='provider-reconciliation-token',
        reconciliation_lease_until=clock_timestamp()-interval '1 second'
      where id=${providerReconciling}::uuid
    `);

    await expect(repository.recoverExpiredDispatchLeases()).resolves.toBe(0);
    await expect(repository.recoverExpiredReconciliationLeases()).resolves.toBe(
      0,
    );
    await expect(
      repository.claimUnknown(10, "local-reconciler", 30_000, 2),
    ).resolves.toEqual([
      expect.objectContaining({ id: localUnknown }),
    ]);
    await expect(
      repository.claim(10, "local-dispatcher", 30_000, 3),
    ).resolves.toEqual([
      expect.objectContaining({ id: localPending }),
      expect.objectContaining({ id: localRetry }),
    ]);

    for (const [id, status] of [
      [providerPending, "pending"],
      [providerRetry, "retry_wait"],
      [providerUnknown, "unknown_outcome"],
      [providerProcessing, "processing"],
      [providerReconciling, "reconciling"],
      [providerDispatchExhausted, "pending"],
      [providerReconciliationExhausted, "unknown_outcome"],
    ] as const) {
      await expect(testDb.outboxStatus(id)).resolves.toBe(status);
    }
  });

  it("fences terminal reconciliation into one dead letter and bounded operator case", async () => {
    const repository = new PostgresOutboxRepository(
      testDb.db,
      LOCAL_OPERATOR_CASE_OUTBOX_TOPICS,
    );
    const id = await testDb.insertUnknownOutbox({
      attempt: 1,
      reconciliationAttempt: 0,
      reconciliationKey: "local:terminal",
    });
    await testDb.db.execute(sql`
      update integration_outbox
      set topic='admin.negative_feedback'
      where id=${id}::uuid
    `);
    const reconcile = vi.fn(async () => ({
      kind: "terminal" as const,
      reasonCode: "local_source_invalid" as const,
    }));

    await runOutboxBatch(runnerDeps(repository, vi.fn(), reconcile));

    expect(await testDb.outboxStatus(id)).toBe("dead_letter");
    expect(await testDb.deadLetterReasons(id)).toEqual([
      "local_source_invalid",
    ]);
    expect(await testDb.ownerAlertReasons(id)).toEqual([
      "local_source_invalid",
    ]);
    const cases = await testDb.db.execute<{
      count: string;
      caseType: string;
      caseReasonCode: string;
    }>(sql`
      select count(*)::text as count,
        min(case_type) as "caseType",
        min(case_reason_code) as "caseReasonCode"
      from outbox_operator_alerts
      where outbox_id=${id}::uuid
    `);
    expect(cases.rows[0]).toEqual({
      count: "1",
      caseType: "delivery_failure",
      caseReasonCode: "delivery_failure",
    });
    expect(reconcile).toHaveBeenCalledOnce();
  });

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
      30_000,
      3,
    );
    await repository.recordAttemptStarted(
      id,
      "dispatch-a",
      claimed!.dispatchClaimToken!,
      "attempt-1",
      claimed!.reconciliationKey,
      now,
    );
    await repository.markUnknownOutcome(
      id,
      "dispatch-a",
      claimed!.dispatchClaimToken!,
      "attempt-1",
      "reservation:provider-key-1",
      "response_timeout",
    );
    const [firstReconciliation] = await repository.claimUnknown(
      1,
      "reconciler-a",
      30_000,
      3,
    );
    expect(firstReconciliation).toMatchObject({
      id,
      reconciliationKey: "reservation:provider-key-1",
      reconciliationAttempt: 1,
    });

    await testDb.expireReconciliationLease(id);
    expect(await repository.recoverExpiredReconciliationLeases()).toBe(1);
    const [recovered] = await repository.claimUnknown(
      1,
      "reconciler-b",
      30_000,
      3,
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
      30_000,
      3,
    );

    await testDb.expireDispatchLease(id);
    expect(await repository.recoverExpiredDispatchLeases()).toBe(1);
    expect(await testDb.outboxStatus(id)).toBe("unknown_outcome");
    expect(
      await repository.claim(
        1,
        "must-not-resend",
        30_000,
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
      30_000,
      3,
    );
    await repository.recordAttemptStarted(
      id,
      "dispatch-a",
      claimed!.dispatchClaimToken!,
      "attempt-key",
      claimed!.reconciliationKey,
      now,
    );

    await expect(
      repository.markUnknownOutcome(
        id,
        "dispatch-a",
        claimed!.dispatchClaimToken!,
        "attempt-key",
        "message:different-key",
        "response_timeout",
      ),
    ).rejects.toThrow("reconciliation key");
    expect(await testDb.outboxStatus(id)).toBe("processing");
  });

  it("rejects stale dispatch and reconciliation workers with a typed lease-lost error", async () => {
    const repository = new PostgresOutboxRepository(testDb.db);
    const id = await testDb.insertOutbox({
      topic: "selarti.send",
      reconciliationKey: "message:lease-key",
    });
    const [claimed] = await repository.claim(
      1,
      "dispatch-owner",
      30_000,
      3,
    );

    await expect(
      repository.recordAttemptStarted(
        id,
        "wrong-owner",
        claimed!.dispatchClaimToken!,
        "attempt-lease",
        claimed!.reconciliationKey,
        new Date(),
      ),
    ).rejects.toBeInstanceOf(OutboxLeaseLostError);

    await repository.recordAttemptStarted(
      id,
      "dispatch-owner",
      claimed!.dispatchClaimToken!,
      "attempt-lease",
      claimed!.reconciliationKey,
      new Date(),
    );
    await testDb.expireDispatchLease(id);
    await repository.recoverExpiredDispatchLeases();
    await expect(
      repository.succeed(
        id,
        "dispatch-owner",
        claimed!.dispatchClaimToken!,
      ),
    ).rejects.toBeInstanceOf(OutboxLeaseLostError);
    expect(await testDb.outboxStatus(id)).toBe("unknown_outcome");

    const [unknown] = await repository.claimUnknown(
      1,
      "reconciliation-owner",
      30_000,
      3,
    );
    await expect(
      repository.succeedAfterReconciliation(
        unknown!.id,
        "wrong-owner",
        unknown!.reconciliationClaimToken!,
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

  it("uses the PostgreSQL clock so worker clock skew cannot recover an active lease", async () => {
    const repository = new PostgresOutboxRepository(testDb.db);
    const id = await testDb.insertOutbox({
      topic: "telegram.send",
      reconciliationKey: "message:clock-authority",
    });
    const [claimed] = await repository.claim(1, "clock-worker", 60_000, 3);
    expect(claimed).toMatchObject({
      id,
      dispatchClaimToken: expect.any(String),
    });

    expect(await repository.recoverExpiredDispatchLeases()).toBe(0);
    expect(await testDb.outboxStatus(id)).toBe("processing");
  });

  it("rejects a stale same-owner generation after recovery and reclaim", async () => {
    const repository = new PostgresOutboxRepository(testDb.db);
    const id = await testDb.insertOutbox({
      topic: "selarti.send",
      reconciliationKey: "message:generation",
    });
    const [first] = await repository.claim(1, "same-worker", 60_000, 3);
    await testDb.expireDispatchLease(id);
    expect(await repository.recoverExpiredDispatchLeases()).toBe(1);
    const [unknown] = await repository.claimUnknown(1, "same-worker", 60_000, 3);
    await repository.retryAfterReconciliation(
      id,
      "same-worker",
      unknown!.reconciliationClaimToken!,
      new Date(),
      "reconciled_not_applied",
    );
    await testDb.makeOutboxRetryDue(id);
    const [second] = await repository.claim(1, "same-worker", 60_000, 3);
    expect(second!.dispatchClaimToken).not.toBe(first!.dispatchClaimToken);

    await expect(
      repository.succeed(id, "same-worker", first!.dispatchClaimToken!),
    ).rejects.toBeInstanceOf(OutboxLeaseLostError);
    expect(await testDb.outboxStatus(id)).toBe("processing");
    await repository.succeed(id, "same-worker", second!.dispatchClaimToken!);
    expect(await testDb.outboxStatus(id)).toBe("succeeded");
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
