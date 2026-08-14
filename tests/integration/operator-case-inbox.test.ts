import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createOperatorCaseService } from "../../packages/application/src/operator-case-service.js";
import { closeDb, createDb } from "../../packages/db/src/client.js";
import { PostgresOperatorCaseRepository } from "../../packages/db/src/repositories/operator-case-repository.js";
import { PostgresWorkerJobsRepository } from "../../packages/db/src/repositories/worker-jobs-repository.js";

const schema = `operator_cases_${process.pid}_${randomUUID().replaceAll("-", "").slice(0, 12)}`;
const connectionString =
  process.env.II_TONYA_TEST_POSTGRES_ADMIN_URL ?? process.env.DATABASE_URL;
if (!connectionString) throw new Error("test_database_unavailable");
const isolatedUrl = new URL(connectionString);
isolatedUrl.searchParams.set("options", `-c search_path=${schema},public`);
const db = createDb(isolatedUrl.toString());
const workerA = new PostgresWorkerJobsRepository(db);
const workerB = new PostgresWorkerJobsRepository(db);
const cases = new PostgresOperatorCaseRepository(db);
const support = {
  id: "00000000-0000-4000-8000-000000000001",
  sessionIdHash: "sha256:support-session",
  roles: ["support" as const],
  mfaVerifiedAt: new Date("2026-08-14T09:59:00.000Z"),
};
const security = {
  ...support,
  id: "00000000-0000-4000-8000-000000000002",
  sessionIdHash: "sha256:security-session",
  roles: ["security_admin" as const],
};
const feedbackId = "00000000-0000-4000-8000-000000000101";
const handoffId = "00000000-0000-4000-8000-000000000102";
const absentFeedbackId = "00000000-0000-4000-8000-000000000103";

describe("durable operator case inbox on shared Claw PostgreSQL", () => {
  beforeAll(async () => {
    await db.execute(
      sql.raw(`drop schema if exists ${schema} cascade; create schema ${schema};
        create table integration_outbox (
          id uuid primary key default gen_random_uuid(),
          topic text not null,
          status text not null default 'pending',
          payload jsonb not null,
          next_attempt_at timestamptz,
          created_at timestamptz not null default now(),
          updated_at timestamptz not null default now()
        );
        create table feedback (
          id uuid primary key,
          rating integer not null,
          content_hash text not null,
          negative_policy_version text not null
        );
        create table outbox_operator_alerts (
          id uuid primary key default gen_random_uuid(),
          outbox_id uuid not null references integration_outbox(id),
          reason_code text not null,
          created_at timestamptz not null default now(),
          constraint outbox_operator_alerts_outbox_reason_unique unique(outbox_id,reason_code)
        );
        create table audit_events (
          id uuid primary key default gen_random_uuid(),
          actor_type text not null,
          actor_id uuid not null,
          authenticated_session_id_hash text not null,
          action text not null,
          object_type text not null,
          object_id uuid not null,
          decision text not null,
          reason_code text not null,
          correlation_id text not null,
          occurred_at timestamptz not null,
          metadata_hash text not null
        );`),
    );
    await db.execute(sql`
      insert into integration_outbox (id,topic,status,payload,created_at)
      values (
        '00000000-0000-4000-8000-000000000200','mail.delivery','dead_letter',
        '{}','2026-08-14T09:58:00Z'
      )
    `);
    await db.execute(sql`
      insert into outbox_operator_alerts (outbox_id,reason_code,created_at)
      values (
        '00000000-0000-4000-8000-000000000200',
        'Legacy Reason With Spaces / punctuation','2026-08-14T09:58:00Z'
      )
    `);
    const migration = await readFile(
      "packages/db/migrations/0028_operator_case_inbox.sql",
      "utf8",
    );
    for (const statement of migration
      .split("--> statement-breakpoint")
      .map((value) => value.trim())
      .filter(Boolean))
      await db.execute(sql.raw(statement));
    await db.execute(sql`
      insert into feedback (id,rating,content_hash,negative_policy_version)
      values (${feedbackId}::uuid,1,${"a".repeat(64)},'negative-v1')
    `);
    await db.execute(sql`
      insert into integration_outbox (id,topic,payload,created_at) values
      ('00000000-0000-4000-8000-000000000203','admin.negative_feedback',
       ${JSON.stringify({ feedbackId: "not-a-uuid", rawText: "forbidden malformed feedback" })}::jsonb,
       '2026-08-14T09:59:00Z'),
      ('00000000-0000-4000-8000-000000000204','admin.negative_feedback',
       ${JSON.stringify({ feedbackId: absentFeedbackId, rawText: "forbidden orphan feedback" })}::jsonb,
       '2026-08-14T09:59:30Z'),
      ('00000000-0000-4000-8000-000000000201','safety.operator_escalation',
       ${JSON.stringify({ handoffId, rawDialogue: "forbidden safety narrative" })}::jsonb,
       '2026-08-14T10:00:00Z'),
      ('00000000-0000-4000-8000-000000000202','admin.negative_feedback',
       ${JSON.stringify({ feedbackId, rawText: "forbidden private feedback" })}::jsonb,
       '2026-08-14T10:01:00Z');
    `);
  });
  afterAll(async () => {
    await db.execute(sql.raw(`drop schema if exists ${schema} cascade`));
    await closeDb(db);
  });

  it("quarantines invalid feedback sources without starving concurrent workers", async () => {
    await expect(workerA.materializeOperatorCasesBatch(2)).resolves.toEqual({
      materialized: 2,
    });
    const reports = await Promise.all([
      workerA.materializeOperatorCasesBatch(10),
      workerB.materializeOperatorCasesBatch(10),
    ]);
    expect(reports.reduce((sum, report) => sum + report.materialized, 0)).toBe(
      2,
    );
    await expect(workerA.materializeOperatorCasesBatch(10)).resolves.toEqual({
      materialized: 0,
    });
    const facts = await db.execute<{
      cases: string;
      succeeded: string;
      stored: string;
    }>(sql`
      select
        (select count(*)::text from outbox_operator_alerts) as cases,
        (select count(*)::text from integration_outbox where status='succeeded') as succeeded,
        (select string_agg(row_to_json(c)::text,'') from outbox_operator_alerts c) as stored
    `);
    expect(facts.rows[0]).toMatchObject({ cases: "5", succeeded: "4" });
    expect(facts.rows[0]!.stored).not.toMatch(
      new RegExp(
        `${feedbackId}|${handoffId}|${absentFeedbackId}|forbidden private|forbidden safety|forbidden malformed|forbidden orphan|rawDialogue|rawText`,
        "u",
      ),
    );
    const safeReasons = await db.execute<{
      reasonCode: string;
      caseType: string;
    }>(sql`
      select case_reason_code as "reasonCode",case_type as "caseType"
      from outbox_operator_alerts
      order by created_at,id
    `);
    expect(safeReasons.rows).toEqual(
      expect.arrayContaining([
        { reasonCode: "delivery_failure", caseType: "delivery_failure" },
        {
          reasonCode: "negative_feedback_source_invalid",
          caseType: "delivery_failure",
        },
        {
          reasonCode: "negative_feedback_policy",
          caseType: "negative_feedback",
        },
        { reasonCode: "safety_operator_escalation", caseType: "safety" },
      ]),
    );
  });

  it("paginates role-scoped unresolved cases and audits first transitions only", async () => {
    await workerA.materializeOperatorCasesBatch(10);
    const deliveryOutboxId = randomUUID();
    await db.execute(sql`
      insert into integration_outbox (id,topic,status,payload,created_at)
      values (${deliveryOutboxId}::uuid,'mail.delivery','dead_letter','{}','2026-08-14T10:02:00Z')
    `);
    await db.execute(sql`
      insert into outbox_operator_alerts (
        outbox_id,reason_code,case_type,status,updated_at
      ) values (
        ${deliveryOutboxId}::uuid,'dispatch_attempts_exhausted',
        'delivery_failure','open','2026-08-14T10:02:00Z'
      );
    `);
    const service = createOperatorCaseService({ cases });
    const first = await service.listOpen(support, { limit: 1 });
    expect(first.kind).toBe("ok");
    if (first.kind !== "ok") throw new Error("support list denied");
    expect(first.items).toHaveLength(1);
    expect(first.items[0]!.type).toBe("delivery_failure");
    expect(first.nextCursor).toBeDefined();
    const second = await service.listOpen(support, {
      limit: 1,
      cursor: first.nextCursor,
    });
    expect(second.kind === "ok" && second.items[0]?.type).toBe(
      "negative_feedback",
    );
    const safety = await service.listOpen(security, { limit: 10 });
    expect(
      safety.kind === "ok" && safety.items.map(({ type }) => type),
    ).toEqual(["safety"]);

    const negativeId = second.kind === "ok" ? second.items[0]!.id : "";
    const concurrent = await Promise.all([
      service.transition(support, {
        caseId: negativeId,
        action: "acknowledge",
      }),
      service.transition(support, {
        caseId: negativeId,
        action: "acknowledge",
      }),
    ]);
    expect(concurrent.map(({ kind }) => kind).sort()).toEqual([
      "replayed",
      "updated",
    ]);
    await expect(
      service.transition(support, { caseId: negativeId, action: "resolve" }),
    ).resolves.toMatchObject({ kind: "updated" });
    await expect(
      service.transition(support, { caseId: negativeId, action: "resolve" }),
    ).resolves.toMatchObject({ kind: "replayed" });
    const audit = await db.execute<{ count: string }>(sql`
      select count(*)::text as count from audit_events
      where object_id=${negativeId}::uuid
    `);
    expect(audit.rows[0]?.count).toBe("2");
  });
});
