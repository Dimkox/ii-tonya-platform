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
    sql`create table early_bird_composite_intents(id uuid primary key, invoice_id uuid not null, user_id uuid not null, grant_id uuid, provider_mode text not null, pricing_policy text not null, price_kind text not null, onboarding_minor bigint not null, subscription_minor bigint not null, total_minor bigint not null, base_offer_shown_at timestamptz not null, expires_at timestamptz not null, launch_at timestamptz not null, status text not null, unique(id,user_id))`,
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
  await fixture.db.execute(
    sql.raw(
      readFileSync(
        "docs/superpowers/implementation-artifacts/drafts/0083_early_bird_verified_settlement.sql",
        "utf8",
      ),
    ),
  );
}, 120_000);
afterAll(async () => {
  await fixture?.stop();
}, 120_000);
it("binds the full verified snapshot to its intent before recording the provider fact", async () => {
  const user = randomUUID(),
    intent = randomUUID(),
    invoice = randomUUID();
  await fixture.db.execute(sql`insert into users values(${user}::uuid)`);
  await fixture.db.execute(
    sql`insert into early_bird_composite_intents values(${intent}::uuid,${invoice}::uuid,${user}::uuid,null,'live','wave1_standard_v1','full_price',300000,1000000,1300000,'2026-01-01Z','2026-01-11Z','2027-01-11T00:00:00+03:00','unknown')`,
  );
  await fixture.db.execute(
    sql`insert into early_bird_verified_bindings values(${intent}::uuid,${user}::uuid,'settle-pay')`,
  );
  const snapshot = {
    invoiceId: invoice,
    userId: user,
    operationId: intent,
    providerObjectId: "settle-pay",
    pricingPolicy: "wave1_standard_v1",
    priceKind: "full_price",
    mode: "live",
    grantId: null,
    onboardingMinor: "300000",
    subscriptionMinor: "1000000",
    totalMinor: "1300000",
    baseOfferShownAt: "2026-01-01T00:00:00.000Z",
    expiresAt: "2026-01-11T00:00:00.000Z",
    launchAt: "2027-01-10T21:00:00.000Z",
  };
  const commit = (input: object) =>
    fixture.db.execute(
      sql`select early_bird_commit_verified_payment(${JSON.stringify(input)}::jsonb,${`sha256:${"d".repeat(64)}`},'2026-01-12T00:00:00Z'::timestamptz)`,
    );
  await expect(
    commit({ ...snapshot, invoiceId: randomUUID() }),
  ).rejects.toThrow();
  await expect(commit({ ...snapshot, totalMinor: "1" })).rejects.toThrow();
  await expect(
    commit({ ...snapshot, providerObjectId: "wrong" }),
  ).rejects.toThrow();
  await commit(snapshot);
  await commit(snapshot);
  const rows = await fixture.db.execute(
    sql`select * from early_bird_payment_successes where intent_id=${intent}::uuid`,
  );
  expect(rows.rows).toHaveLength(1);
}, 120_000);
