import { afterAll, beforeAll, describe, expect, it } from "vitest";
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
    config_version text not null default 'wave-v1', kind text not null check(kind in ('first','repeat')),
    status text not null default 'pending' check(status in ('pending','preparing','dispatched','delivered','cancelled','uncertain')),
    attempt_id uuid, prepared_until timestamptz, message_id text, delivered_at timestamptz, available_at timestamptz not null default clock_timestamp(), trigger_at timestamptz not null default (clock_timestamp()-interval '1 day'), client_start_at timestamptz not null default (clock_timestamp()+interval '1 day'), created_at timestamptz not null default clock_timestamp(),
    unique(user_id,kind)
  )`);
}, 120000);
afterAll(async () => {
  await fixture?.stop();
}, 120000);

describe("durable final call queue", () => {
  it("claims one record at most once under concurrent workers", async () => {
    const userId = await fixture.createUser();
    await fixture.db.execute(
      sql`insert into early_bird_final_call_queue(user_id,kind) values(${userId}::uuid,'first')`,
    );
    const first = new PostgresFinalCallQueue(
      fixture.db,
      syntheticFinalCallConfig,
    );
    const claims = await Promise.all([first.claim(), first.claim()]);
    expect(claims.filter(Boolean)).toHaveLength(1);
    const claim = claims.find(Boolean)!;
    expect(claim.userId).toBe(userId);
    expect(await first.dispatch(claim)).toBe(true);
    expect(
      await first.finish(claim, { kind: "delivered", messageId: "101" }),
    ).toBe(true);
    expect(await first.claim()).toBeNull();
  });

  it("never retries a dispatched or uncertain send and rejects stale attempts", async () => {
    const userId = await fixture.createUser();
    await fixture.db.execute(
      sql`insert into early_bird_final_call_queue(user_id,kind) values(${userId}::uuid,'first')`,
    );
    const queue = new PostgresFinalCallQueue(
      fixture.db,
      syntheticFinalCallConfig,
    );
    const claim = (await queue.claim())!;
    expect(
      await queue.dispatch({
        ...claim,
        attemptId: "00000000-0000-4000-8000-000000000000",
      }),
    ).toBe(false);
    expect(await queue.dispatch(claim)).toBe(true);
    expect(await queue.finish(claim, { kind: "retry" })).toBe(false);
    expect(await queue.finish(claim, { kind: "uncertain" })).toBe(true);
    expect(await queue.claim()).toBeNull();
  });

  it("reclaims only expired preparation without a network dispatch", async () => {
    const userId = await fixture.createUser();
    await fixture.db.execute(
      sql`insert into early_bird_final_call_queue(user_id,kind) values(${userId}::uuid,'first')`,
    );
    const queue = new PostgresFinalCallQueue(
      fixture.db,
      syntheticFinalCallConfig,
    );
    const old = (await queue.claim())!;
    await fixture.db.execute(
      sql`update early_bird_final_call_queue set prepared_until=clock_timestamp()-interval '1 second' where id=${old.noticeId}::uuid`,
    );
    const next = (await queue.claim())!;
    expect(next.noticeId).toBe(old.noticeId);
    expect(next.attemptId).not.toBe(old.attemptId);
    expect(await queue.dispatch(old)).toBe(false);
    expect(await queue.finish(old, { kind: "cancelled" })).toBe(false);
    expect(await queue.finish(next, { kind: "retry" })).toBe(true);
    await fixture.db.execute(
      sql`update early_bird_final_call_queue set available_at=clock_timestamp()-interval '1 second' where id=${old.noticeId}::uuid`,
    );
    const retried = await queue.claim();
    expect(retried?.noticeId).toBe(old.noticeId);
    await queue.finish(retried!, { kind: "cancelled" });
  });
});
