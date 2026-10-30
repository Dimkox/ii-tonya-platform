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
  await fixture.db.execute(
    sql`create table wave_configuration(id integer primary key check(id=1),version text not null)`,
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
it("cancels only unsent stale generations under locked current config, preserving dispatched uncertainty", async () => {
  const first = await fixture.createUser();
  const second = await fixture.createUser();
  const third = await fixture.createUser();
  await fixture.db.execute(
    sql`insert into wave_configuration values(1,'wave-v2')`,
  );
  await fixture.db.execute(
    sql`alter table early_bird_final_call_queue disable trigger early_bird_final_call_admission`,
  );
  const add = (id: string) =>
    fixture.db.execute(
      sql`with t as (select clock_timestamp() as now) insert into early_bird_final_call_queue(user_id,kind,config_version,trigger_at,client_start_at,scheduled_at,available_at) select ${id}::uuid,'first','wave-v1',now-interval '1 day',now+interval '1 day',now-interval '1 day',now-interval '1 day' from t`,
    );
  await add(first);
  const bare = new PostgresFinalCallQueue(fixture.db);
  const preparing = (await bare.claim())!;
  await add(second);
  const dispatched = (await bare.claim())!;
  expect(
    await new PostgresFinalCallQueue(
      fixture.db,
      syntheticFinalCallConfig,
    ).dispatch(dispatched),
  ).toBe(true);
  await add(third);
  expect(await bare.cancelStaleConfiguration(10)).toBe(0);
  const queue = new PostgresFinalCallQueue(fixture.db, {
    lockCurrentState: async () => null,
    lockCurrent: async (tx) => {
      const row = await tx.execute<{ version: string }>(
        sql`select version from wave_configuration where id=1 for share`,
      );
      return row.rows[0]?.version ?? null;
    },
  });
  expect(await queue.cancelStaleConfiguration(10)).toBe(2);
  expect(await queue.dispatch(preparing)).toBe(false);
  const rows = await fixture.db.execute<{ user_id: string; status: string }>(
    sql`select user_id::text,status from early_bird_final_call_queue order by user_id`,
  );
  expect(rows.rows.find((r) => r.user_id === first)?.status).toBe("cancelled");
  expect(rows.rows.find((r) => r.user_id === second)?.status).toBe(
    "dispatched",
  );
  expect(rows.rows.find((r) => r.user_id === third)?.status).toBe("cancelled");
  await fixture.db.execute(
    sql`with t as (select clock_timestamp() as now) insert into early_bird_final_call_queue(user_id,kind,config_version,trigger_at,client_start_at,scheduled_at,available_at) select ${first}::uuid,'first','wave-v2',now-interval '1 day',now+interval '1 day',now-interval '1 day',now-interval '1 day' from t`,
  );
  await fixture.db.execute(
    sql`alter table early_bird_final_call_queue enable trigger early_bird_final_call_admission`,
  );
}, 120_000);
