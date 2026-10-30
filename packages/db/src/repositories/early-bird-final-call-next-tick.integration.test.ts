import { afterAll, beforeAll, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { startTestPostgres, type TestDatabase } from "../testkit/postgres.js";
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
    sql`create table early_bird_final_call_queue(id uuid primary key default gen_random_uuid(),user_id uuid not null references users(id),kind text not null,status text not null default 'pending',attempt_id uuid,prepared_until timestamptz,message_id text,delivered_at timestamptz,available_at timestamptz not null default clock_timestamp(),trigger_at timestamptz not null,client_start_at timestamptz not null,created_at timestamptz not null default clock_timestamp(),unique(user_id,kind))`,
  );
}, 120_000);
afterAll(async () => {
  await fixture?.stop();
}, 120_000);
it("schedules preparation retry for the next configured daily tick, never immediately", async () => {
  const user = await fixture.createUser();
  await fixture.db.execute(
    sql`insert into early_bird_final_call_queue(user_id,kind,trigger_at,client_start_at) values(${user}::uuid,'first',(date_trunc('day',clock_timestamp() at time zone 'UTC') at time zone 'UTC')+interval '7 hours'-interval '1 day',clock_timestamp()+interval '10 days')`,
  );
  const queue = new PostgresFinalCallQueue(fixture.db);
  const claim = (await queue.claim())!;
  expect(await queue.finish(claim, { kind: "retry" })).toBe(true);
  const due = await fixture.db.execute<{
    hour: number;
    future: boolean;
    bounded: boolean;
  }>(
    sql`select extract(hour from available_at at time zone 'UTC')::int as "hour",available_at>clock_timestamp() future,available_at<=clock_timestamp()+interval '1 day' bounded from early_bird_final_call_queue where user_id=${user}::uuid`,
  );
  expect(due.rows[0]).toEqual({ hour: 7, future: true, bounded: true });
  expect(await queue.claim()).toBeNull();
}, 120_000);
