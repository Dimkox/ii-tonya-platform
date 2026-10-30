import { readFileSync } from "node:fs";
import { afterAll, beforeAll, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { startTestPostgres, type TestDatabase } from "../testkit/postgres.js";

let fixture: TestDatabase;
beforeAll(async () => {
  fixture = await startTestPostgres();
  await fixture.db.execute(
    sql.raw(`
    create extension if not exists pgcrypto;
    create table consent_document_versions(id uuid);
    create table expert_sales_erased_cohorts(user_id uuid);
    create table users(id uuid primary key, active boolean default true);
    create table expert_sales_bases(id uuid, user_id uuid, consent_version text default 'current', unique(id,user_id));
    create table early_bird_choices(id uuid, user_id uuid, base_id uuid, choice text default 'later', decision_no int default 1, unique(id,user_id));
    create table owner_test_pricing_grants(id uuid, user_id uuid, revoked_at timestamptz, provider_mode text default 'live', unique(id,user_id));
    create table early_bird_launch_configs(id uuid primary key, active boolean default true, phase text default 'WAVE_1_EARLY_BIRD', client_start_at timestamptz default '2027-01-11');
    create table early_bird_composite_intents(user_id uuid, status text);
    create table expert_onboarding_invoices(user_id uuid);
    create table expert_sales_paid_locks(user_id uuid);
    create function early_bird_current_time() returns timestamptz language sql as $$select '2027-01-01'::timestamptz$$;
    create function early_bird_wave_active(timestamptz) returns boolean language sql as $$select true$$;
    create function expert_card_current_messaging_authority(uuid,text) returns boolean language sql as $$select $2='current'$$;
    create function early_bird_composite_qualification(uuid,uuid) returns boolean language sql as $$select true$$;
    create table early_bird_positive_price_snapshots(positive_choice_id uuid, user_id uuid, base_id uuid, grant_id uuid, policy_version text, onboarding_minor bigint, base_monthly_minor bigint);
  `),
  );
  await fixture.db.execute(
    sql.raw(
      readFileSync(
        "docs/superpowers/implementation-artifacts/drafts/0088_early_bird_deferred_payments.sql",
        "utf8",
      ),
    ),
  );
}, 120_000);
afterAll(async () => {
  await fixture?.stop();
}, 120_000);

it("requires verified onboarding before issuing the undiscounted subscription", async () => {
  const user = crypto.randomUUID(),
    base = crypto.randomUUID(),
    choice = crypto.randomUUID(),
    config = crypto.randomUUID(),
    grant = crypto.randomUUID(),
    account = crypto.randomUUID();
  await fixture.db.execute(sql`insert into users(id) values(${user}::uuid)`);
  await fixture.db.execute(
    sql`insert into expert_sales_bases(id,user_id) values(${base}::uuid,${user}::uuid)`,
  );
  await fixture.db.execute(
    sql`insert into early_bird_choices(id,user_id,base_id) values(${choice}::uuid,${user}::uuid,${base}::uuid)`,
  );
  await fixture.db.execute(
    sql`insert into owner_test_pricing_grants(id,user_id) values(${grant}::uuid,${user}::uuid)`,
  );
  await fixture.db.execute(
    sql`insert into early_bird_launch_configs(id) values(${config}::uuid)`,
  );
  await fixture.db.execute(
    sql`insert into early_bird_deferred_accounts(id,user_id,base_id,choice_id,grant_id,config_id,policy_version,onboarding_minor,subscription_minor,launch_at) values(${account}::uuid,${user}::uuid,${base}::uuid,${choice}::uuid,${grant}::uuid,${config}::uuid,'owner_test_10_20_v1',1000,2000,'2027-01-11')`,
  );
  const first = crypto.randomUUID(),
    second = crypto.randomUUID();
  const key = crypto.randomUUID();
  const issue = (id: string, stage: string, invoiceKey = crypto.randomUUID()) =>
    fixture.db.execute(
      sql`select early_bird_deferred_invoice(${account}::uuid,${user}::uuid,${id}::uuid,${invoiceKey}::uuid,${stage})::text as amount`,
    );
  await expect(issue(second, "subscription")).rejects.toThrow();
  expect((await issue(first, "onboarding", key)).rows[0]).toEqual({
    amount: "1000",
  });
  expect((await issue(first, "onboarding", key)).rows[0]).toEqual({
    amount: "1000",
  });
  await expect(issue(first, "onboarding")).rejects.toThrow();
  await expect(
    fixture.db.execute(
      sql`insert into early_bird_composite_intents values(${user}::uuid,'prepared')`,
    ),
  ).rejects.toThrow();
  await expect(
    fixture.db.execute(
      sql`insert into expert_onboarding_invoices values(${user}::uuid)`,
    ),
  ).rejects.toThrow();
  await fixture.db.execute(
    sql`update expert_sales_bases set consent_version='revoked' where id=${base}::uuid`,
  );
  await expect(issue(first, "onboarding", key)).rejects.toThrow();
  await fixture.db.execute(
    sql`update expert_sales_bases set consent_version='current' where id=${base}::uuid`,
  );
  const evidence = `sha256:${"a".repeat(64)}`;
  await expect(
    fixture.db.execute(
      sql`select early_bird_deferred_commit_verified(${first}::uuid,${user}::uuid,'provider1',999,${evidence},'2026-01-01'::timestamptz)`,
    ),
  ).rejects.toThrow();
  await expect(
    fixture.db.execute(
      sql`select early_bird_deferred_commit_verified(${first}::uuid,${user}::uuid,'provider1',1000,${evidence},'2026-01-01'::timestamptz)`,
    ),
  ).rejects.toThrow();
  await fixture.db.execute(
    sql`select early_bird_deferred_bind_verified(${first}::uuid,${user}::uuid,'provider1',1000,${evidence})`,
  );
  await fixture.db.execute(
    sql`select early_bird_deferred_commit_verified(${first}::uuid,${user}::uuid,'provider1',1000,${evidence},'2026-01-01'::timestamptz)`,
  );
  expect((await issue(second, "subscription")).rows[0]).toEqual({
    amount: "2000",
  });
  const privileges = await fixture.db.execute<{ allowed: boolean }>(
    sql`select has_function_privilege('public','early_bird_deferred_commit_verified(uuid,uuid,text,bigint,text,timestamptz)','execute') as allowed`,
  );
  expect(privileges.rows[0]!.allowed).toBe(false);
}, 120_000);
