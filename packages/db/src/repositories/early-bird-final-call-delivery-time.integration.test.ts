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
    sql`create table users (id uuid primary key default gen_random_uuid(), active boolean not null default true)`,
  );
  await fixture.db.execute(sql`create table early_bird_final_call_queue (
    id uuid primary key default gen_random_uuid(), user_id uuid not null references users(id) on delete cascade,
    config_version text not null default 'wave-v1', kind text not null, status text not null default 'pending', attempt_id uuid, prepared_until timestamptz,
    message_id text, delivered_at timestamptz, available_at timestamptz not null default clock_timestamp(), trigger_at timestamptz not null default (clock_timestamp()-interval '1 day'), client_start_at timestamptz not null default (clock_timestamp()+interval '1 day'), created_at timestamptz not null default clock_timestamp(), unique(user_id,kind)
  )`);
}, 120_000);
afterAll(async () => {
  await fixture?.stop();
}, 120_000);

it("records PostgreSQL delivery time only on confirmed delivery, for the 72 hour repeat", async () => {
  const first = await fixture.createUser();
  const second = await fixture.createUser();
  await fixture.db.execute(
    sql`insert into early_bird_final_call_queue(user_id,kind) values(${first}::uuid,'first')`,
  );
  const queue = new PostgresFinalCallQueue(
    fixture.db,
    syntheticFinalCallConfig,
  );
  const claim = (await queue.claim())!;
  await queue.dispatch(claim);
  await queue.finish(claim, { kind: "delivered", messageId: "101" });
  const delivered = await fixture.db.execute<{
    present: boolean;
    plausible: boolean;
  }>(
    sql`select delivered_at is not null present, delivered_at between created_at and clock_timestamp() plausible from early_bird_final_call_queue where id=${claim.noticeId}::uuid`,
  );
  expect(delivered.rows[0]).toEqual({ present: true, plausible: true });

  await fixture.db.execute(
    sql`insert into early_bird_final_call_queue(user_id,kind) values(${second}::uuid,'first')`,
  );
  const uncertain = (await queue.claim())!;
  await queue.dispatch(uncertain);
  await queue.finish(uncertain, { kind: "uncertain" });
  const secondRow = await fixture.db.execute<{ present: boolean }>(
    sql`select delivered_at is not null present from early_bird_final_call_queue where id=${uncertain.noticeId}::uuid`,
  );
  expect(secondRow.rows[0]?.present).toBe(false);
}, 120_000);
