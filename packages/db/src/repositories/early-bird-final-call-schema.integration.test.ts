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
it("fails closed for enqueue, enforces actual queue transitions and erases user rows", async () => {
  const user = await fixture.createUser();
  const insert = () =>
    fixture.db.execute<{ id: string }>(
      sql`with timestamp_fixture as (select clock_timestamp() as now) insert into early_bird_final_call_queue(user_id,kind,config_version,trigger_at,client_start_at,scheduled_at,available_at) select ${user}::uuid,'first','wave-v1',now-interval '1 day',now+interval '5 days',now-interval '1 day',now-interval '1 day' from timestamp_fixture returning id`,
    );
  await expect(insert()).rejects.toThrow();
  // Seed a single isolated queue fixture; re-enable the gate before exercising transitions.
  await fixture.db.execute(
    sql`alter table early_bird_final_call_queue disable trigger early_bird_final_call_admission`,
  );
  const inserted = await insert();
  await fixture.db.execute(
    sql`alter table early_bird_final_call_queue enable trigger early_bird_final_call_admission`,
  );
  const queue = new PostgresFinalCallQueue(
    fixture.db,
    syntheticFinalCallConfig,
  );
  const claim = (await queue.claim())!;
  expect(claim.noticeId).toBe(inserted.rows[0]!.id);
  expect(await queue.dispatch(claim)).toBe(true);
  expect(
    await queue.finish(claim, { kind: "delivered", messageId: "101" }),
  ).toBe(true);
  await expect(
    fixture.db.execute(
      sql`update early_bird_final_call_queue set status='pending',attempt_id=null,message_id=null,delivered_at=null where id=${claim.noticeId}::uuid`,
    ),
  ).rejects.toThrow();
  // The following seed is isolated to test database constraints, then the admission gate is restored.
  await fixture.db.execute(
    sql`alter table early_bird_final_call_queue disable trigger early_bird_final_call_admission`,
  );
  const duplicate = fixture.db.execute(
    sql`insert into early_bird_final_call_queue(user_id,kind,config_version,trigger_at,client_start_at,scheduled_at,available_at) select user_id,'first','wave-v2',trigger_at,client_start_at,scheduled_at,available_at from early_bird_final_call_queue where id=${claim.noticeId}::uuid`,
  );
  await expect(duplicate).rejects.toThrow();
  const earlyRepeat = fixture.db.execute(
    sql`insert into early_bird_final_call_queue(user_id,kind,config_version,trigger_at,client_start_at,scheduled_at,available_at) select user_id,'repeat','wave-v1',trigger_at,client_start_at,trigger_at+interval '3 days',trigger_at+interval '3 days' from early_bird_final_call_queue where id=${claim.noticeId}::uuid`,
  );
  await expect(earlyRepeat).rejects.toThrow();
  await fixture.db.execute(
    sql`insert into early_bird_final_call_queue(user_id,kind,config_version,trigger_at,client_start_at,scheduled_at,available_at) select user_id,'repeat','wave-v1',trigger_at,client_start_at,trigger_at+interval '5 days',trigger_at+interval '5 days' from early_bird_final_call_queue where id=${claim.noticeId}::uuid`,
  );
  const other = await fixture.createUser();
  const oldRow = await fixture.db.execute<{ id: string }>(
    sql`with t as (select clock_timestamp() as now) insert into early_bird_final_call_queue(user_id,kind,config_version,trigger_at,client_start_at,scheduled_at,available_at) select ${other}::uuid,'first','wave-v1',now-interval '1 day',now+interval '5 days',now-interval '1 day',now-interval '1 day' from t returning id`,
  );
  await fixture.db.execute(
    sql`update early_bird_final_call_queue set status='cancelled' where id=${oldRow.rows[0]!.id}::uuid`,
  );
  await fixture.db.execute(
    sql`insert into early_bird_final_call_queue(user_id,kind,config_version,trigger_at,client_start_at,scheduled_at,available_at) select user_id,kind,'wave-v2',trigger_at,client_start_at,scheduled_at,available_at from early_bird_final_call_queue where id=${oldRow.rows[0]!.id}::uuid`,
  );
  await fixture.db.execute(
    sql`alter table early_bird_final_call_queue enable trigger early_bird_final_call_admission`,
  );
  await fixture.db.execute(
    sql`insert into expert_sales_erased_cohorts(user_id) values(${user}::uuid)`,
  );
  const left = await fixture.db.execute(
    sql`select id from early_bird_final_call_queue where user_id=${user}::uuid`,
  );
  expect(left.rows).toHaveLength(0);
}, 120_000);
