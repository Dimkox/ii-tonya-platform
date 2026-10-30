import { afterAll, beforeAll, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { sql } from "drizzle-orm";
import { startTestPostgres, type TestDatabase } from "../testkit/postgres.js";
import {
  PostgresFinalCallQueue,
  type FinalCallConfigAuthority,
} from "./early-bird-final-call-queue.js";
let fixture: TestDatabase;
beforeAll(async () => {
  fixture = await startTestPostgres();
  await fixture.db.execute(
    sql`create function early_bird_current_time() returns timestamptz language sql volatile as $$ select clock_timestamp() $$`,
  );
  await fixture.db.execute(
    sql`create table users(id uuid primary key default gen_random_uuid(),active boolean not null default true)`,
  );
  await fixture.db.execute(
    sql`create table expert_sales_erased_cohorts(user_id uuid primary key)`,
  );
  const source = await readFile(
    "docs/superpowers/implementation-artifacts/drafts/0077_early_bird_final_call.sql",
    "utf8",
  );
  for (const statement of source.split("--> statement-breakpoint"))
    if (statement.trim()) await fixture.db.execute(sql.raw(statement));
  await fixture.db.execute(
    sql`alter table early_bird_final_call_queue disable trigger early_bird_final_call_admission`,
  );
}, 120_000);
afterAll(async () => {
  await fixture?.stop();
}, 120_000);
it("allows a corrected same-generation notice only after the unsent invalid one is cancelled", async () => {
  const user = await fixture.createUser();
  await fixture.db.execute(
    sql`with t as (select date_trunc('milliseconds',clock_timestamp()) now) insert into early_bird_final_call_queue(user_id,kind,config_version,trigger_at,client_start_at,scheduled_at,available_at) select ${user}::uuid,'first','v1',now-interval '1 day',now+interval '1 day',now-interval '1 day',now-interval '1 day' from t`,
  );
  const claim = (await new PostgresFinalCallQueue(fixture.db).claim())!;
  const times = await fixture.db.execute<{ trigger: string; start: string }>(
    sql`select floor(extract(epoch from trigger_at)*1000)::bigint::text trigger,floor(extract(epoch from client_start_at)*1000)::bigint::text start from early_bird_final_call_queue where id=${claim.noticeId}::uuid`,
  );
  const authority: FinalCallConfigAuthority = {
    lockCurrent: async () => "v1",
    lockCurrentState: async () => ({
      version: "v1",
      phase: "WAVE_1_EARLY_BIRD",
      triggerAtMs: Number(times.rows[0]!.trigger) + 1,
      clientStartAtMs: Number(times.rows[0]!.start),
    }),
  };
  expect(
    await new PostgresFinalCallQueue(fixture.db, authority).dispatch(claim),
  ).toBe(false);
  const replacement = await fixture.db.execute(
    sql`insert into early_bird_final_call_queue(user_id,kind,config_version,trigger_at,client_start_at,scheduled_at,available_at) select user_id,kind,config_version,trigger_at+interval '1 millisecond',client_start_at,scheduled_at+interval '1 millisecond',available_at+interval '1 millisecond' from early_bird_final_call_queue where id=${claim.noticeId}::uuid returning id`,
  );
  expect(replacement.rows).toHaveLength(1);
  const rows = await fixture.db.execute<{ status: string }>(
    sql`select status from early_bird_final_call_queue where user_id=${user}::uuid order by created_at`,
  );
  expect(rows.rows.map((x) => x.status)).toEqual(["cancelled", "pending"]);
}, 120_000);
