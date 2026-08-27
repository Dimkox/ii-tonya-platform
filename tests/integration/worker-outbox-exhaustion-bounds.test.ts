import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { PostgresOutboxRepository } from "../../packages/db/src/repositories/outbox-repository.js";
import {
  startTestPostgres,
  type TestDatabase,
} from "../../packages/db/src/testkit/postgres.js";
import { LOCAL_OPERATOR_CASE_OUTBOX_TOPICS } from "../../packages/worker/src/local-operator-case-outbox.js";
import { runOutboxBatch } from "../../packages/worker/src/outbox-runner.js";

let testDb: TestDatabase;

beforeAll(async () => {
  testDb = await startTestPostgres();
  await testDb.migrate();
}, 120_000);

beforeEach(async () => testDb.reset());
afterAll(async () => testDb?.stop(), 120_000);

async function insertExhausted(
  status: "pending" | "unknown_outcome",
  topic = "safety.operator_escalation",
) {
  return (
    await testDb.db.execute<{ id: string }>(sql`
      insert into integration_outbox (
        idempotency_key,topic,payload,correlation_id,reconciliation_key,
        payload_hash,status,attempt,reconciliation_attempt
      ) values (
        ${`exhaustion-bound:${randomUUID()}`},${topic},
        '{}'::jsonb,${`correlation:${randomUUID()}`},
        ${`reconciliation:${randomUUID()}`},${`sha256:${randomUUID()}`},
        ${status}::outbox_status,${status === "pending" ? 3 : 1},
        ${status === "unknown_outcome" ? 3 : 0}
      ) returning id
    `)
  ).rows[0]!.id;
}

async function statusCounts(ids: readonly string[]) {
  return Object.fromEntries(
    (
      await testDb.db.execute<{ status: string; count: string }>(sql`
        select status::text,count(*)::text as count from integration_outbox
        where id in (${sql.join(
          ids.map((id) => sql`${id}::uuid`),
          sql`,`,
        )}) group by status order by status
      `)
    ).rows.map((row) => [row.status, Number(row.count)]),
  );
}

describe("worker outbox exhaustion cycle bounds", () => {
  it("terminalizes no more than the claim limit in either phase", async () => {
    const repository = new PostgresOutboxRepository(
      testDb.db,
      LOCAL_OPERATOR_CASE_OUTBOX_TOPICS,
    );
    const dispatchIds = await Promise.all([
      insertExhausted("pending"),
      insertExhausted("pending"),
      insertExhausted("pending"),
    ]);
    const reconciliationIds = await Promise.all([
      insertExhausted("unknown_outcome"),
      insertExhausted("unknown_outcome"),
      insertExhausted("unknown_outcome"),
    ]);

    const dispatch = await repository.claimWithMetrics(2, "bounded", 1_000, 3);
    expect(dispatch.messages).toEqual([]);
    expect(dispatch.exhausted).toEqual([
      { topic: "safety.operator_escalation", count: 2 },
    ]);
    expect(await statusCounts(dispatchIds)).toEqual({
      dead_letter: 2,
      pending: 1,
    });

    const reconciliation = await repository.claimUnknownWithMetrics(
      2,
      "bounded",
      1_000,
      3,
    );
    expect(reconciliation.messages).toEqual([]);
    expect(reconciliation.exhausted).toEqual([
      { topic: "safety.operator_escalation", count: 2 },
    ]);
    expect(await statusCounts(reconciliationIds)).toEqual({
      dead_letter: 2,
      unknown_outcome: 1,
    });
  });

  it("emits exact per-topic exhaustion metrics from real SQL counts", async () => {
    await insertExhausted("pending", "safety.operator_escalation");
    await insertExhausted("pending", "admin.negative_feedback");
    await insertExhausted("pending", "admin.negative_feedback");
    await insertExhausted("unknown_outcome", "safety.operator_escalation");
    await insertExhausted("unknown_outcome", "safety.operator_escalation");
    await insertExhausted("unknown_outcome", "admin.negative_feedback");
    const repository = new PostgresOutboxRepository(
      testDb.db,
      LOCAL_OPERATOR_CASE_OUTBOX_TOPICS,
    );
    const records: unknown[] = [];

    await expect(
      runOutboxBatch({
        repository,
        dispatcher: { dispatch: vi.fn() },
        reconciler: { reconcile: vi.fn() },
        metrics: {
          record: (labels, count) => records.push({ ...labels, count }),
        },
        now: () => new Date(),
        retryDelayMs: () => 1_000,
        maxAttempts: 3,
        maxReconciliationAttempts: 3,
        batchSize: 10,
        workerId: "metric-bounds",
        newAttemptId: randomUUID,
      }),
    ).resolves.toEqual({ dispatched: 0, reconciled: 0 });
    expect(records).toEqual([
      {
        topic: "safety_operator_escalation",
        phase: "claim",
        outcome: "dead_letter",
        reasonClass: "reconciliation_exhausted",
        count: 2,
      },
      {
        topic: "admin_negative_feedback",
        phase: "claim",
        outcome: "dead_letter",
        reasonClass: "reconciliation_exhausted",
        count: 1,
      },
      {
        topic: "safety_operator_escalation",
        phase: "claim",
        outcome: "dead_letter",
        reasonClass: "attempts_exhausted",
        count: 1,
      },
      {
        topic: "admin_negative_feedback",
        phase: "claim",
        outcome: "dead_letter",
        reasonClass: "attempts_exhausted",
        count: 2,
      },
    ]);
  });
});
