import { afterAll, beforeAll, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { sql } from "drizzle-orm";
import { startTestPostgres, type TestDatabase } from "../testkit/postgres.js";
import { EarlyBirdLaunchConfigAuthority } from "./early-bird-launch-config.js";
import {
  PostgresFinalCallQueue,
  type QueueClaim,
} from "./early-bird-final-call-queue.js";
let fixture: TestDatabase;
beforeAll(async () => {
  fixture = await startTestPostgres();
  await fixture.migrate();
  // Isolated DB clock seam, already defined by migration 0077; no production clock changes.
  await fixture.db.execute(
    sql`create or replace function early_bird_current_time() returns timestamptz language sql volatile as $$ select '2026-12-29 10:00:00+03'::timestamptz $$`,
  );
  const draft = await readFile(
    "docs/superpowers/implementation-artifacts/drafts/0077_early_bird_final_call.sql",
    "utf8",
  );
  for (const statement of draft.split("--> statement-breakpoint"))
    if (statement.trim()) await fixture.db.execute(sql.raw(statement));
  await fixture.db.execute(
    sql`alter table early_bird_final_call_queue disable trigger early_bird_final_call_admission`,
  );
}, 120_000);
afterAll(async () => {
  await fixture?.stop();
}, 120_000);
async function selectWaveGeneration(): Promise<string> {
  return fixture.db.transaction(async (tx) => {
    const old = await tx.execute<{ id: string }>(
      sql`update early_bird_launch_configs set active=false where active returning id::text`,
    );
    const row = await tx.execute<{ id: string }>(
      sql`insert into early_bird_launch_configs(phase,enrollment_start_at,client_start_at,promo_deadline_days,final_call_trigger_at,active) select 'WAVE_1_EARLY_BIRD',enrollment_start_at,client_start_at,promo_deadline_days,final_call_trigger_at,true from early_bird_launch_configs where id=${old.rows[0]!.id}::uuid returning id::text`,
    );
    return row.rows[0]!.id;
  });
}
async function seedPrepared(configId: string): Promise<QueueClaim> {
  const userId = await fixture.createUser();
  await fixture.db.execute(
    sql`insert into early_bird_final_call_queue(user_id,kind,config_version,trigger_at,client_start_at,scheduled_at,available_at) select ${userId}::uuid,'first',id::text,final_call_trigger_at,client_start_at,final_call_trigger_at,final_call_trigger_at from early_bird_launch_configs where id=${configId}::uuid`,
  );
  const claim = await new PostgresFinalCallQueue(fixture.db).claim();
  if (!claim || claim.userId !== userId)
    throw new Error("fixture_claim_missing");
  return claim;
}
async function waitForLock(pid: number) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const result = await fixture.db.execute<{ waiting: boolean }>(
      sql`select wait_event_type='Lock' as waiting from pg_stat_activity where pid=${pid}`,
    );
    if (result.rows[0]?.waiting) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error("expected_postgres_lock_wait");
}
it("dispatch matching wave generation serializes before a concurrent config switch", async () => {
  const version = await selectWaveGeneration(),
    claim = await seedPrepared(version);
  const real = new EarlyBirdLaunchConfigAuthority();
  let release!: () => void;
  const gate = new Promise<void>((r) => {
    release = r;
  });
  let ready!: () => void;
  const locked = new Promise<void>((r) => {
    ready = r;
  });
  const queue = new PostgresFinalCallQueue(fixture.db, {
    lockCurrent: (tx) => real.lockCurrent(tx),
    lockCurrentState: async (tx) => {
      const state = await real.lockCurrentState(tx);
      ready();
      await gate;
      return state;
    },
  });
  const writer = await fixture.db.$client.connect();
  try {
    await writer.query("begin");
    const pid = (
      await writer.query<{ pid: number }>("select pg_backend_pid() pid")
    ).rows[0]!.pid;
    const dispatch = queue.dispatch(claim);
    await locked;
    const update = writer.query(
      "update early_bird_launch_configs set active=false where id=$1",
      [version],
    );
    await waitForLock(pid);
    release();
    expect(await dispatch).toBe(true);
    await update;
    await writer.query(
      "insert into early_bird_launch_configs(phase,enrollment_start_at,client_start_at,promo_deadline_days,final_call_trigger_at,active) select 'PUBLIC_LAUNCH',enrollment_start_at,client_start_at,promo_deadline_days,final_call_trigger_at,true from early_bird_launch_configs where id=$1",
      [version],
    );
    await writer.query("commit");
    const row = await fixture.db.execute<{ status: string }>(
      sql`select status from early_bird_final_call_queue where id=${claim.noticeId}::uuid`,
    );
    expect(row.rows[0]?.status).toBe("dispatched");
  } finally {
    release();
    await writer.query("rollback").catch(() => {});
    writer.release();
  }
}, 120_000);
it("a config switch committed before dispatch prevents sending against the prior wave", async () => {
  const version = await selectWaveGeneration(),
    claim = await seedPrepared(version);
  const writer = await fixture.db.$client.connect();
  let dispatchPid!: number;
  let ready!: (pid: number) => void;
  const started = new Promise<number>((r) => {
    ready = r;
  });
  const real = new EarlyBirdLaunchConfigAuthority();
  const queue = new PostgresFinalCallQueue(fixture.db, {
    lockCurrent: (tx) => real.lockCurrent(tx),
    lockCurrentState: async (tx) => {
      const p = await tx.execute<{ pid: number }>(
        sql`select pg_backend_pid() pid`,
      );
      dispatchPid = p.rows[0]!.pid;
      ready(dispatchPid);
      return real.lockCurrentState(tx);
    },
  });
  try {
    await writer.query("begin");
    await writer.query(
      "update early_bird_launch_configs set active=false where id=$1",
      [version],
    );
    await writer.query(
      "insert into early_bird_launch_configs(phase,enrollment_start_at,client_start_at,promo_deadline_days,final_call_trigger_at,active) select 'PUBLIC_LAUNCH',enrollment_start_at,client_start_at,promo_deadline_days,final_call_trigger_at,true from early_bird_launch_configs where id=$1",
      [version],
    );
    const dispatch = queue.dispatch(claim);
    await waitForLock(await started);
    await writer.query("commit");
    expect(await dispatch).toBe(false);
    const row = await fixture.db.execute<{ status: string }>(
      sql`select status from early_bird_final_call_queue where id=${claim.noticeId}::uuid`,
    );
    expect(row.rows[0]?.status).toBe("preparing");
  } finally {
    await writer.query("rollback").catch(() => {});
    writer.release();
  }
}, 120_000);
