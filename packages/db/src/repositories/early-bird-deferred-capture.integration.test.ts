import { readFileSync } from "node:fs";
import { afterAll, beforeAll, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { createPayerReceiptVault } from "@ii-tonya/integrations";
import { PostgresDeferredReceiptContact } from "./early-bird-deferred-receipt-contact.js";
import { PostgresDeferredRequestStore } from "./early-bird-deferred-request-store.js";
import { deferredRequestAuthenticator } from "./early-bird-deferred-request-authenticator.js";
import type { DeferredAdmittedSnapshot } from "./early-bird-deferred-send-admission.js";
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

it("captures a scoped encrypted contact and seals an admitted 20-ruble invoice", async () => {
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
  const scope = {
    botId: "bot",
    botKey: "bot",
    telegramUserId: "1",
    chatId: "1",
    offerId: base,
    choiceId: choice,
    accountId: account,
  };
  const resolver = { resolve: async () => ({ userId: user }) };
  const vault = createPayerReceiptVault({
    activeKeyId: "r1",
    keys: new Map([["r1", Buffer.alloc(32, 4)]]),
  });
  const receipts = new PostgresDeferredReceiptContact(
    fixture.db,
    resolver,
    vault,
  );
  const receipt = await receipts.capture(
    scope,
    "test@example.org",
    "receipt-0000001",
  );
  expect(
    await receipts.capture(scope, "test@example.org", "receipt-0000001"),
  ).toEqual(receipt);
  const requestKey = Buffer.alloc(32, 5),
    requests = new PostgresDeferredRequestStore(
      fixture.db,
      resolver,
      vault,
      requestKey,
      "request:key1",
      { vatCode: 1, paymentSubject: "service", paymentMode: "full_prepayment" },
      "https://example.org/return",
    );
  const material = await requests.prepare(scope, second, receipt.id);
  const materialAgain = await requests.prepare(scope, second, receipt.id);
  expect(materialAgain.snapshot.amountMinor).toBe("2000");
  const record = (
    await fixture.db.execute<{ ciphertext: string }>(
      sql`select ciphertext from early_bird_deferred_receipt_contacts where id=${receipt.id}::uuid`,
    )
  ).rows[0]!;
  expect(record.ciphertext).not.toContain("test@example.org");
  const admitted = (
    await fixture.db.execute<{ data: DeferredAdmittedSnapshot }>(
      sql`select early_bird_deferred_admit_send(${user}::uuid,${second}::uuid,${receipt.id}::uuid) as data`,
    )
  ).rows[0]!.data;
  const body = deferredRequestAuthenticator(
    material,
    receipt.id,
    requestKey,
    "request:key1",
  )(admitted);
  expect(JSON.parse(body).amount.value).toBe("20.00");
  expect(JSON.parse(body).receipt.customer.email).toBe("test@example.org");
}, 120_000);
