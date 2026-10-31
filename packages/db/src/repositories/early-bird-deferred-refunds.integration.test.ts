import { readFileSync } from "node:fs";
import { afterAll, beforeAll, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { YooKassaDeferredVerifier } from "@ii-tonya/integrations";
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
    create table early_bird_launch_configs(id uuid primary key, active boolean default true, phase text default 'WAVE_1_EARLY_BIRD', client_start_at timestamptz default '2027-01-10T21:00:00Z');
    create table early_bird_composite_intents(user_id uuid, status text, id uuid default gen_random_uuid(), unique(id,user_id));
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
  await fixture.db.execute(
    sql.raw(
      `create table early_bird_verified_refund_bindings(provider_refund_id text, user_id uuid, intent_id uuid); create table early_bird_refund_registry(provider_refund_id text primary key,intent_id uuid not null,user_id uuid not null,amount_minor bigint not null,foreign key(intent_id,user_id) references early_bird_composite_intents(id,user_id) on delete cascade);`,
    ),
  );
  await fixture.db.execute(
    sql.raw(
      readFileSync(
        "docs/superpowers/implementation-artifacts/drafts/0089_early_bird_deferred_refunds.sql",
        "utf8",
      ),
    ),
  );
}, 120_000);
afterAll(async () => {
  await fixture?.stop();
}, 120_000);

it("records bounded partial and full refunds with one global provider-ID registry", async () => {
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
    sql`insert into early_bird_deferred_accounts(id,user_id,base_id,choice_id,grant_id,config_id,policy_version,onboarding_minor,subscription_minor,launch_at) values(${account}::uuid,${user}::uuid,${base}::uuid,${choice}::uuid,${grant}::uuid,${config}::uuid,'owner_test_10_20_v1',1000,2000,'2027-01-10T21:00:00Z')`,
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
      sql`insert into early_bird_composite_intents(user_id,status) values(${user}::uuid,'prepared')`,
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
  const snapshot = (
    await fixture.db.execute<{ data: Record<string, unknown> }>(
      sql`select early_bird_deferred_read_invoice(${second}::uuid) as data`,
    )
  ).rows[0]!.data;
  expect(snapshot).toMatchObject({
    invoiceId: second,
    operationId: second,
    userId: user,
    stage: "subscription",
    amountMinor: "2000",
    policy: "owner_test_10_20_v1",
    grantId: grant,
    mode: "live",
  });
  expect(Object.keys(snapshot).sort()).toEqual([
    "amountMinor",
    "grantId",
    "invoiceId",
    "launchAt",
    "mode",
    "operationId",
    "policy",
    "stage",
    "userId",
  ]);
  const contact = crypto.randomUUID();
  await fixture.db.execute(
    sql`insert into early_bird_deferred_receipt_contacts(id,user_id,account_id,idempotency_key,captured_at,expires_at,key_id,ciphertext) values(${contact}::uuid,${user}::uuid,${account}::uuid,'test-receipt-0001',clock_timestamp()-interval '1 minute',clock_timestamp()+interval '1 hour','key1',${`prc1.${"a".repeat(45)}`})`,
  );
  await fixture.db.execute(
    sql`insert into early_bird_deferred_requests(invoice_id,user_id,receipt_contact_id,request_digest,ciphertext,key_reference,expires_at) values(${second}::uuid,${user}::uuid,${contact}::uuid,${evidence},'sealed','secret:key1',clock_timestamp()+interval '30 minutes')`,
  );
  const admitted = (
    await fixture.db.execute<{ data: Record<string, unknown> }>(
      sql`select early_bird_deferred_admit_send(${user}::uuid,${second}::uuid,${contact}::uuid) as data`,
    )
  ).rows[0]!.data;
  expect(admitted).toMatchObject({
    kind: "initial_send_admitted",
    receiptContactId: contact,
    invoiceId: second,
    amountMinor: "2000",
  });
  const repeat = (
    await fixture.db.execute<{ data: Record<string, unknown> }>(
      sql`select early_bird_deferred_admit_send(${user}::uuid,${second}::uuid,${contact}::uuid) as data`,
    )
  ).rows[0]!.data;
  expect(repeat).toMatchObject({ kind: "reconcile", invoiceId: second });
  const readPrivilege = await fixture.db.execute<{ allowed: boolean }>(
    sql`select has_function_privilege('public','early_bird_deferred_read_invoice(uuid)','execute') as allowed`,
  );
  expect(readPrivilege.rows[0]!.allowed).toBe(false);
  const verifier = new YooKassaDeferredVerifier(
    {
      getPayment: async () => ({
        id: "fake-provider-subscription",
        status: "succeeded",
        paid: true,
        test: false,
        amount: { value: "20.00", currency: "RUB" },
        createdAt: "2026-01-01T00:00:00Z",
        capturedAt: "2026-01-01T00:01:00Z",
        metadata: {
          order_id: second,
          operation_id: second,
          user_id: user,
          purpose: "early_bird_deferred",
          stage: "subscription",
          pricing_policy: "owner_test_10_20_v1",
          pricing_grant_id: grant,
        },
      }),
    } as never,
    {
      findInvoice: async (id) =>
        (
          await fixture.db.execute<{ data: never }>(
            sql`select early_bird_deferred_read_invoice(${id}::uuid) as data`,
          )
        ).rows[0]!.data,
    },
  );
  const verified = await verifier.verify(second, "fake-provider-subscription");
  await fixture.db.execute(
    sql`select early_bird_deferred_bind_verified(${verified.invoiceId}::uuid,${verified.userId}::uuid,${verified.providerId},${verified.amountMinor}::bigint,${verified.evidenceDigest})`,
  );
  await fixture.db.execute(
    sql`select early_bird_deferred_commit_verified(${verified.invoiceId}::uuid,${verified.userId}::uuid,${verified.providerId},${verified.amountMinor}::bigint,${verified.evidenceDigest},${verified.capturedAt}::timestamptz)`,
  );
  const settled = (
    await fixture.db.execute<{ provider: string; amount: string }>(
      sql`select provider_id as provider,amount_minor::text as amount from early_bird_deferred_invoices where id=${second}::uuid and captured_at is not null`,
    )
  ).rows[0];
  expect(settled).toEqual({
    provider: "fake-provider-subscription",
    amount: "2000",
  });
  const refundEvidence = `sha256:${"d".repeat(64)}`;
  const bindRefund = (id: string, amount: number) =>
    fixture.db.execute(
      sql`select early_bird_deferred_bind_refund(${second}::uuid,${user}::uuid,'fake-provider-subscription',${id},${amount}::bigint,${refundEvidence})`,
    );
  const settleRefund = (id: string, amount: number) =>
    fixture.db.execute(
      sql`select early_bird_deferred_commit_refund(${second}::uuid,${user}::uuid,'fake-provider-subscription',${id},${amount}::bigint,${refundEvidence})`,
    );
  await bindRefund("refund-canceled", 250);
  await fixture.db.execute(
    sql`select early_bird_deferred_cancel_refund(${second}::uuid,${user}::uuid,'fake-provider-subscription','refund-canceled',250::bigint,${refundEvidence})`,
  );
  expect(
    (
      await fixture.db.execute<{ n: number }>(
        sql`select count(*)::int as n from early_bird_deferred_refund_resolutions where provider_refund_id='refund-canceled'`,
      )
    ).rows[0]!.n,
  ).toBe(1);
  await expect(settleRefund("refund-canceled", 250)).rejects.toThrow();
  await expect(
    fixture.db.execute(
      sql`insert into early_bird_verified_refund_bindings(provider_refund_id,user_id,intent_id) values('refund-canceled',${user}::uuid,${crypto.randomUUID()}::uuid)`,
    ),
  ).rejects.toThrow();
  await bindRefund("refund-part", 500);
  expect(
    (
      await fixture.db.execute<{ n: number }>(
        sql`select count(*)::int as n from early_bird_deferred_verified_refund_bindings where invoice_id=${second}::uuid`,
      )
    ).rows[0]!.n,
  ).toBe(2);
  await settleRefund("refund-part", 500);
  await settleRefund("refund-part", 500);
  expect(
    (
      await fixture.db.execute<{ n: number }>(
        sql`select count(*)::int as n from early_bird_deferred_refund_reconciliation where invoice_id=${second}::uuid`,
      )
    ).rows[0]!.n,
  ).toBe(1);
  await bindRefund("refund-over", 1600);
  await expect(settleRefund("refund-over", 1600)).rejects.toThrow();
  await bindRefund("refund-rest", 1500);
  await settleRefund("refund-rest", 1500);
  const total = (
    await fixture.db.execute<{ amount: string }>(
      sql`select sum(amount_minor)::text as amount from early_bird_deferred_refund_facts where invoice_id=${second}::uuid`,
    )
  ).rows[0]!.amount;
  expect(total).toBe("2000");
  await expect(
    fixture.db.execute(
      sql`insert into early_bird_refund_registry(provider_refund_id,intent_id,deferred_invoice_id,user_id,amount_minor) values('refund-part',null,${second}::uuid,${user}::uuid,500)`,
    ),
  ).rejects.toThrow();
  const privileges = await fixture.db.execute<{ allowed: boolean }>(
    sql`select has_function_privilege('public','early_bird_deferred_commit_verified(uuid,uuid,text,bigint,text,timestamptz)','execute') as allowed`,
  );
  expect(privileges.rows[0]!.allowed).toBe(false);
}, 120_000);
