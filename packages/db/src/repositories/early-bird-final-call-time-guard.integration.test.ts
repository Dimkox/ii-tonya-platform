import { afterAll, beforeAll, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { startTestPostgres, type TestDatabase } from "../testkit/postgres.js";
import { PostgresFinalCallQueue } from "./early-bird-final-call-queue.js";
import { syntheticFinalCallConfig } from "../testkit/early-bird-queue-synthetic-config.js";
let fixture: TestDatabase;
beforeAll(async () => {
  fixture = await startTestPostgres();
  await fixture.db.execute(sql`create function early_bird_current_time() returns timestamptz language sql volatile as $$ select clock_timestamp() $$`);
  await fixture.db.execute(
    sql`create table users(id uuid primary key default gen_random_uuid(), active boolean not null default true)`,
  );
  await fixture.db.execute(
    sql`create table early_bird_final_call_queue(id uuid primary key default gen_random_uuid(), user_id uuid not null references users(id), config_version text not null default 'wave-v1', kind text not null, status text not null default 'pending', attempt_id uuid, prepared_until timestamptz, message_id text, delivered_at timestamptz, available_at timestamptz not null default clock_timestamp(), created_at timestamptz not null default clock_timestamp(), trigger_at timestamptz not null, client_start_at timestamptz not null, unique(user_id,kind))`,
  );
}, 120_000);
afterAll(async () => {
  await fixture?.stop();
}, 120_000);
it("does not claim before configured trigger, or dispatch after configured launch", async () => {
  const user = await fixture.createUser();
  await fixture.db.execute(
    sql`insert into early_bird_final_call_queue(user_id,kind,trigger_at,client_start_at) values(${user}::uuid,'first',clock_timestamp()+interval '1 day',clock_timestamp()+interval '10 days')`,
  );
  const queue = new PostgresFinalCallQueue(
    fixture.db,
    syntheticFinalCallConfig,
  );
  expect(await queue.claim()).toBeNull();
  await fixture.db.execute(
    sql`update early_bird_final_call_queue set trigger_at=clock_timestamp()-interval '1 second' where user_id=${user}::uuid`,
  );
  const claim = await queue.claim();
  expect(claim?.userId).toBe(user);
  await fixture.db.execute(
    sql`update early_bird_final_call_queue set client_start_at=clock_timestamp()-interval '1 second' where user_id=${user}::uuid`,
  );
  expect(await queue.dispatch(claim!)).toBe(false);
  expect(await queue.claim()).toBeNull();
}, 120_000);
