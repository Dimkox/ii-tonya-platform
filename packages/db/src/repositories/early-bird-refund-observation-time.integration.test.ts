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
it("uses the database observation time and preserves it on idempotent replay", async () => {
  const user = randomUUID(),
    intent = randomUUID();
  await fixture.db.execute(sql`insert into users values(${user}::uuid)`);
  await fixture.db.execute(
    sql`insert into early_bird_composite_intents values(${intent}::uuid,${randomUUID()}::uuid,${user}::uuid,'live','wave1_standard_v1','full_price',300000,1000000,1300000,'2026-01-01Z','2026-01-11Z','2027-01-11T00:00:00+03:00','unknown')`,
  );
  await fixture.db.execute(
    sql`insert into early_bird_verified_bindings values(${intent}::uuid,${user}::uuid,'observed-pay')`,
  );
  await fixture.db.execute(
    sql`select early_bird_record_success(${intent}::uuid,${user}::uuid,'observed-pay',${`sha256:${"a".repeat(64)}`},'2026-01-12T00:00:00Z'::timestamptz)`,
  );
  const before = await fixture.db.execute<{ now: string }>(
    sql`select clock_timestamp() as now`,
  );
  const record = () =>
    fixture.db.execute(
      sql`select early_bird_record_full_refund(${intent}::uuid,${user}::uuid,'observed-refund',${`sha256:${"b".repeat(64)}`},1300000::bigint,'2026-01-13T00:00:00Z'::timestamptz)`,
    );
  await record();
  const first = await fixture.db.execute<{ occurred: string }>(
    sql`select occurred_at::text as occurred from early_bird_payment_full_refunds where intent_id=${intent}::uuid`,
  );
  expect(new Date(first.rows[0]!.occurred).getTime()).toBeGreaterThanOrEqual(
    new Date(before.rows[0]!.now).getTime(),
  );
  await record();
  const second = await fixture.db.execute<{ occurred: string }>(
    sql`select occurred_at::text as occurred from early_bird_payment_full_refunds where intent_id=${intent}::uuid`,
  );
  expect(second.rows[0]!.occurred).toBe(first.rows[0]!.occurred);
}, 120_000);
