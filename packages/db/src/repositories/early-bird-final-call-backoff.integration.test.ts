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
    sql`create table users (id uuid primary key default gen_random_uuid(), active boolean not null default true)`,
  );
  await fixture.db.execute(sql`create table early_bird_final_call_queue (
    id uuid primary key default gen_random_uuid(), user_id uuid not null references users(id) on delete cascade,
    kind text not null, status text not null default 'pending', attempt_id uuid, prepared_until timestamptz,
    message_id text, delivered_at timestamptz, available_at timestamptz not null default clock_timestamp(), trigger_at timestamptz not null default (clock_timestamp()-interval '1 day'), client_start_at timestamptz not null default (clock_timestamp()+interval '1 day'), created_at timestamptz not null default clock_timestamp(), unique(user_id,kind)
  )`);
}, 120_000);
afterAll(async () => {
  await fixture?.stop();
}, 120_000);

it("backs off preparation failures so other residents are not starved", async () => {
  const first = await fixture.createUser();
  const second = await fixture.createUser();
  await fixture.db.execute(
    sql`insert into early_bird_final_call_queue(user_id,kind,created_at) values(${first}::uuid,'first',clock_timestamp()-interval '1 second'),(${second}::uuid,'first',clock_timestamp())`,
  );
  const queue = new PostgresFinalCallQueue(fixture.db);
  const firstClaim = (await queue.claim())!;
  expect(firstClaim.userId).toBe(first);
  expect(await queue.finish(firstClaim, { kind: "retry" })).toBe(true);
  const secondClaim = (await queue.claim())!;
  expect(secondClaim.userId).toBe(second);
  expect(await queue.finish(secondClaim, { kind: "cancelled" })).toBe(true);
  expect(await queue.claim()).toBeNull();
  await fixture.db.execute(
    sql`update early_bird_final_call_queue set available_at=clock_timestamp()-interval '1 second' where user_id=${first}::uuid`,
  );
  const afterBackoff = await queue.claim();
  expect(afterBackoff?.userId).toBe(first);
  expect(await queue.finish(afterBackoff!, { kind: "cancelled" })).toBe(true);
}, 120_000);
