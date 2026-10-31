import { readFileSync } from "node:fs";
import { afterAll, beforeAll, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { startTestPostgres, type TestDatabase } from "../testkit/postgres.js";
let fixture: TestDatabase;
const user = "00000000-0000-4000-8000-000000000001",
  account = "00000000-0000-4000-8000-000000000002",
  base = "00000000-0000-4000-8000-000000000003",
  choice = "00000000-0000-4000-8000-000000000004",
  config = "00000000-0000-4000-8000-000000000005",
  invoice = "00000000-0000-4000-8000-000000000006";
beforeAll(async () => {
  fixture = await startTestPostgres();
  await fixture.db.execute(
    sql.raw(`
 create table test_clock(now timestamptz); insert into test_clock values('2026-12-28 06:59:59+00');
 create function early_bird_current_time() returns timestamptz language sql volatile as $$select now from test_clock$$;
 create table users(id uuid primary key,active boolean default true);
 create table expert_sales_erased_cohorts(user_id uuid);
 create table expert_sales_bases(id uuid,user_id uuid,consent_version text);
 create table early_bird_choices(id uuid,user_id uuid,base_id uuid,choice text,decision_no integer);
 create table early_bird_launch_configs(id uuid primary key,active boolean,phase text,client_start_at timestamptz,final_call_trigger_at timestamptz);
 create table early_bird_deferred_accounts(id uuid primary key,user_id uuid,base_id uuid,choice_id uuid,config_id uuid,onboarding_minor bigint,subscription_minor bigint,launch_at timestamptz);
 create table early_bird_deferred_invoices(id uuid primary key,account_id uuid,user_id uuid,stage text,captured_at timestamptz,amount_minor bigint,provider_id text,evidence_digest text);
 create table early_bird_deferred_verified_bindings(invoice_id uuid,user_id uuid,provider_id text,amount_minor bigint,evidence_digest text);
 create table experts_published(user_id uuid,active boolean,updated_at timestamptz);
    create table early_bird_deferred_verified_refund_bindings(invoice_id uuid,user_id uuid,provider_refund_id text);
    create table early_bird_deferred_refund_facts(invoice_id uuid,user_id uuid);
    create table early_bird_deferred_refund_reconciliation(invoice_id uuid,user_id uuid);
    create table early_bird_deferred_refund_resolutions(provider_refund_id text,invoice_id uuid,user_id uuid,disposition text);
 create function expert_card_current_messaging_authority(uuid,text) returns boolean language sql as $$select $2='current'$$;
 create function early_bird_composite_qualification(uuid,uuid) returns boolean language sql as $$select true$$;
 `),
  );
  for (const source of [
    "0077_early_bird_final_call.sql",
    "early_bird_final_call_authority.sql",
  ]) {
    for (const statement of readFileSync(
      `docs/superpowers/implementation-artifacts/drafts/${source}`,
      "utf8",
    ).split("--> statement-breakpoint"))
      if (statement.trim()) await fixture.db.execute(sql.raw(statement));
  }
  await fixture.db.execute(
    sql.raw(`
 insert into users values('${user}',true);
 insert into expert_sales_bases values('${base}','${user}','current');
 insert into early_bird_choices values('${choice}','${user}','${base}','later',1);
 insert into early_bird_launch_configs values('${config}',true,'WAVE_1_EARLY_BIRD','2027-01-11 00:00+03','2026-12-28 10:00+03');
 insert into early_bird_deferred_accounts values('${account}','${user}','${base}','${choice}','${config}',1000,2000,'2027-01-11 00:00+03');
 insert into early_bird_deferred_invoices values('${invoice}','${account}','${user}','onboarding','2026-12-01',1000,'provider1','sha256:evidence');
 insert into experts_published values('${user}',true,clock_timestamp());
 `),
  );
}, 120000);
afterAll(async () => {
  await fixture?.stop();
}, 120000);
it("queues only verified qualified unpaid residents at 10MSK, deduplicates, and excludes unpaid at launch", async () => {
  const scan = () =>
    fixture.db.execute(sql`select * from early_bird_final_call_scan(20)`);
  expect((await scan()).rows).toHaveLength(0);
  await fixture.db.execute(
    sql`update test_clock set now='2026-12-28 07:00+00'`,
  );
  expect((await scan()).rows).toHaveLength(0); // A captured timestamp without verifier binding is insufficient.
  await fixture.db.execute(
    sql`insert into early_bird_deferred_verified_bindings values(${invoice}::uuid,${user}::uuid,'provider1',1000,'sha256:evidence')`,
  );
  expect((await scan()).rows).toHaveLength(1);
  await fixture.db.execute(
    sql`insert into early_bird_deferred_verified_refund_bindings values(${invoice}::uuid,${user}::uuid,'pending-refund')`,
  );
  expect((await scan()).rows).toHaveLength(0);
  await fixture.db.execute(
    sql`insert into early_bird_deferred_refund_resolutions values('pending-refund',${invoice}::uuid,${user}::uuid,'canceled')`,
  );
  expect((await scan()).rows).toHaveLength(1);
  await fixture.db.execute(
    sql`insert into early_bird_deferred_refund_facts values(${invoice}::uuid,${user}::uuid)`,
  );
  expect((await scan()).rows).toHaveLength(0);
  await fixture.db.execute(sql`delete from early_bird_deferred_refund_facts`);
  await fixture.db.execute(
    sql`delete from early_bird_deferred_refund_resolutions`,
  );
  await fixture.db.execute(
    sql`delete from early_bird_deferred_verified_refund_bindings`,
  );
  const queue = () =>
    fixture.db.execute(
      sql`select early_bird_final_call_enqueue(${user}::uuid,'first',${config}::uuid,'2026-12-28 07:00+00') as queued`,
    );
  const both = await Promise.all([queue(), queue()]);
  expect(both.flatMap((r) => r.rows).filter((r) => r.queued)).toHaveLength(1);
  expect((await scan()).rows).toHaveLength(0);
  await fixture.db.execute(
    sql`update expert_sales_bases set consent_version='revoked'`,
  );
  await expect(
    fixture.db.execute(
      sql`update early_bird_final_call_queue set status='preparing',attempt_id=gen_random_uuid(),prepared_until=clock_timestamp()+interval '60 seconds'`,
    ),
  ).rejects.toThrow();
  await fixture.db.execute(
    sql`update expert_sales_bases set consent_version='current'`,
  );
  await fixture.db.execute(
    sql`update test_clock set now='2027-01-10 21:00+00'`,
  );
  expect(
    (
      await fixture.db.execute(
        sql`select early_bird_final_call_exclude(20) as count`,
      )
    ).rows[0],
  ).toEqual({ count: 1 });
  expect(
    (await fixture.db.execute(sql`select active from experts_published`))
      .rows[0],
  ).toEqual({ active: false });
  expect(
    (
      await fixture.db.execute(
        sql`select early_bird_final_call_exclude(20) as count`,
      )
    ).rows[0],
  ).toEqual({ count: 0 });
  expect((await scan()).rows).toHaveLength(0);
}, 120000);

it("requires explicit no-engagement repeat policy, rounds 72h to the next 10MSK tick, and suppresses paid/engaged accounts", async () => {
  const u = "00000000-0000-4000-8000-000000000007",
    a = "00000000-0000-4000-8000-000000000008",
    b = "00000000-0000-4000-8000-000000000009",
    c = "00000000-0000-4000-8000-000000000010",
    cfg = "00000000-0000-4000-8000-000000000011",
    i = "00000000-0000-4000-8000-000000000012";
  await fixture.db.execute(
    sql.raw(`
 update early_bird_launch_configs set active=false;
 update test_clock set now=clock_timestamp();
 insert into users values('${u}',true);
 insert into expert_sales_bases values('${b}','${u}','current');
 insert into early_bird_choices values('${c}','${u}','${b}','later',1);
 insert into early_bird_launch_configs values('${cfg}',true,'WAVE_1_EARLY_BIRD',clock_timestamp()+interval '14 days',(date_trunc('day',clock_timestamp() at time zone 'Europe/Moscow')+interval '10 hours'-interval '4 days') at time zone 'Europe/Moscow');
 insert into early_bird_deferred_accounts select '${a}','${u}','${b}','${c}',id,1000,2000,client_start_at from early_bird_launch_configs where id='${cfg}';
 insert into early_bird_deferred_invoices values('${i}','${a}','${u}','onboarding',clock_timestamp()-interval '1 day',1000,'provider2','sha256:evidence2');
 insert into early_bird_deferred_verified_bindings values('${i}','${u}','provider2',1000,'sha256:evidence2');
 select early_bird_final_call_enqueue('${u}','first','${cfg}',final_call_trigger_at) from early_bird_launch_configs where id='${cfg}';
 update early_bird_final_call_queue set status='preparing',attempt_id=gen_random_uuid(),prepared_until=clock_timestamp()+interval '1 minute' where user_id='${u}';
 update early_bird_final_call_queue set status='dispatched',prepared_until=null where user_id='${u}';
 update early_bird_final_call_queue set status='delivered',message_id='42',delivered_at=clock_timestamp() where user_id='${u}';
 update early_bird_final_call_policy set repeat_without_engagement=false;
 update test_clock set now=(select delivered_at+interval '72 hours' from early_bird_final_call_queue where user_id='${u}');
 `),
  );
  const scan = () =>
    fixture.db.execute(sql`select * from early_bird_final_call_scan(20)`);
  expect((await scan()).rows).toHaveLength(0);
  await fixture.db.execute(
    sql`update early_bird_final_call_policy set repeat_without_engagement=true`,
  );
  expect((await scan()).rows).toHaveLength(0); // 72h is between daily 10MSK ticks.
  await fixture.db.execute(
    sql.raw(
      `update test_clock set now=(select final_call_trigger_at+ceil(extract(epoch from((select delivered_at+interval '72 hours' from early_bird_final_call_queue where user_id='${u}')-final_call_trigger_at))/86400)*interval '1 day' from early_bird_launch_configs where id='${cfg}')`,
    ),
  );
  expect((await scan()).rows).toHaveLength(1);
  // A real click can commit after send returns but before delivered_at is stored.
  // Tracking from notice creation prevents that valid click from being lost.
  await fixture.db.execute(
    sql`insert into early_bird_final_call_engagements(user_id,config_id,engaged_at) select ${u}::uuid,${cfg}::uuid,created_at+interval '1 microsecond' from early_bird_final_call_queue where user_id=${u}::uuid and kind='first'`,
  );
  expect((await scan()).rows).toHaveLength(0);
  await fixture.db.execute(
    sql`delete from early_bird_final_call_engagements where user_id=${u}::uuid`,
  );
  await fixture.db.execute(
    sql`insert into early_bird_final_call_engagements(user_id,config_id,engaged_at) values(${u}::uuid,${cfg}::uuid,early_bird_current_time())`,
  );
  expect((await scan()).rows).toHaveLength(0);
  await fixture.db.execute(
    sql`delete from early_bird_final_call_engagements where user_id=${u}::uuid`,
  );
  await fixture.db.execute(
    sql`insert into early_bird_deferred_invoices values(gen_random_uuid(),${a}::uuid,${u}::uuid,'subscription',clock_timestamp(),2000,'provider3','sha256:evidence3')`,
  );
  expect((await scan()).rows).toHaveLength(0);
}, 120000);

it("resolves exclusion only on independently bound timely payment and erases campaign identifiers", async () => {
  const late = "00000000-0000-4000-8000-000000000013";
  await fixture.db.execute(
    sql`insert into early_bird_deferred_invoices values(${late}::uuid,${account}::uuid,${user}::uuid,'subscription',null,2000,'lateProvider','sha256:late')`,
  );
  await fixture.db.execute(
    sql`update early_bird_deferred_invoices set captured_at='2027-01-10 20:59:59+00' where id=${late}::uuid`,
  );
  expect(
    (
      await fixture.db.execute(
        sql`select user_id from early_bird_wave_one_exclusions where user_id=${user}::uuid`,
      )
    ).rows,
  ).toHaveLength(1);
  await fixture.db.execute(
    sql`insert into early_bird_deferred_verified_bindings values(${late}::uuid,${user}::uuid,'lateProvider',2000,'sha256:late')`,
  );
  await fixture.db.execute(
    sql`update early_bird_deferred_invoices set captured_at=captured_at where id=${late}::uuid`,
  );
  expect(
    (
      await fixture.db.execute(
        sql`select user_id from early_bird_wave_one_exclusions where user_id=${user}::uuid`,
      )
    ).rows,
  ).toHaveLength(0);
  expect(
    (
      await fixture.db.execute(
        sql`select active from experts_published where user_id=${user}::uuid`,
      )
    ).rows[0],
  ).toEqual({ active: false }); // No publication from a reminder worker.
  await fixture.db.execute(
    sql`insert into early_bird_final_call_engagements values(${user}::uuid,${config}::uuid,clock_timestamp())`,
  );
  await fixture.db.execute(
    sql`insert into expert_sales_erased_cohorts values(${user}::uuid)`,
  );
  expect(
    (
      await fixture.db.execute(
        sql`select user_id from early_bird_final_call_engagements where user_id=${user}::uuid`,
      )
    ).rows,
  ).toHaveLength(0);
  expect(
    (
      await fixture.db.execute(
        sql`select user_id from early_bird_final_call_queue where user_id=${user}::uuid`,
      )
    ).rows,
  ).toHaveLength(0);
}, 120000);

it("uses the verified provider capture instant with an exclusive launch cutoff", async () => {
  await fixture.db.execute(
    sql`update test_clock set now='2027-01-11 01:00+03'`,
  );
  const cases: [string, boolean, boolean][] = [
    ["2027-01-10 23:59:59.999999+03", true, false],
    ["2027-01-11 00:00+03", true, true],
    ["2027-01-11 00:00:00.000001+03", true, true],
    ["2027-01-10 23:59+03", false, true],
  ];
  const users: string[] = [];
  for (const [captured, verified] of cases) {
    const uid = crypto.randomUUID(),
      aid = crypto.randomUUID(),
      bid = crypto.randomUUID(),
      cid = crypto.randomUUID(),
      onboarding = crypto.randomUUID(),
      subscription = crypto.randomUUID();
    users.push(uid);
    await fixture.db.execute(sql`insert into users values(${uid}::uuid,true)`);
    await fixture.db.execute(
      sql`insert into expert_sales_bases values(${bid}::uuid,${uid}::uuid,'current')`,
    );
    await fixture.db.execute(
      sql`insert into early_bird_choices values(${cid}::uuid,${uid}::uuid,${bid}::uuid,'later',1)`,
    );
    await fixture.db.execute(
      sql`insert into early_bird_deferred_accounts values(${aid}::uuid,${uid}::uuid,${bid}::uuid,${cid}::uuid,${config}::uuid,1000,2000,'2027-01-11 00:00+03')`,
    );
    await fixture.db.execute(
      sql`insert into early_bird_deferred_invoices values(${onboarding}::uuid,${aid}::uuid,${uid}::uuid,'onboarding','2026-12-01',1000,${onboarding},'sha256:onboarding')`,
    );
    await fixture.db.execute(
      sql`insert into early_bird_deferred_verified_bindings values(${onboarding}::uuid,${uid}::uuid,${onboarding},1000,'sha256:onboarding')`,
    );
    await fixture.db.execute(
      sql`insert into early_bird_deferred_invoices values(${subscription}::uuid,${aid}::uuid,${uid}::uuid,'subscription',${captured}::timestamptz,2000,${subscription},'sha256:subscription')`,
    );
    if (verified)
      await fixture.db.execute(
        sql`insert into early_bird_deferred_verified_bindings values(${subscription}::uuid,${uid}::uuid,${subscription},2000,'sha256:subscription')`,
      );
  }
  await fixture.db.execute(sql`select early_bird_final_call_exclude(50)`);
  for (let i = 0; i < cases.length; i++)
    expect(
      (
        await fixture.db.execute(
          sql`select user_id from early_bird_wave_one_exclusions where user_id=${users[i]}::uuid`,
        )
      ).rows.length > 0,
    ).toBe(cases[i]![2]);
});
