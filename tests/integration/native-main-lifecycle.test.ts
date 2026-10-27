import { afterAll, beforeAll, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import {
  startTestPostgres,
  type TestDatabase,
} from "../../packages/db/src/testkit/postgres.js";
import { seedLifecycleFixture } from "./lifecycle-scheduler.fixture.js";
let db: TestDatabase;
beforeAll(async () => {
  db = await startTestPostgres();
  await db.migrate();
}, 120000);
afterAll(async () => db.stop());
it("ordinary lifecycle batch discovers booked reservations and schedules reminders without a manual producer call", async () => {
  const f = await seedLifecycleFixture(db);
  expect(
    (
      await db.db.execute(
        sql`select id from lifecycle_jobs where subject_id=${f.reservationId}::uuid`,
      )
    ).rows,
  ).toHaveLength(0);
  await f.repository.runLifecycleBatch({ now: f.databaseNow, batchSize: 10 });
  expect(
    (
      await db.db.execute(
        sql`select id from lifecycle_jobs where subject_id=${f.reservationId}::uuid`,
      )
    ).rows,
  ).toHaveLength(3);
  await f.repository.runLifecycleBatch({ now: f.databaseNow, batchSize: 10 });
  expect(
    (
      await db.db.execute(
        sql`select id from lifecycle_jobs where subject_id=${f.reservationId}::uuid`,
      )
    ).rows,
  ).toHaveLength(3);
  const delivered = await f.repository.runLifecycleBatch({
    now: new Date(f.startsAt.getTime() - 47 * 3600000),
    batchSize: 10,
  });
  expect(delivered.materialized).toBe(1);
});
