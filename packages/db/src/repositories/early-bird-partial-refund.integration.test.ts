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
it("binds and reconciles partial refunds idempotently and rejects conflicting facts", async () => {
  const user = randomUUID(),
    intent = randomUUID(),
    op = randomUUID();
  await fixture.db.execute(sql`insert into users values(${user}::uuid)`);
  await fixture.db.execute(
    sql`insert into early_bird_composite_intents values(${intent}::uuid,${randomUUID()}::uuid,${user}::uuid,'live','wave1_standard_v1','full_price',300000,1000000,1300000,'2026-01-01Z','2026-01-11Z','2027-01-11T00:00:00+03:00','unknown')`,
  );
  await fixture.db.execute(
    sql`insert into early_bird_verified_bindings values(${intent}::uuid,${user}::uuid,'partial-pay')`,
  );
  const evidence = `sha256:${"b".repeat(64)}`;
  const record = () =>
    fixture.db.execute(
      sql`select early_bird_record_refund_reconciliation(${op}::uuid,${intent}::uuid,${user}::uuid,'partial-pay','partial-refund',100::bigint,${evidence})`,
    );
  await record();
  await record();
  const rows = await fixture.db.execute(
    sql`select * from early_bird_refund_reconciliation`,
  );
  expect(rows.rows).toHaveLength(1);
  await expect(
    fixture.db.execute(
      sql`select early_bird_record_refund_reconciliation(${op}::uuid,${intent}::uuid,${user}::uuid,'partial-pay','partial-refund',101::bigint,${evidence})`,
    ),
  ).rejects.toThrow();
  await expect(
    fixture.db.execute(
      sql`select early_bird_record_refund_reconciliation(${randomUUID()}::uuid,${intent}::uuid,${user}::uuid,'not-bound','partial-other',100::bigint,${evidence})`,
    ),
  ).rejects.toThrow();
  await expect(
    fixture.db.execute(
      sql`select early_bird_active_coverage_end(${user}::uuid)`,
    ),
  ).rejects.toThrow();
}, 120_000);
