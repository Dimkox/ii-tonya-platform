import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, it } from "vitest";
import { drizzle } from "drizzle-orm/node-postgres";
import { sql } from "drizzle-orm";
import type { DrizzleDb } from "../client.js";
import {
  startDisposableTestPostgres,
  type TestDatabase,
} from "../testkit/postgres.js";
import {
  PostgresDeferredFinalCallCampaign,
  PostgresFinalCallEngagement,
} from "./early-bird-deferred-final-call.js";
let fixture: TestDatabase;
const user = randomUUID(),
  account = randomUUID(),
  base = randomUUID(),
  choice = randomUUID(),
  config = randomUUID(),
  invoice = randomUUID();
const login = `finalcall_${randomUUID().replaceAll("-", "").slice(0, 16)}`;
beforeAll(async () => {
  fixture = await startDisposableTestPostgres();
  await fixture.db.execute(
    sql.raw(`
 create table test_clock(now timestamptz);insert into test_clock values(clock_timestamp());
 create function early_bird_current_time() returns timestamptz language sql volatile as $$select now from public.test_clock$$;
 create table consent_document_versions(id uuid);
 create table users(id uuid primary key,active boolean default true);
 create table expert_sales_erased_cohorts(user_id uuid);
 create table expert_sales_bases(id uuid,user_id uuid,consent_version text);
 create table early_bird_choices(id uuid,user_id uuid,base_id uuid,choice text,decision_no integer,revision integer);
 create table early_bird_launch_configs(id uuid primary key,active boolean,phase text,client_start_at timestamptz,final_call_trigger_at timestamptz);
 create table early_bird_deferred_accounts(id uuid primary key,user_id uuid,base_id uuid,choice_id uuid,config_id uuid,onboarding_minor bigint,subscription_minor bigint,launch_at timestamptz);
 create table early_bird_deferred_invoices(id uuid primary key,account_id uuid,user_id uuid,stage text,captured_at timestamptz,amount_minor bigint,provider_id text,evidence_digest text);
 create table early_bird_deferred_verified_bindings(invoice_id uuid,user_id uuid,provider_id text,amount_minor bigint,evidence_digest text);
 create table early_bird_deferred_verified_refund_bindings(invoice_id uuid,user_id uuid,provider_refund_id text);
 create table early_bird_deferred_refund_facts(invoice_id uuid,user_id uuid);
 create table early_bird_deferred_refund_reconciliation(invoice_id uuid,user_id uuid);
 create table early_bird_deferred_refund_resolutions(provider_refund_id text,invoice_id uuid,user_id uuid,disposition text);
 create table experts_published(user_id uuid,active boolean,updated_at timestamptz);
 create table channel_identities(id uuid primary key,user_id uuid,provider text,status text,bot_key text,external_id text,external_chat_id text);
 create function expert_card_current_messaging_authority(uuid,text) returns boolean language sql as $$select $2='current'$$;
 create function early_bird_composite_qualification(uuid,uuid) returns boolean language sql as $$select true$$;
 `),
  );
  for (const source of [
    "0077_early_bird_final_call.sql",
    "early_bird_final_call_authority.sql",
    "early_bird_final_call_worker_capability.sql",
  ])
    for (const statement of readFileSync(
      `docs/superpowers/implementation-artifacts/drafts/${source}`,
      "utf8",
    ).split("--> statement-breakpoint"))
      if (statement.trim()) await fixture.db.execute(sql.raw(statement));
  await fixture.db.execute(
    sql.raw(`
 insert into users values('${user}',true);
 insert into expert_sales_bases values('${base}','${user}','current');
 insert into early_bird_choices values('${choice}','${user}','${base}','later',1,1);
 insert into early_bird_launch_configs values('${config}',true,'WAVE_1_EARLY_BIRD',clock_timestamp()+interval '14 days',(date_trunc('day',clock_timestamp() at time zone 'Europe/Moscow')+interval '10 hours'-interval '4 days') at time zone 'Europe/Moscow');
 insert into early_bird_deferred_accounts select '${account}','${user}','${base}','${choice}',id,1000,2000,client_start_at from early_bird_launch_configs;
 insert into early_bird_deferred_invoices values('${invoice}','${account}','${user}','onboarding',clock_timestamp()-interval '1 day',1000,'provider1','sha256:evidence');
 insert into early_bird_deferred_verified_bindings values('${invoice}','${user}','provider1',1000,'sha256:evidence');
 insert into channel_identities values(gen_random_uuid(),'${user}','telegram','active','promo','123','123');
 insert into experts_published values('${user}',true,clock_timestamp());
 create role ${login} login inherit;
 grant ii_tonya_wave_final_call_worker to ${login};
 `),
  );
}, 120000);
afterAll(async () => {
  if (fixture) {
    try {
      await fixture.db.execute(
        sql.raw(
          `DO $$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='${login}') THEN EXECUTE 'drop owned by ${login}'; EXECUTE 'drop role ${login}'; END IF; END $$`,
        ),
      );
    } finally {
      await fixture.stop();
    }
  }
}, 120000);
it("uses only the isolated capability for scheduling, send admission, receipts, engagement and exclusion", async () => {
  const client = await fixture.db.$client.connect();
  await client.query(`set session authorization ${login}`);
  try {
    const campaign = new PostgresDeferredFinalCallCampaign(
      drizzle(client) as unknown as DrizzleDb,
      {
        botKey: "promo",
        messagingPolicyVersion: "current",
        expectedLogin: login,
      },
    );
    await expect(
      client.query("select * from early_bird_deferred_accounts"),
    ).rejects.toMatchObject({ code: "42501" });
    expect(await campaign.enqueueDue(20)).toBe(1);
    expect(await campaign.enqueueDue(20)).toBe(0);
    const claim = await campaign.queue.claim();
    expect(claim?.userId).toBe(user);
    expect(await campaign.queue.dispatch(claim!)).toBe(true);
    expect(await campaign.queue.dispatch(claim!)).toBe(false);
    const messages: unknown[] = [];
    const result = await campaign.sendIfCurrent(claim!, async (value) => {
      messages.push(value);
      return { messageId: "42" };
    });
    expect(result).toEqual({ kind: "delivered", messageId: "42" });
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({
      chatId: "123",
      subscriptionMinor: "2000",
      callbackData: `eb:${base}:1:subscription`,
    });
    expect(await campaign.finish(claim!, result)).toBe(true);
    expect(await campaign.queue.claim()).toBeNull();
    await expect(
      client.query(
        "select public.early_bird_final_call_worker('engage',$1::jsonb)",
        [JSON.stringify({ userId: user })],
      ),
    ).rejects.toMatchObject({ code: "P0001" });
    await expect(
      client.query("select public.early_bird_final_call_engage($1::uuid)", [
        user,
      ]),
    ).rejects.toMatchObject({ code: "42501" });
    expect(
      (
        await fixture.db.execute(
          sql`select user_id from early_bird_final_call_engagements`,
        )
      ).rows,
    ).toHaveLength(0);
    await new PostgresFinalCallEngagement(fixture.db).recordEngagementForUser(
      user,
    );
    expect(
      (
        await fixture.db.execute(
          sql`select user_id from early_bird_final_call_engagements`,
        )
      ).rows,
    ).toHaveLength(1);
    await fixture.db.execute(
      sql`update test_clock set now=(select client_start_at+interval '1 second' from early_bird_launch_configs)`,
    );
    expect(await campaign.excludeUnpaid(20)).toBe(1);
    await fixture.db.execute(
      sql.raw(`grant select on early_bird_deferred_accounts to ${login}`),
    );
    await expect(campaign.enqueueDue(20)).rejects.toThrow(
      "early_bird_deferred_principal_unsafe",
    );
  } finally {
    await client.query("reset session authorization");
    client.release();
  }
}, 120000);
