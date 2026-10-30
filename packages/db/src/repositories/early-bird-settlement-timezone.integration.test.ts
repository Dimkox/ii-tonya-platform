import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { startTestPostgres, type TestDatabase } from "../testkit/postgres.js";
let fixture: TestDatabase;
beforeAll(async () => {
  fixture = await startTestPostgres();
  await fixture.db.execute(sql`create table users(id uuid primary key)`);
  await fixture.db.execute(
    sql`create table expert_sales_erased_cohorts(user_id uuid primary key)`,
  );
  await fixture.db.execute(
    sql`create table experts(id uuid primary key, user_id uuid not null)`,
  );
  await fixture.db.execute(
    sql`create table expert_residency_orders(expert_id uuid, status text, residency_ends_at timestamptz)`,
  );
  await fixture.db.execute(
    sql`create table early_bird_composite_intents(id uuid primary key, invoice_id uuid not null, user_id uuid not null, provider_mode text not null, pricing_policy text not null, price_kind text not null, onboarding_minor bigint not null, subscription_minor bigint not null, total_minor bigint not null, base_offer_shown_at timestamptz not null, expires_at timestamptz not null, launch_at timestamptz not null, status text not null, unique(id,user_id))`,
  );
  await fixture.db.execute(
    sql`create table early_bird_verified_bindings(intent_id uuid primary key, user_id uuid not null, provider_object_id text not null)`,
  );
  await fixture.db.execute(
    sql.raw(
      readFileSync(
        "docs/superpowers/implementation-artifacts/drafts/0082_early_bird_settlement.sql",
        "utf8",
      ),
    ),
  );
}, 120_000);
afterAll(async () => {
  await fixture?.stop();
}, 120_000);
it("keeps the prepaid period exactly 30 days across a database timezone transition", async () => {
  const user = randomUUID(),
    intent = randomUUID(),
    expert = randomUUID();
  await fixture.db.execute(sql`insert into users values(${user}::uuid)`);
  await fixture.db.execute(
    sql`insert into experts values(${expert}::uuid,${user}::uuid)`,
  );
  await fixture.db.execute(
    sql`insert into expert_residency_orders values(${expert}::uuid,'settled','2027-03-20T00:00:00Z')`,
  );
  await fixture.db.execute(
    sql`insert into early_bird_composite_intents values(${intent}::uuid,${randomUUID()}::uuid,${user}::uuid,'live','owner_test_10_20_v1','fixed_test',1000,2000,3000,'2026-01-01Z','2026-01-11Z','2027-01-11T00:00:00+03:00','unknown')`,
  );
  await fixture.db.execute(
    sql`insert into early_bird_verified_bindings values(${intent}::uuid,${user}::uuid,'tz-pay')`,
  );
  const result = await fixture.db.transaction(async (tx) => {
    await tx.execute(sql`set local timezone = 'Europe/Berlin'`);
    await tx.execute(
      sql`select early_bird_record_success(${intent}::uuid,${user}::uuid,'tz-pay',${`sha256:${"e".repeat(64)}`},'2026-01-02T00:00:00Z'::timestamptz)`,
    );
    return tx.execute<{ seconds: string }>(
      sql`select extract(epoch from (ends_at-starts_at))::text as seconds from early_bird_payment_successes where intent_id=${intent}::uuid`,
    );
  });
  expect(Number(result.rows[0]?.seconds)).toBe(2592000);
}, 120_000);
