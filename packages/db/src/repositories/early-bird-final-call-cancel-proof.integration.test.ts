import { afterAll, beforeAll, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { sql } from "drizzle-orm";
import { startTestPostgres, type TestDatabase } from "../testkit/postgres.js";
import { syntheticFinalCallConfig } from "../testkit/early-bird-queue-synthetic-config.js";
import { PostgresFinalCallQueue } from "./early-bird-final-call-queue.js";
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
it("never reopens a dispatched item without proof that no send started", async () => {
  const user = await fixture.createUser();
  const add = () =>
    fixture.db.execute(
      sql`with t as (select clock_timestamp() now) insert into early_bird_final_call_queue(user_id,kind,config_version,trigger_at,client_start_at,scheduled_at,available_at) select ${user}::uuid,'first','v1',now-interval '1 day',now+interval '1 day',now-interval '1 day',now-interval '1 day' from t`,
    );
  await add();
  const queue = new PostgresFinalCallQueue(
      fixture.db,
      syntheticFinalCallConfig,
    ),
    claim = (await queue.claim())!;
  expect(await queue.dispatch(claim)).toBe(true);
  expect(await queue.finish(claim, { kind: "cancelled" })).toBe(false);
  await expect(
    fixture.db.execute(
      sql`update early_bird_final_call_queue set status='cancelled' where id=${claim.noticeId}::uuid`,
    ),
  ).rejects.toThrow();
  expect(await queue.finish(claim, { kind: "uncertain" })).toBe(true);
  await expect(add()).rejects.toThrow();
}, 120_000);
