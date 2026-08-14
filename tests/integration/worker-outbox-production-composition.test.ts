import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import type { Pool, PoolClient } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { composeWorkerOutboxDelivery } from "../../apps/worker/src/main.js";
import { PostgresOperatorCaseOutboxRepository } from "../../packages/db/src/repositories/operator-case-outbox-repository.js";
import {
  startTestPostgres,
  type TestDatabase,
} from "../../packages/db/src/testkit/postgres.js";

let testDb: TestDatabase;
beforeAll(async () => {
  testDb = await startTestPostgres();
  await testDb.migrate();
}, 120_000);
beforeEach(async () => testDb.reset());
afterAll(async () => testDb?.stop(), 120_000);

async function seedEscalation(): Promise<string> {
  const ownerId = await testDb.createUser();
  const incident = (
    await testDb.db.execute<{ id: string }>(sql`
      insert into safety_incidents (reason_code,metadata_hash)
      values ('worker_outbox_review','sha256:worker-outbox-review') returning id
    `)
  ).rows[0]!;
  const id = randomUUID();
  await testDb.db.execute(sql`
    insert into human_escalations (
      id,incident_id,status,owner_id,opened_at,acknowledgement_deadline,
      version,escalation_reason
    ) values (
      ${id}::uuid,${incident.id}::uuid,'escalated',${ownerId}::uuid,
      clock_timestamp()-interval '2 hours',clock_timestamp()-interval '1 hour',
      3,'worker_outbox_review'
    )
  `);
  return id;
}

async function seedFeedback(): Promise<string> {
  const userId = await testDb.createUser();
  const id = randomUUID();
  await testDb.db.execute(sql`
    insert into feedback (
      id,user_id,rating,source_event_id,content_hash,
      negative_policy_version,escalation_status
    ) values (
      ${id}::uuid,${userId}::uuid,2,${`worker-outbox:${randomUUID()}`},
      ${"c".repeat(64)},'negative-review-v1','escalated'
    )
  `);
  return id;
}

async function insertOutbox(input: {
  topic: string;
  payload: unknown;
  status?: string;
  attempt?: number;
  reconciliationAttempt?: number;
}): Promise<string> {
  const row = (
    await testDb.db.execute<{ id: string }>(sql`
      insert into integration_outbox (
        idempotency_key,topic,payload,correlation_id,reconciliation_key,
        payload_hash,status,attempt,reconciliation_attempt
      ) values (
        ${`worker-outbox:${randomUUID()}`},${input.topic},
        ${JSON.stringify(input.payload)}::jsonb,${`correlation:${randomUUID()}`},
        ${`reconciliation:${randomUUID()}`},${`sha256:${randomUUID()}`},
        ${input.status ?? "pending"}::outbox_status,${input.attempt ?? 0},
        ${input.reconciliationAttempt ?? 0}
      ) returning id
    `)
  ).rows[0];
  if (row === undefined) throw new Error("worker_outbox_fixture_missing");
  return row.id;
}

async function status(id: string): Promise<string> {
  return (
    await testDb.db.execute<{ status: string }>(sql`
      select status::text as status from integration_outbox where id=${id}::uuid
    `)
  ).rows[0]!.status;
}

async function blockedAuthorityChange(
  client: PoolClient,
  change: () => Promise<void>,
  materialize: () => Promise<unknown>,
): Promise<unknown> {
  await client.query("begin");
  try {
    await change();
    let settled = false;
    const pending = materialize().finally(() => {
      settled = true;
    });
    await new Promise((resolve) => setTimeout(resolve, 75));
    expect(settled).toBe(false);
    await client.query("commit");
    return await pending;
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

describe("review-remediated production worker outbox composition", () => {
  it("locks authoritative safety and feedback rows until eligibility is stable", async () => {
    const repository = new PostgresOperatorCaseOutboxRepository(testDb.db);
    const handoffId = await seedEscalation();
    const safetyOutboxId = await insertOutbox({
      topic: "safety.operator_escalation",
      payload: { handoffId, version: 3, charge: 0 },
    });
    const safetyClient = await (testDb.db.$client as Pool).connect();
    const safety = await blockedAuthorityChange(
      safetyClient,
      async () => {
        await safetyClient.query(
          "update human_escalations set status='resolved',version=4,resolved_at=transaction_timestamp(),updated_at=transaction_timestamp() where id=$1::uuid",
          [handoffId],
        );
      },
      () =>
        repository.materialize({
          outboxId: safetyOutboxId,
          topic: "safety.operator_escalation",
          payload: { handoffId, version: 3, charge: 0 },
        }),
    );
    expect(safety).toBe("source_invalid");

    const feedbackId = await seedFeedback();
    const feedbackOutboxId = await insertOutbox({
      topic: "admin.negative_feedback",
      payload: {
        feedbackId,
        contentHash: "d".repeat(64),
        policyVersion: "payload-review-v1",
      },
    });
    const feedbackClient = await (testDb.db.$client as Pool).connect();
    const feedback = await blockedAuthorityChange(
      feedbackClient,
      async () => {
        await feedbackClient.query(
          "update feedback set escalation_status='none' where id=$1::uuid",
          [feedbackId],
        );
      },
      () =>
        repository.materialize({
          outboxId: feedbackOutboxId,
          topic: "admin.negative_feedback",
          payload: {
            feedbackId,
            contentHash: "d".repeat(64),
            policyVersion: "payload-review-v1",
          },
        }),
    );
    expect(feedback).toBe("materialized");
    const failure = (
      await testDb.db.execute<{ type: string }>(sql`
        select case_type as type from outbox_operator_alerts
        where outbox_id=${feedbackOutboxId}::uuid
      `)
    ).rows[0];
    expect(failure?.type).toBe("delivery_failure");
  });

  it("runs real filtered recovery, exhaustion, metrics and ambiguity without provider ownership", async () => {
    const handoffId = await seedEscalation();
    const payload = { handoffId, version: 3, charge: 0 };
    const appliedId = await insertOutbox({
      topic: "safety.operator_escalation",
      payload,
    });
    const providerPending = await insertOutbox({
      topic: "provider.pending",
      payload: {},
    });
    const labels: Record<string, unknown>[] = [];
    const composition = composeWorkerOutboxDelivery(
      testDb.db,
      undefined,
      (value, count) => labels.push({ ...value, count: count ?? 1 }),
    );
    await testDb.db.execute(sql`
      create or replace function worker_outbox_fail_ack() returns trigger
      language plpgsql as $$
      begin
        if new.status='succeeded' and old.status='processing' then
          raise exception 'simulated_ack_failure';
        end if;
        return new;
      end $$;
    `);
    await testDb.db.execute(sql`
      create trigger worker_outbox_fail_ack_trigger
      before update on integration_outbox
      for each row execute function worker_outbox_fail_ack()
    `);
    await expect(composition.run()).rejects.toThrow("simulated_ack_failure");
    expect(await status(appliedId)).toBe("processing");
    await testDb.db.execute(sql`
      drop trigger worker_outbox_fail_ack_trigger on integration_outbox
    `);
    await testDb.db.execute(sql`drop function worker_outbox_fail_ack()`);
    await testDb.db.execute(sql`
      update integration_outbox set lease_until=clock_timestamp()-interval '1 second'
      where id=${appliedId}::uuid
    `);

    const localProcessing = await insertOutbox({
      topic: "safety.operator_escalation",
      payload,
      status: "processing",
      attempt: 1,
    });
    const localReconciling = await insertOutbox({
      topic: "safety.operator_escalation",
      payload,
      status: "reconciling",
      attempt: 1,
      reconciliationAttempt: 1,
    });
    const localDispatchExhausted = await insertOutbox({
      topic: "safety.operator_escalation",
      payload,
      attempt: 3,
    });
    const localReconciliationExhausted = await insertOutbox({
      topic: "safety.operator_escalation",
      payload,
      status: "unknown_outcome",
      attempt: 1,
      reconciliationAttempt: 3,
    });
    const providerProcessing = await insertOutbox({
      topic: "provider.processing",
      payload: {},
      status: "processing",
      attempt: 1,
    });
    const providerReconciling = await insertOutbox({
      topic: "provider.reconciling",
      payload: {},
      status: "reconciling",
      attempt: 1,
      reconciliationAttempt: 1,
    });
    const providerDispatchExhausted = await insertOutbox({
      topic: "provider.dispatch_exhausted",
      payload: {},
      attempt: 3,
    });
    const providerReconciliationExhausted = await insertOutbox({
      topic: "provider.reconciliation_exhausted",
      payload: {},
      status: "unknown_outcome",
      attempt: 1,
      reconciliationAttempt: 3,
    });
    await testDb.db.execute(sql`
      update integration_outbox
      set dispatch_owner_id='stale',dispatch_claim_token='stale',
        lease_until=clock_timestamp()-interval '1 second'
      where id in (${localProcessing}::uuid,${providerProcessing}::uuid);
      update integration_outbox
      set reconciliation_owner_id='stale',reconciliation_claim_token='stale',
        reconciliation_lease_until=clock_timestamp()-interval '1 second'
      where id in (${localReconciling}::uuid,${providerReconciling}::uuid)
    `);

    await expect(composition.run()).resolves.toMatchObject({
      reconciled: 3,
    });
    expect(await status(appliedId)).toBe("succeeded");
    expect(await status(localDispatchExhausted)).toBe("dead_letter");
    expect(await status(localReconciliationExhausted)).toBe("dead_letter");
    await expect(
      Promise.all([
        providerPending,
        providerProcessing,
        providerReconciling,
        providerDispatchExhausted,
        providerReconciliationExhausted,
      ].map(status)),
    ).resolves.toEqual([
      "pending",
      "processing",
      "reconciling",
      "pending",
      "unknown_outcome",
    ]);
    expect(
      (
        await testDb.db.execute<{ count: string }>(sql`
          select count(*)::text as count from outbox_operator_alerts
          where outbox_id=${appliedId}::uuid
        `)
      ).rows[0]?.count,
    ).toBe("1");
    const serialized = JSON.stringify(labels);
    expect(serialized).toContain("lease_expired");
    expect(serialized).toContain("attempts_exhausted");
    expect(serialized).toContain("reconciliation_exhausted");
    expect(serialized).toContain("applied");
    expect(serialized).not.toContain("provider");
    expect(serialized).not.toContain(appliedId);
  });
});
