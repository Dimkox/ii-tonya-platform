import { randomUUID } from "node:crypto";

import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  startTestPostgres,
  type TestDatabase,
} from "../../packages/db/src/testkit/postgres.js";
import {
  seedLifecycleFixture,
  type LifecycleFixture,
} from "./lifecycle-scheduler.fixture.js";

describe("lifecycle scheduler expired lease recovery", () => {
  let database: TestDatabase;
  let fixture: LifecycleFixture;

  beforeAll(async () => {
    database = await startTestPostgres();
    await database.migrate();
    fixture = await seedLifecycleFixture(database);
    await fixture.repository.scheduleReservationLifecycle(
      fixture.reservationId,
    );
  }, 120_000);

  afterAll(async () => database.stop(), 120_000);

  it("reclaims an expired lease and rejects its stale fencing token", async () => {
    const now = new Date(fixture.databaseNow.getTime() + 25 * 60 * 60 * 1_000);
    const staleToken = randomUUID();
    const leased = await database.db.execute<{ id: string }>(sql`
      update lifecycle_jobs
      set status='processing',lease_token=${staleToken}::uuid,
        lease_until=${new Date(now.getTime() - 60_000)},attempt_count=1
      where id=(
        select id from lifecycle_jobs
        where subject_id=${fixture.reservationId}::uuid
          and job_type='booking_reminder_48h'
      )
      returning id
    `);
    const jobId = leased.rows[0]!.id;

    await expect(
      fixture.repository.processDueLifecycleBatch({ now, batchSize: 10 }),
    ).resolves.toEqual({ examined: 1, materialized: 1, cancelled: 0 });

    const stale = await database.db.execute(sql`
      update lifecycle_jobs
      set status='succeeded',lease_token=null,lease_until=null
      where id=${jobId}::uuid and status='processing'
        and lease_token=${staleToken}::uuid
    `);
    expect(stale.rowCount).toBe(0);

    await expect(
      fixture.repository.processDueLifecycleBatch({ now, batchSize: 10 }),
    ).resolves.toEqual({ examined: 0, materialized: 0, cancelled: 0 });
    const counts = await database.db.execute<{
      outbox: string;
      deliveries: string;
    }>(sql`
      select
        (select count(*)::text from integration_outbox
          where correlation_id=${`lifecycle:${jobId}`}) outbox,
        (select count(*)::text from dialogue_deliveries
          where source='deterministic' and source_id=${jobId}) deliveries
    `);
    expect(counts.rows[0]).toEqual({ outbox: "1", deliveries: "1" });
  });
});
