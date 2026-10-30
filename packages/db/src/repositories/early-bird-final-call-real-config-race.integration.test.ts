import { afterAll, beforeAll, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { sql } from "drizzle-orm";
import { startTestPostgres, type TestDatabase } from "../testkit/postgres.js";
import { EarlyBirdLaunchConfigAuthority } from "./early-bird-launch-config.js";
import { PostgresFinalCallQueue } from "./early-bird-final-call-queue.js";

let fixture: TestDatabase;
beforeAll(async () => {
  fixture = await startTestPostgres();
  await fixture.migrate();
  const schema = await readFile(
    "docs/superpowers/implementation-artifacts/drafts/0077_early_bird_final_call.sql",
    "utf8",
  );
  for (const statement of schema.split("--> statement-breakpoint"))
    if (statement.trim()) await fixture.db.execute(sql.raw(statement));
  // Only the isolated test fixture bypasses enqueue: real admission remains closed.
  await fixture.db.execute(
    sql`alter table early_bird_final_call_queue disable trigger early_bird_final_call_admission`,
  );
}, 120_000);
afterAll(async () => {
  await fixture?.stop();
}, 120_000);
async function addNotice(userId: string) {
  await fixture.db.execute(
    sql`with t as (select clock_timestamp() now) insert into early_bird_final_call_queue(user_id,kind,config_version,trigger_at,client_start_at,scheduled_at,available_at) select ${userId}::uuid,'first','old-config',now-interval '1 day',now+interval '1 day',now-interval '1 day',now-interval '1 day' from t`,
  );
}
async function waitForLock(pid: number) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const row = await fixture.db.execute<{ waiting: boolean }>(
      sql`select wait_event_type='Lock' as waiting from pg_stat_activity where pid=${pid}`,
    );
    if (row.rows[0]?.waiting) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error("expected_postgres_lock_wait");
}
it("serializes stale cancellation against a real config generation change", async () => {
  const user = await fixture.createUser();
  await addNotice(user);
  const config = await fixture.db.execute<{ id: string }>(
    sql`select id::text from early_bird_launch_configs where active`,
  );
  const activeId = config.rows[0]!.id;
  let release!: () => void;
  const gate = new Promise<void>((r) => {
    release = r;
  });
  let ready!: () => void;
  const locked = new Promise<void>((r) => {
    ready = r;
  });
  const authority = new EarlyBirdLaunchConfigAuthority();
  const queue = new PostgresFinalCallQueue(fixture.db, {
    lockCurrentState: async (tx) => authority.lockCurrentState(tx),
    lockCurrent: async (tx) => {
      const id = await authority.lockCurrent(tx);
      ready();
      await gate;
      return id;
    },
  });
  const writer = await fixture.db.$client.connect();
  try {
    await writer.query("begin");
    const pid = (
      await writer.query<{ pid: number }>("select pg_backend_pid() pid")
    ).rows[0]!.pid;
    const pendingCancel = queue.cancelStaleConfiguration(10);
    await locked;
    const pendingUpdate = writer.query(
      "update early_bird_launch_configs set active=false where id=$1",
      [activeId],
    );
    await waitForLock(pid);
    release();
    expect(await pendingCancel).toBe(1);
    await pendingUpdate;
    await writer.query(
      "insert into early_bird_launch_configs(phase,enrollment_start_at,client_start_at,promo_deadline_days,final_call_trigger_at,active) select phase,enrollment_start_at,client_start_at,promo_deadline_days,final_call_trigger_at,true from early_bird_launch_configs where id=$1",
      [activeId],
    );
    await writer.query("commit");
    const rows = await fixture.db.execute<{ status: string }>(
      sql`select status from early_bird_final_call_queue where user_id=${user}::uuid`,
    );
    expect(rows.rows[0]?.status).toBe("cancelled");
  } finally {
    release();
    await writer.query("rollback").catch(() => {});
    writer.release();
  }
}, 120_000);
it("claim and dispatch races with cancellation never reopen a dispatched notice", async () => {
  const config = new EarlyBirdLaunchConfigAuthority();
  const queue = new PostgresFinalCallQueue(fixture.db, config);
  const first = await fixture.createUser();
  await addNotice(first);
  const [claim, cancelled] = await Promise.all([
    queue.claim(),
    queue.cancelStaleConfiguration(10),
  ]);
  if (claim) expect(await queue.dispatch(claim)).toBe(false);
  if (cancelled === 0) await queue.cancelStaleConfiguration(10);
  const row = await fixture.db.execute<{ status: string }>(
    sql`select status from early_bird_final_call_queue where user_id=${first}::uuid`,
  );
  expect(row.rows[0]?.status).toBe("cancelled");
  const second = await fixture.createUser();
  await addNotice(second);
  const prepared = (await queue.claim())!;
  const [sent, revoked] = await Promise.all([
    queue.dispatch(prepared),
    queue.cancelStaleConfiguration(10),
  ]);
  expect(sent).toBe(false);
  if (revoked === 0) await queue.cancelStaleConfiguration(10);
  const finalState = await fixture.db.execute<{ status: string }>(
    sql`select status from early_bird_final_call_queue where user_id=${second}::uuid`,
  );
  expect(finalState.rows[0]?.status).toBe("cancelled");
}, 120_000);
