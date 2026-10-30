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
it("serializes simultaneous partial refunds and caps their sum at the original payment", async () => {
  const user = randomUUID(),
    intent = randomUUID();
  await fixture.db.execute(sql`insert into users values(${user}::uuid)`);
  await fixture.db.execute(
    sql`insert into early_bird_composite_intents values(${intent}::uuid,${randomUUID()}::uuid,${user}::uuid,'live','wave1_standard_v1','full_price',300000,1000000,1300000,'2026-01-01Z','2026-01-11Z','2027-01-11T00:00:00+03:00','unknown')`,
  );
  await fixture.db.execute(
    sql`insert into early_bird_verified_bindings values(${intent}::uuid,${user}::uuid,'partial-race-pay')`,
  );
  const evidence = `sha256:${"b".repeat(64)}`;
  const calls = ["r1", "r2"].map((id) =>
    fixture.db.execute(
      sql`select early_bird_record_refund_reconciliation(${randomUUID()}::uuid,${intent}::uuid,${user}::uuid,'partial-race-pay',${id},800000::bigint,${evidence})`,
    ),
  );
  const outcomes = await Promise.allSettled(calls);
  expect(outcomes.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  expect(outcomes.filter((r) => r.status === "rejected")).toHaveLength(1);
  const rows = await fixture.db.execute<{ sum: string }>(
    sql`select sum(amount_minor)::text as sum from early_bird_refund_registry where intent_id=${intent}::uuid`,
  );
  expect(rows.rows[0]!.sum).toBe("800000");
  await expect(
    fixture.db.execute(
      sql`delete from early_bird_refund_reconciliation where intent_id=${intent}::uuid`,
    ),
  ).rejects.toThrow();
  await expect(
    fixture.db.execute(
      sql`delete from early_bird_refund_registry where intent_id=${intent}::uuid`,
    ),
  ).rejects.toThrow();
}, 120_000);
it("never records the same provider refund for two payment bindings", async () => {
  const evidence = `sha256:${"a".repeat(64)}`;
  const subjects = await Promise.all(
    ["x", "y"].map(async (suffix) => {
      const user = randomUUID(),
        intent = randomUUID(),
        payment = `cross-${suffix}`;
      await fixture.db.execute(sql`insert into users values(${user}::uuid)`);
      await fixture.db.execute(
        sql`insert into early_bird_composite_intents values(${intent}::uuid,${randomUUID()}::uuid,${user}::uuid,'live','wave1_standard_v1','full_price',300000,1000000,1300000,'2026-01-01Z','2026-01-11Z','2027-01-11T00:00:00+03:00','unknown')`,
      );
      await fixture.db.execute(
        sql`insert into early_bird_verified_bindings values(${intent}::uuid,${user}::uuid,${payment})`,
      );
      return { user, intent, payment };
    }),
  );
  const outcomes = await Promise.allSettled(
    subjects.map(({ user, intent, payment }) =>
      fixture.db.execute(
        sql`select early_bird_record_refund_reconciliation(${randomUUID()}::uuid,${intent}::uuid,${user}::uuid,${payment},'cross-refund',100::bigint,${evidence})`,
      ),
    ),
  );
  expect(outcomes.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  expect(outcomes.filter((r) => r.status === "rejected")).toHaveLength(1);
}, 120_000);
it("cannot settle a full refund and a partial refund for the same intent concurrently", async () => {
  const user = randomUUID(),
    intent = randomUUID(),
    evidence = `sha256:${"c".repeat(64)}`;
  await fixture.db.execute(sql`insert into users values(${user}::uuid)`);
  await fixture.db.execute(
    sql`insert into early_bird_composite_intents values(${intent}::uuid,${randomUUID()}::uuid,${user}::uuid,'live','wave1_standard_v1','full_price',300000,1000000,1300000,'2026-01-01Z','2026-01-11Z','2027-01-11T00:00:00+03:00','unknown')`,
  );
  await fixture.db.execute(
    sql`insert into early_bird_verified_bindings values(${intent}::uuid,${user}::uuid,'full-race-pay')`,
  );
  await fixture.db.execute(
    sql`select early_bird_record_success(${intent}::uuid,${user}::uuid,'full-race-pay',${evidence},'2026-01-12T00:00:00Z'::timestamptz)`,
  );
  const outcomes = await Promise.allSettled([
    fixture.db.execute(
      sql`select early_bird_record_refund_reconciliation(${randomUUID()}::uuid,${intent}::uuid,${user}::uuid,'full-race-pay','full-race-partial',100::bigint,${evidence})`,
    ),
    fixture.db.execute(
      sql`select early_bird_record_full_refund(${intent}::uuid,${user}::uuid,'full-race-full',${evidence},1300000::bigint,'2026-01-13T00:00:00Z'::timestamptz)`,
    ),
  ]);
  expect(outcomes.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  expect(outcomes.filter((r) => r.status === "rejected")).toHaveLength(1);
}, 120_000);
