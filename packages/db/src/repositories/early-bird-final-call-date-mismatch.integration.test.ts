import { afterAll, beforeAll, expect, it } from "vitest";
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
    sql`create table early_bird_final_call_queue(id uuid primary key default gen_random_uuid(),user_id uuid not null references users(id),kind text not null,config_version text not null,status text not null default 'pending',attempt_id uuid,prepared_until timestamptz,message_id text,delivered_at timestamptz,available_at timestamptz not null default clock_timestamp(),created_at timestamptz not null default clock_timestamp(),trigger_at timestamptz not null,client_start_at timestamptz not null)`,
  );
}, 120_000);
afterAll(async () => {
  await fixture?.stop();
}, 120_000);
it("cancels an unsent notice whose saved dates disagree with its current config generation", async () => {
  const user = await fixture.createUser();
  await fixture.db.execute(
    sql`insert into early_bird_final_call_queue(user_id,kind,config_version,trigger_at,client_start_at) values(${user}::uuid,'first','v1',date_trunc('milliseconds',clock_timestamp())-interval '1 day',date_trunc('milliseconds',clock_timestamp())+interval '1 day')`,
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
  const row = await fixture.db.execute<{ status: string }>(
    sql`select status from early_bird_final_call_queue where id=${claim.noticeId}::uuid`,
  );
  expect(row.rows[0]?.status).toBe("cancelled");
}, 120_000);
