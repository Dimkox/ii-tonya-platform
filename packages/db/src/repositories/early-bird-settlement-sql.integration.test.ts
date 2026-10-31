import { readFileSync, existsSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { startTestPostgres, type TestDatabase } from "../testkit/postgres.js";

let fixture: TestDatabase;
const draft =
  "docs/superpowers/implementation-artifacts/drafts/0082_early_bird_settlement.sql";
beforeAll(async () => {
  fixture = await startTestPostgres();
  await fixture.db.execute(sql`create table users(id uuid primary key)`);
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
  if (existsSync(draft))
    await fixture.db.execute(sql.raw(readFileSync(draft, "utf8")));
}, 120_000);
afterAll(async () => {
  await fixture?.stop();
}, 120_000);

it("records one future subscription interval from a verified exact composite payment", async () => {
  const user = randomUUID(),
    intent = randomUUID(),
    invoice = randomUUID();
  await fixture.db.execute(sql`insert into users values(${user}::uuid)`);
  await fixture.db.execute(
    sql`insert into early_bird_composite_intents values(${intent}::uuid,${invoice}::uuid,${user}::uuid,'live','owner_test_10_20_v1','fixed_test',1000,2000,3000,'2026-01-01Z','2026-01-11Z','2027-01-11T00:00:00+03:00','unknown')`,
  );
  await fixture.db.execute(
    sql`insert into early_bird_verified_bindings values(${intent}::uuid,${user}::uuid,'pay-1')`,
  );
  const settle = () =>
    fixture.db.execute(
      sql`select early_bird_record_success(${intent}::uuid,${user}::uuid,'pay-1',${`sha256:${"a".repeat(64)}`},'2026-01-02T00:00:00Z'::timestamptz)`,
    );
  await expect(settle()).resolves.toBeDefined();
  await expect(settle()).resolves.toBeDefined();
  const result = await fixture.db.execute<{
    count: string;
    starts: string;
    ends: string;
    disposition: string;
  }>(
    sql`select count(*)::text as count,min(starts_at)::text as starts,min(ends_at)::text as ends,min(disposition) as disposition from early_bird_payment_successes`,
  );
  expect(result.rows[0]?.count).toBe("1");
  expect(result.rows[0]?.disposition).toBe("eligible");
  expect(new Date(result.rows[0]!.starts).toISOString()).toBe(
    "2027-01-10T21:00:00.000Z",
  );
  expect(new Date(result.rows[0]!.ends).toISOString()).toBe(
    "2027-02-09T21:00:00.000Z",
  );
}, 120_000);

it("fails closed for an unbound provider and conflicting replay; late discount is reconciliation only", async () => {
  const user = randomUUID(),
    intent = randomUUID(),
    invoice = randomUUID();
  await fixture.db.execute(sql`insert into users values(${user}::uuid)`);
  await fixture.db.execute(
    sql`insert into early_bird_composite_intents values(${intent}::uuid,${invoice}::uuid,${user}::uuid,'live','wave1_standard_v1','discounted',300000,600000,900000,'2026-01-01Z','2026-01-11Z','2027-01-11T00:00:00+03:00','unknown')`,
  );
  await fixture.db.execute(
    sql`insert into early_bird_verified_bindings values(${intent}::uuid,${user}::uuid,'pay-2')`,
  );
  const evidence = `sha256:${"b".repeat(64)}`;
  await expect(
    fixture.db.execute(
      sql`select early_bird_record_success(${intent}::uuid,${user}::uuid,'other',${evidence},'2026-01-11T00:00:00Z'::timestamptz)`,
    ),
  ).rejects.toThrow();
  await fixture.db.execute(
    sql`select early_bird_record_success(${intent}::uuid,${user}::uuid,'pay-2',${evidence},'2026-01-11T00:00:00Z'::timestamptz)`,
  );
  const result = await fixture.db.execute<{
    disposition: string;
    starts: string | null;
  }>(
    sql`select disposition,starts_at as starts from early_bird_payment_successes where intent_id=${intent}::uuid`,
  );
  expect(result.rows[0]).toEqual({ disposition: "reconcile", starts: null });
  await expect(
    fixture.db.execute(
      sql`select early_bird_record_success(${intent}::uuid,${user}::uuid,'pay-2',${`sha256:${"c".repeat(64)}`},'2026-01-11T00:00:00Z'::timestamptz)`,
    ),
  ).rejects.toThrow();
  const privilege = await fixture.db.execute<{ allowed: boolean }>(
    sql`select has_function_privilege('public','early_bird_record_success(uuid,uuid,text,text,timestamptz)','execute') as allowed`,
  );
  expect(privilege.rows[0]?.allowed).toBe(false);
}, 120_000);
