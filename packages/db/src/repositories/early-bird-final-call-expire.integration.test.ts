import { afterAll, beforeAll, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { sql } from "drizzle-orm";
import { startTestPostgres, type TestDatabase } from "../testkit/postgres.js";
import { PostgresFinalCallQueue } from "./early-bird-final-call-queue.js";
import { syntheticFinalCallConfig } from "../testkit/early-bird-queue-synthetic-config.js";
let fixture: TestDatabase;
beforeAll(async () => {
  fixture = await startTestPostgres();
  await fixture.db.execute(sql`create function early_bird_current_time() returns timestamptz language sql volatile as $$ select clock_timestamp() $$`);
  await fixture.db.execute(
    sql`create table users(id uuid primary key default gen_random_uuid(),active boolean not null default true)`,
  );
  await fixture.db.execute(
    sql`create table expert_sales_erased_cohorts(user_id uuid primary key)`,
  );
  const schema = await readFile(
    "docs/superpowers/implementation-artifacts/drafts/0077_early_bird_final_call.sql",
    "utf8",
  );
  for (const statement of schema.split("--> statement-breakpoint"))
    if (statement.trim()) await fixture.db.execute(sql.raw(statement));
}, 120_000);
afterAll(async () => {
  await fixture?.stop();
}, 120_000);
it("expires unsent preparations after launch but never retries a dispatched notice", async () => {
  const first = await fixture.createUser();
  const second = await fixture.createUser();
  // Fixture seeding only: the production INSERT gate remains closed. Both rows
  // model lease/time passage, not an authorised production enqueue.
  await fixture.db.execute(
    sql`alter table early_bird_final_call_queue disable trigger early_bird_final_call_admission`,
  );
  await fixture.db.execute(
    sql`with t as (select clock_timestamp() as now) insert into early_bird_final_call_queue(user_id,kind,config_version,trigger_at,client_start_at,scheduled_at,available_at) select ${first}::uuid,'first','wave-v1',now-interval '1 day',now+interval '1 day',now-interval '1 day',now-interval '1 day' from t`,
  );
  const queue = new PostgresFinalCallQueue(
    fixture.db,
    syntheticFinalCallConfig,
  );
  const old = (await queue.claim())!;
  await fixture.db.execute(
    sql`with t as (select clock_timestamp() as now) insert into early_bird_final_call_queue(user_id,kind,config_version,trigger_at,client_start_at,scheduled_at,available_at) select ${second}::uuid,'first','wave-v1',now-interval '1 day',now+interval '1 day',now-interval '1 day',now-interval '1 day' from t`,
  );
  const sent = (await queue.claim())!;
  expect(await queue.dispatch(sent)).toBe(true);
  await fixture.db.execute(
    sql`alter table early_bird_final_call_queue disable trigger early_bird_final_call_guard`,
  );
  await fixture.db.execute(
    sql`with t as (select clock_timestamp() as now) update early_bird_final_call_queue set trigger_at=t.now-interval '2 days', scheduled_at=t.now-interval '2 days', available_at=t.now-interval '2 days',client_start_at=t.now-interval '1 second',prepared_until=case when status='preparing' then t.now-interval '1 second' else null end from t where user_id in (${first}::uuid,${second}::uuid)`,
  );
  await fixture.db.execute(
    sql`alter table early_bird_final_call_queue enable trigger early_bird_final_call_guard`,
  );
  expect(await queue.expireAfterLaunch(10)).toBe(1);
  const rows = await fixture.db.execute<{ status: string }>(
    sql`select status from early_bird_final_call_queue where id=${old.noticeId}::uuid`,
  );
  expect(rows.rows[0]?.status).toBe("cancelled");
  const dispatched = await fixture.db.execute<{ status: string }>(
    sql`select status from early_bird_final_call_queue where id=${sent.noticeId}::uuid`,
  );
  expect(dispatched.rows[0]?.status).toBe("dispatched");
  await fixture.db.execute(
    sql`with t as (select clock_timestamp() as now) insert into early_bird_final_call_queue(user_id,kind,config_version,trigger_at,client_start_at,scheduled_at,available_at) select ${first}::uuid,'first','wave-v2',now-interval '1 day',now+interval '1 day',now-interval '1 day',now-interval '1 day' from t`,
  );
  await fixture.db.execute(
    sql`alter table early_bird_final_call_queue enable trigger early_bird_final_call_admission`,
  );
}, 120_000);
