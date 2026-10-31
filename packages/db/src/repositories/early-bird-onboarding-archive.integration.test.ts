import { afterAll, beforeAll, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { startTestPostgres, type TestDatabase } from "../testkit/postgres.js";

let fixture: TestDatabase;
beforeAll(async () => {
  fixture = await startTestPostgres();
  await fixture.db.execute(
    sql.raw(`
    create table consent_document_versions (id uuid primary key);
    create table users (id uuid primary key default gen_random_uuid(), active boolean not null default true);
    create table expert_sales_bases (id uuid primary key default gen_random_uuid(), user_id uuid not null, base_tariff_amount bigint not null, consent_version text);
    create table early_bird_choices (id uuid primary key default gen_random_uuid(), base_id uuid not null, user_id uuid not null, decision_no int not null, choice text not null, chosen_at timestamptz not null);
    create table expert_onboarding_applications (id uuid primary key default gen_random_uuid(), user_id uuid not null, verification_status text not null, archived_at timestamptz, archive_until_date date);
    create table expert_onboarding_invoices (id uuid primary key default gen_random_uuid(), user_id uuid not null, application_id uuid not null, status text not null, created_at timestamptz not null);
    create table expert_onboarding_payment_facts (invoice_id uuid primary key, user_id uuid not null, admission text not null, captured_at timestamptz not null);
    create table expert_sales_selections (id uuid primary key default gen_random_uuid(), user_id uuid not null, base_id uuid not null, promo_accepted_flag boolean not null, selected_total_minor bigint not null, term_months int not null);
    create table expert_sales_paid_locks (user_id uuid primary key, invoice_id uuid not null, selection_id uuid not null, final_locked_price bigint not null, term_months int not null);
    create table experts (id uuid primary key default gen_random_uuid(), user_id uuid not null);
    create table expert_residency_orders (id uuid primary key default gen_random_uuid(), expert_id uuid not null, status text not null);
    create function expert_card_current_messaging_authority(uuid,text) returns boolean language sql as 'select $2 = ''current''';
  `),
  );
}, 120_000);
afterAll(async () => {
  await fixture?.stop();
}, 120_000);

it("refuses an archived onboarding application and restores eligibility only after unarchiving", async () => {
  const module = await import("./early-bird-onboarding-status.js").catch(
    () => null,
  );
  expect(module).not.toBeNull();
  const user = await fixture.createUser();
  const base = (
    await fixture.db.execute<{ id: string }>(
      sql`insert into expert_sales_bases(user_id,base_tariff_amount,consent_version) values(${user}::uuid,800000,'current') returning id`,
    )
  ).rows[0]!.id;
  await fixture.db.execute(
    sql`insert into early_bird_choices(base_id,user_id,decision_no,choice,chosen_at) values(${base}::uuid,${user}::uuid,1,'later',clock_timestamp()-interval '1 hour')`,
  );
  const app = (
    await fixture.db.execute<{ id: string }>(
      sql`insert into expert_onboarding_applications(user_id,verification_status) values(${user}::uuid,'approved') returning id`,
    )
  ).rows[0]!.id;
  const invoice = (
    await fixture.db.execute<{ id: string }>(
      sql`insert into expert_onboarding_invoices(user_id,application_id,status,created_at) values(${user}::uuid,${app}::uuid,'settled',clock_timestamp()) returning id`,
    )
  ).rows[0]!.id;
  await fixture.db.execute(
    sql`insert into expert_onboarding_payment_facts(invoice_id,user_id,admission,captured_at) values(${invoice}::uuid,${user}::uuid,'interview',clock_timestamp())`,
  );
  const selection = (
    await fixture.db.execute<{ id: string }>(
      sql`insert into expert_sales_selections(user_id,base_id,promo_accepted_flag,selected_total_minor,term_months) values(${user}::uuid,${base}::uuid,false,800000,1) returning id`,
    )
  ).rows[0]!.id;
  await fixture.db.execute(
    sql`insert into expert_sales_paid_locks(user_id,invoice_id,selection_id,final_locked_price,term_months) values(${user}::uuid,${invoice}::uuid,${selection}::uuid,800000,1)`,
  );
  const repo = new module!.PostgresEarlyBirdOnboardingStatus(fixture.db);
  expect(await repo.find(user)).toEqual({
    status: "ONBOARDING_ONLY",
    baseId: base,
    basePriceMinor: 800000n,
  });
  await fixture.db.execute(
    sql`update expert_onboarding_applications set archived_at=clock_timestamp() where id=${app}::uuid`,
  );
  expect(await repo.find(user)).toBeNull();
  await fixture.db.execute(
    sql`update expert_onboarding_applications set archived_at=null,archive_until_date=current_date where id=${app}::uuid`,
  );
  expect(await repo.find(user)).toBeNull();
  await fixture.db.execute(
    sql`update expert_onboarding_applications set archive_until_date=null where id=${app}::uuid`,
  );
  expect(await repo.find(user)).toEqual({
    status: "ONBOARDING_ONLY",
    baseId: base,
    basePriceMinor: 800000n,
  });
}, 120_000);
