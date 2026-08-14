import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { composeWorkerOutboxDelivery } from "../../apps/worker/src/main.js";
import {
  startTestPostgres,
  type TestDatabase,
} from "../../packages/db/src/testkit/postgres.js";

let testDb: TestDatabase;

beforeAll(async () => {
  testDb = await startTestPostgres();
  await testDb.migrate();
  await testDb.reset();
}, 120_000);

afterAll(async () => testDb?.stop(), 120_000);

async function insertOutbox(topic: string, payload: unknown): Promise<string> {
  const row = (
    await testDb.db.execute<{ id: string }>(sql`
      insert into integration_outbox (
        idempotency_key,topic,payload,correlation_id,reconciliation_key,payload_hash
      ) values (
        ${`final-gate:${randomUUID()}`},${topic},${JSON.stringify(payload)}::jsonb,
        ${`final-gate-correlation:${randomUUID()}`},
        ${`final-gate-reconciliation:${randomUUID()}`},
        ${`sha256:${randomUUID()}`}
      ) returning id
    `)
  ).rows[0];
  if (row === undefined) throw new Error("worker_outbox_final_fixture_missing");
  return row.id;
}

describe("MVP-WORKER-OUTBOX-001 final reviewed gate", () => {
  it("delivers both local topics through production composition without claiming a provider row", async () => {
    const ownerId = await testDb.createUser();
    const incidentId = (
      await testDb.db.execute<{ id: string }>(sql`
        insert into safety_incidents (reason_code,metadata_hash)
        values ('worker_outbox_final','sha256:worker-outbox-final') returning id
      `)
    ).rows[0]!.id;
    const handoffId = randomUUID();
    await testDb.db.execute(sql`
      insert into human_escalations (
        id,incident_id,status,owner_id,opened_at,acknowledgement_deadline,
        version,escalation_reason
      ) values (
        ${handoffId}::uuid,${incidentId}::uuid,'escalated',${ownerId}::uuid,
        clock_timestamp()-interval '2 hours',clock_timestamp()-interval '1 hour',
        7,'worker_outbox_final'
      )
    `);

    const feedbackUserId = await testDb.createUser();
    const feedbackId = randomUUID();
    await testDb.db.execute(sql`
      insert into feedback (
        id,user_id,rating,source_event_id,content_hash,
        negative_policy_version,escalation_status
      ) values (
        ${feedbackId}::uuid,${feedbackUserId}::uuid,1,
        ${`worker-outbox-final:${randomUUID()}`},${"e".repeat(64)},
        'worker-outbox-final-v1','escalated'
      )
    `);

    const safetyId = await insertOutbox("safety.operator_escalation", {
      handoffId,
      version: 7,
      charge: 0,
    });
    const feedbackOutboxId = await insertOutbox("admin.negative_feedback", {
      feedbackId,
      contentHash: "f".repeat(64),
      policyVersion: "payload-cannot-authorize-v1",
    });
    const providerId = await insertOutbox("provider.final_gate", {
      operation: "must-remain-unclaimed",
    });
    const metrics: { topic: string }[] = [];

    await expect(
      composeWorkerOutboxDelivery(testDb.db, undefined, (labels) =>
        metrics.push({ topic: labels.topic }),
      ).run(),
    ).resolves.toEqual({ dispatched: 2, reconciled: 0 });

    const outboxRows = await testDb.db.execute<{
      id: string;
      status: string;
    }>(sql`
      select id::text,status::text from integration_outbox
      where id in (${safetyId}::uuid,${feedbackOutboxId}::uuid,${providerId}::uuid)
      order by id
    `);
    expect(Object.fromEntries(outboxRows.rows.map((row) => [row.id, row.status]))).toEqual(
      {
        [safetyId]: "succeeded",
        [feedbackOutboxId]: "succeeded",
        [providerId]: "pending",
      },
    );

    const cases = await testDb.db.execute<{ caseType: string }>(sql`
      select case_type as "caseType" from outbox_operator_alerts
      where outbox_id in (${safetyId}::uuid,${feedbackOutboxId}::uuid,${providerId}::uuid)
      order by case_type
    `);
    expect(cases.rows).toEqual([
      { caseType: "negative_feedback" },
      { caseType: "safety" },
    ]);
    expect(new Set(metrics.map(({ topic }) => topic))).toEqual(
      new Set(["safety_operator_escalation", "admin_negative_feedback"]),
    );
  });
});
