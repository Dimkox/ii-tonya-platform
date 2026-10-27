import { afterAll, beforeAll, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import {
  startTestPostgres,
  type TestDatabase,
} from "../../packages/db/src/testkit/postgres.js";
import { PostgresCatalogRepository } from "../../packages/db/src/repositories/catalog-repository.js";
import { admitExternalSlot } from "../../packages/db/src/repositories/external-slot-admission.js";
import { seedLifecycleFixture } from "./lifecycle-scheduler.fixture.js";
let database: TestDatabase;
beforeAll(async () => {
  database = await startTestPostgres();
  await database.migrate();
}, 120000);
afterAll(async () => database.stop());
it("catalog filters invalid rows before the limit and retains fresh valid external choices", async () => {
  const f = await seedLifecycleFixture(database);
  const service = (
    await database.db.execute<{ id: string }>(
      sql`select expert_service_id id from slots where id=${f.slotId}::uuid`,
    )
  ).rows[0]!.id;
  await database.db
    .execute(sql`insert into slots(expert_service_id,provider,external_slot_id,starts_at,ends_at,observed_at,capacity)
   select ${service}::uuid,'local','stale-'||g,clock_timestamp()+interval '2 days',clock_timestamp()+interval '2 days 1 hour',clock_timestamp()-interval '16 minutes',1 from generate_series(1,501) g`);
  const valid = (
    await database.db.execute<{
      id: string;
    }>(sql`insert into slots(expert_service_id,provider,external_slot_id,starts_at,ends_at,observed_at,capacity)
   values(${service}::uuid,'local','valid',statement_timestamp()+interval '4 days',statement_timestamp()+interval '4 days 1 hour',clock_timestamp(),1) returning id`)
  ).rows[0]!.id;
  const read = () =>
    new PostgresCatalogRepository(database.db).read({
      sourceKey: service,
      databaseNow: new Date(),
    });
  expect(await read()).toMatchObject({
    kind: "complete",
    slots: [{ localSlotId: valid }],
  });
  await database.db.execute(
    sql`update slots set provider='planerka' where id=${valid}::uuid`,
  );
  expect(await read()).toMatchObject({ kind: "complete", slots: [] });
  await database.db
    .execute(sql`insert into planerka_service_mappings(expert_service_id,account_id,event_type_id,time_zone,duration_minutes,enabled,verified_at)
   values(${service}::uuid,991,992,'Europe/Moscow',60,true,clock_timestamp())`);
  // A mapping change invalidates prior provider observations. Republish a fresh
  // synthetic observation before expecting the slot to become discoverable.
  await database.db.execute(
    sql`update slots set observed_at=clock_timestamp() where id=${valid}::uuid`,
  );
  expect(await read()).toMatchObject({
    kind: "complete",
    slots: [{ localSlotId: valid }],
  });
  await database.db.execute(
    sql`update planerka_service_mappings set enabled=false where expert_service_id=${service}::uuid`,
  );
  expect(await read()).toMatchObject({ kind: "complete", slots: [] });
});
it("external admission rechecks freshness after the shared expert lock wait", async () => {
  const f = await seedLifecycleFixture(database),
    userId = await database.createUser();
  await database.db.execute(
    sql`update reservations set status='cancelled_by_client' where id=${f.reservationId}::uuid`,
  );
  const expert = (
    await database.db.execute<{ id: string }>(
      sql`select expert_id id from reservations where id=${f.reservationId}::uuid`,
    )
  ).rows[0]!.id;
  const blocker = await database.db.$client.connect();
  try {
    await blocker.query("begin");
    await blocker.query(
      "select pg_advisory_xact_lock(hashtextextended($1,0))",
      ["expert:" + expert],
    );
    await database.db.execute(
      sql`update slots set observed_at=clock_timestamp()-interval '15 minutes'+interval '100 milliseconds' where id=${f.slotId}::uuid`,
    );
    const admission = database.db.transaction((tx) =>
      admitExternalSlot(tx, { slotId: f.slotId, userId }),
    );
    await new Promise((resolve) => setTimeout(resolve, 180));
    await blocker.query("commit");
    expect(await admission).toBeUndefined();
  } finally {
    await blocker.query("rollback");
    blocker.release();
  }
});
