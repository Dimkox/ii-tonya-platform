import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { PostgresLifecycleSchedulerRepository } from "../../packages/db/src/repositories/lifecycle-scheduler-repository.js";
import {
  startTestPostgres,
  type TestDatabase,
} from "../../packages/db/src/testkit/postgres.js";
import {
  seedLifecycleFixture,
  type LifecycleFixture,
} from "./lifecycle-scheduler.fixture.js";

describe("SCRUM-512 lifecycle kinds (feedback, fail-closed flags)", () => {
  let database: TestDatabase;
  let fixture: LifecycleFixture;

  beforeAll(async () => {
    database = await startTestPostgres();
    await database.migrate();
    fixture = await seedLifecycleFixture(database);
  }, 120_000);

  afterAll(async () => database.stop(), 120_000);

  const afterVisit = () =>
    new Date(fixture.startsAt.getTime() + 4 * 60 * 60 * 1_000);

  it("schedules nothing for non-booking kinds when every flag is off", async () => {
    await expect(
      fixture.repository.scheduleNonBookingLifecycle({
        now: afterVisit(),
        batchSize: 10,
      }),
    ).resolves.toBe(0);
  });

  it("schedules post-visit feedback idempotently and materializes one delivery", async () => {
    const repository = new PostgresLifecycleSchedulerRepository(
      database.db,
      "client-messaging-v1",
      "client-test",
      { reminders: false, feedback: true },
    );
    const now = afterVisit();
    await expect(
      repository.scheduleNonBookingLifecycle({ now, batchSize: 10 }),
    ).resolves.toBe(1);
    await expect(
      repository.scheduleNonBookingLifecycle({ now, batchSize: 10 }),
    ).resolves.toBe(0);
    await expect(
      repository.processDueLifecycleBatch({ now, batchSize: 10 }),
    ).resolves.toEqual({ examined: 1, materialized: 1, cancelled: 0 });
    const rows = await database.db.execute<{
      text: string;
      status: string;
    }>(sql`
      select o.payload->>'text' as text, j.status
      from lifecycle_jobs j
      join integration_outbox o on o.correlation_id='lifecycle:'||j.id::text
      where j.job_type='post_visit_feedback' and j.subject_id=${fixture.reservationId}::uuid
    `);
    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0]!.status).toBe("succeeded");
    expect(rows.rows[0]!.text).toContain("отзыв");
  });

  it("cancels an already-queued job when its kind is disabled", async () => {
    const now = afterVisit();
    await database.db.execute(sql`
      insert into lifecycle_jobs(subject_id,subject_kind,job_type,occurrence_key,run_at)
      values(${fixture.userId}::uuid,'user','weekly_checkup','2026-W01',${new Date(now.getTime() - 1_000)})
    `);
    const repository = new PostgresLifecycleSchedulerRepository(
      database.db,
      "client-messaging-v1",
      "client-test",
      { reminders: false },
    );
    await expect(
      repository.processDueLifecycleBatch({ now, batchSize: 10 }),
    ).resolves.toEqual({ examined: 1, materialized: 0, cancelled: 1 });
    const job = await database.db.execute<{
      status: string;
      reason: string;
    }>(sql`
      select status, cancellation_reason as reason from lifecycle_jobs
      where job_type='weekly_checkup' and subject_id=${fixture.userId}::uuid
    `);
    expect(job.rows[0]).toEqual({
      status: "cancelled",
      reason: "kind_disabled",
    });
    const outbox = await database.db.execute<{ n: string }>(sql`
      select count(*)::text as n from integration_outbox o
      join lifecycle_jobs j on o.correlation_id='lifecycle:'||j.id::text
      where j.job_type='weekly_checkup'
    `);
    expect(outbox.rows[0]!.n).toBe("0");
  });
});
