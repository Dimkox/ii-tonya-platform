import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PostgresOperatorCaseOutboxRepository } from "../../packages/db/src/repositories/operator-case-outbox-repository.js";
import {
  startTestPostgres,
  type TestDatabase,
} from "../../packages/db/src/testkit/postgres.js";
import { createLocalOperatorCaseOutboxRegistry } from "../../packages/worker/src/local-operator-case-outbox.js";

let testDb: TestDatabase;
let repositoryA: PostgresOperatorCaseOutboxRepository;
let repositoryB: PostgresOperatorCaseOutboxRepository;

beforeAll(async () => {
  testDb = await startTestPostgres();
  await testDb.migrate();
  repositoryA = new PostgresOperatorCaseOutboxRepository(testDb.db);
  repositoryB = new PostgresOperatorCaseOutboxRepository(testDb.db);
}, 120_000);
beforeEach(async () => testDb.reset());
afterAll(async () => testDb?.stop(), 120_000);

async function insertOutbox(topic: string, payload: unknown): Promise<string> {
  const row = (
    await testDb.db.execute<{ id: string }>(sql`
      insert into integration_outbox (
        idempotency_key,topic,payload,correlation_id,reconciliation_key,payload_hash
      ) values (
        ${`operator-case:${randomUUID()}`},${topic},${JSON.stringify(payload)}::jsonb,
        ${`operator-case-correlation:${randomUUID()}`},
        ${`operator-case-reconciliation:${randomUUID()}`},
        ${`sha256:${randomUUID()}`}
      ) returning id
    `)
  ).rows[0];
  if (row === undefined) throw new Error("outbox_fixture_missing");
  return row.id;
}

async function seedEscalation(input?: {
  status?: string;
  version?: number;
}): Promise<string> {
  const ownerId = await testDb.createUser();
  const incident = (
    await testDb.db.execute<{ id: string }>(sql`
      insert into safety_incidents (reason_code,metadata_hash)
      values ('operator_case_test','sha256:operator-case-test') returning id
    `)
  ).rows[0]!;
  const handoffId = randomUUID();
  await testDb.db.execute(sql`
    insert into human_escalations (
      id,incident_id,status,owner_id,opened_at,acknowledgement_deadline,
      version,escalation_reason
    ) values (
      ${handoffId}::uuid,${incident.id}::uuid,${input?.status ?? "escalated"},
      ${ownerId}::uuid,clock_timestamp()-interval '2 hours',
      clock_timestamp()-interval '1 hour',${input?.version ?? 3},
      'operator_case_test'
    )
  `);
  return handoffId;
}

async function seedFeedback(status = "escalated"): Promise<{
  id: string;
  hash: string;
  policy: string;
}> {
  const userId = await testDb.createUser();
  const id = randomUUID();
  const hash = "c".repeat(64);
  const policy = "negative-authoritative-v3";
  await testDb.db.execute(sql`
    insert into feedback (
      id,user_id,rating,source_event_id,content_hash,
      negative_policy_version,escalation_status
    ) values (
      ${id}::uuid,${userId}::uuid,2,${`operator-case:${randomUUID()}`},
      ${hash},${policy},${status}
    )
  `);
  return { id, hash, policy };
}

async function caseCount(outboxId: string): Promise<number> {
  const row = (
    await testDb.db.execute<{ count: string }>(sql`
      select count(*)::text as count from outbox_operator_alerts
      where outbox_id=${outboxId}::uuid
    `)
  ).rows[0];
  return Number(row?.count ?? 0);
}

describe("local operator-case outbox delivery", () => {
  it("materializes concurrent safety and feedback deliveries once without source identifiers", async () => {
    const handoffId = await seedEscalation();
    const feedback = await seedFeedback();
    const safetyOutboxId = await insertOutbox("safety.operator_escalation", {
      handoffId,
      version: 3,
      charge: 0,
    });
    const feedbackOutboxId = await insertOutbox("admin.negative_feedback", {
      feedbackId: feedback.id,
      contentHash: "d".repeat(64),
      policyVersion: "payload-mismatch-v9",
    });
    const safety = {
      outboxId: safetyOutboxId,
      topic: "safety.operator_escalation" as const,
      payload: { handoffId, version: 3, charge: 0 as const },
    };
    const negative = {
      outboxId: feedbackOutboxId,
      topic: "admin.negative_feedback" as const,
      payload: {
        feedbackId: feedback.id,
        contentHash: "d".repeat(64),
        policyVersion: "payload-mismatch-v9",
      },
    };

    await expect(
      Promise.all([
        repositoryA.materialize(safety),
        repositoryB.materialize(safety),
        repositoryA.materialize(negative),
        repositoryB.materialize(negative),
      ]),
    ).resolves.toEqual(expect.arrayContaining(["materialized", "replayed"]));
    expect(await caseCount(safetyOutboxId)).toBe(1);
    expect(await caseCount(feedbackOutboxId)).toBe(1);
    const stored = await testDb.db.execute<{
      stored: string;
      rating: number | null;
      contentHash: string | null;
      policyVersion: string | null;
    }>(sql`
      select row_to_json(c)::text as stored,rating,
        content_hash as "contentHash",policy_version as "policyVersion"
      from outbox_operator_alerts c
      where outbox_id in (${safetyOutboxId}::uuid,${feedbackOutboxId}::uuid)
      order by case_type
    `);
    expect(stored.rows.map((row) => row.stored).join("")).not.toMatch(
      new RegExp(`${handoffId}|${feedback.id}|payload-mismatch`, "u"),
    );
    expect(stored.rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          rating: 2,
          contentHash: feedback.hash,
          policyVersion: feedback.policy,
        }),
      ]),
    );
  });

  it("requires an authoritative escalated handoff with the exact version", async () => {
    const handoffId = await seedEscalation({ version: 4 });
    const outboxId = await insertOutbox("safety.operator_escalation", {
      handoffId,
      version: 3,
      charge: 0,
    });

    await expect(
      repositoryA.materialize({
        outboxId,
        topic: "safety.operator_escalation",
        payload: { handoffId, version: 3, charge: 0 },
      }),
    ).resolves.toBe("source_invalid");
    await expect(
      repositoryA.inspect({
        outboxId,
        topic: "safety.operator_escalation",
      }),
    ).resolves.toBe("source_invalid");
    expect(await caseCount(outboxId)).toBe(0);
  });

  it("resolves post-mutation ambiguity by durable inspection without a duplicate case", async () => {
    const handoffId = await seedEscalation();
    const outboxId = await insertOutbox("safety.operator_escalation", {
      handoffId,
      version: 3,
      charge: 0,
    });
    const input = {
      outboxId,
      topic: "safety.operator_escalation" as const,
      payload: { handoffId, version: 3, charge: 0 as const },
    };
    await expect(repositoryA.materialize(input)).resolves.toBe("materialized");
    await expect(
      repositoryA.inspect({ outboxId, topic: input.topic }),
    ).resolves.toBe("applied");
    const registry = createLocalOperatorCaseOutboxRegistry(repositoryA);
    await expect(
      registry.reconcile({
        id: outboxId,
        topic: input.topic,
        payload: input.payload,
      }),
    ).resolves.toEqual({ kind: "applied" });
    await expect(repositoryB.materialize(input)).resolves.toBe("replayed");
    expect(await caseCount(outboxId)).toBe(1);
  });

  it("materializes bounded delivery failures for missing or ineligible feedback sources", async () => {
    const ineligible = await seedFeedback("none");
    for (const feedbackId of [ineligible.id, randomUUID()]) {
      const outboxId = await insertOutbox("admin.negative_feedback", {
        feedbackId,
        contentHash: "e".repeat(64),
        policyVersion: "negative-v1",
      });
      await expect(
        repositoryA.materialize({
          outboxId,
          topic: "admin.negative_feedback",
          payload: {
            feedbackId,
            contentHash: "e".repeat(64),
            policyVersion: "negative-v1",
          },
        }),
      ).resolves.toBe("materialized");
      const row = (
        await testDb.db.execute<{
          caseType: string;
          reason: string;
          rating: number | null;
          hash: string | null;
          policy: string | null;
        }>(sql`
          select case_type as "caseType",case_reason_code as reason,
            rating,content_hash as hash,policy_version as policy
          from outbox_operator_alerts where outbox_id=${outboxId}::uuid
        `)
      ).rows[0];
      expect(row).toEqual({
        caseType: "delivery_failure",
        reason: "negative_feedback_source_invalid",
        rating: null,
        hash: null,
        policy: null,
      });
    }
  });
});
