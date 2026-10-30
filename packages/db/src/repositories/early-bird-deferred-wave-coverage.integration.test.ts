import { readFileSync } from "node:fs";
import { afterAll, beforeAll, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { startTestPostgres, type TestDatabase } from "../testkit/postgres.js";

let db: TestDatabase;
beforeAll(async () => {
  db = await startTestPostgres();
  await db.db.execute(
    sql.raw(`
    create table early_bird_deferred_accounts(id uuid, user_id uuid, onboarding_minor bigint, subscription_minor bigint, launch_at timestamptz);
    create table early_bird_deferred_invoices(id uuid, account_id uuid, user_id uuid, stage text, amount_minor bigint, provider_id text, evidence_digest text, captured_at timestamptz);
    create table early_bird_deferred_verified_bindings(invoice_id uuid,user_id uuid,provider_id text,amount_minor bigint,evidence_digest text);
    create table early_bird_composite_intents(id uuid);
    create table early_bird_wave_one_exclusions(user_id uuid);
    create table early_bird_deferred_refund_facts(invoice_id uuid,user_id uuid);
    create table early_bird_deferred_refund_reconciliation(invoice_id uuid,user_id uuid);
    create table early_bird_deferred_verified_refund_bindings(invoice_id uuid,user_id uuid,provider_refund_id text default 'refund');
    create table early_bird_deferred_refund_resolutions(provider_refund_id text,invoice_id uuid,user_id uuid,disposition text);
  `),
  );
  const source = readFileSync(
    "docs/superpowers/implementation-artifacts/drafts/deferred_wave_publication.sql",
    "utf8",
  );
  await db.db.execute(sql.raw(source.split("-- Existing guard trigger")[0]!));
}, 120_000);
afterAll(async () => {
  await db?.stop();
}, 120_000);

it("requires both exact verified captures before launch and blocks exclusions and refund uncertainty", async () => {
  const user = crypto.randomUUID(),
    account = crypto.randomUUID(),
    onboarding = crypto.randomUUID(),
    subscription = crypto.randomUUID();
  await db.db.execute(
    sql`insert into early_bird_deferred_accounts values(${account}::uuid,${user}::uuid,1000,2000,'2027-01-10T21:00:00Z')`,
  );
  await db.db.execute(
    sql`insert into early_bird_deferred_invoices values(${onboarding}::uuid,${account}::uuid,${user}::uuid,'onboarding',1000,'ob','a','2027-01-01'),(${subscription}::uuid,${account}::uuid,${user}::uuid,'subscription',2000,'sub','b','2027-01-10')`,
  );
  const count = async () =>
    Number(
      (
        await db.db.execute<{ n: number }>(
          sql`select count(*)::int n from early_bird_deferred_effective_coverages`,
        )
      ).rows[0]!.n,
    );
  expect(await count()).toBe(0);
  await db.db.execute(
    sql`insert into early_bird_deferred_verified_bindings values(${onboarding}::uuid,${user}::uuid,'ob',1000,'a')`,
  );
  expect(
    Number(
      (
        await db.db.execute<{ n: number }>(
          sql`select count(*)::int n from early_bird_deferred_onboarded`,
        )
      ).rows[0]!.n,
    ),
  ).toBe(1);
  expect(await count()).toBe(0);
  await db.db.execute(sql`delete from early_bird_deferred_verified_bindings`);
  await db.db.execute(
    sql`insert into early_bird_deferred_verified_bindings values(${onboarding}::uuid,${user}::uuid,'ob',1000,'a'),(${subscription}::uuid,${user}::uuid,'sub',2000,'b')`,
  );
  expect(await count()).toBe(1);
  await db.db.execute(
    sql`update early_bird_deferred_invoices set captured_at='2027-01-10T21:00:00Z' where id=${subscription}::uuid`,
  );
  expect(await count()).toBe(0);
  await db.db.execute(
    sql`update early_bird_deferred_invoices set captured_at='2027-01-10' where id=${subscription}::uuid`,
  );
  await db.db.execute(
    sql`insert into early_bird_wave_one_exclusions values(${user}::uuid)`,
  );
  expect(await count()).toBe(0);
  await db.db.execute(sql`delete from early_bird_wave_one_exclusions`);
  for (const table of [
    "early_bird_deferred_refund_facts",
    "early_bird_deferred_refund_reconciliation",
    "early_bird_deferred_verified_refund_bindings",
  ]) {
    await db.db.execute(
      sql.raw(
        `insert into ${table} (invoice_id,user_id) values ('${subscription}','${user}')`,
      ),
    );
    expect(await count()).toBe(0);
    await db.db.execute(sql.raw(`delete from ${table}`));
  }
  expect(await count()).toBe(1);
  await db.db.execute(
    sql`insert into early_bird_deferred_verified_refund_bindings(invoice_id,user_id) values(${subscription}::uuid,${user}::uuid)`,
  );
  expect(await count()).toBe(0);
  await db.db.execute(
    sql`insert into early_bird_deferred_refund_resolutions values('refund',${subscription}::uuid,${user}::uuid,'canceled')`,
  );
  expect(await count()).toBe(1);
});
