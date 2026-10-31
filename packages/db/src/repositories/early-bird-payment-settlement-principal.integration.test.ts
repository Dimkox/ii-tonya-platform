import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { YooKassaEarlyBirdVerifier } from "@ii-tonya/integrations";
import type { DrizzleDb } from "../client.js";
import { PostgresEarlyBirdPaymentSettlementStore } from "./early-bird-payment-settlement-store.js";
import {
  startDisposableTestPostgres,
  type TestDatabase,
} from "../testkit/postgres.js";
let fixture: TestDatabase;
beforeAll(async () => {
  fixture = await startDisposableTestPostgres();
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
it("accepts a verified payment only with an isolated database principal", async () => {
  const user = randomUUID(),
    operation = randomUUID(),
    invoice = randomUUID(),
    evidence = "2026-01-01T00:00:00.000Z";
  await fixture.db.execute(sql`insert into users values(${user}::uuid)`);
  await fixture.db.execute(
    sql`insert into early_bird_composite_intents values(${operation}::uuid,${invoice}::uuid,${user}::uuid,null,'live','wave1_standard_v1','full_price',300000,1000000,1300000,'2026-01-01Z','2026-01-11Z','2027-01-11T00:00:00+03:00','unknown')`,
  );
  await fixture.db.execute(
    sql`insert into early_bird_verified_bindings values(${operation}::uuid,${user}::uuid,'role-pay')`,
  );
  await fixture.db.execute(
    sql`create role ii_tonya_wave_settlement_writer nologin noinherit`,
  );
  await fixture.db.execute(sql`create role wave_test_login login inherit`);
  await fixture.db.execute(
    sql`grant ii_tonya_wave_settlement_writer to wave_test_login`,
  );
  await fixture.db.execute(
    sql`grant execute on function early_bird_commit_verified_payment(jsonb,text,timestamptz) to ii_tonya_wave_settlement_writer`,
  );
  const binding = {
    invoiceId: invoice,
    userId: user,
    operationId: operation,
    providerObjectId: "role-pay",
    pricingPolicy: "wave1_standard_v1" as const,
    priceKind: "full_price" as const,
    mode: "live" as const,
    onboardingMinor: "300000" as const,
    subscriptionMinor: "1000000",
    totalMinor: "1300000",
    baseOfferShownAt: evidence,
    expiresAt: "2026-01-11T00:00:00.000Z",
    launchAt: "2027-01-10T21:00:00.000Z",
  };
  const verifier = new YooKassaEarlyBirdVerifier(
    {
      getPayment: async () => ({
        id: "role-pay",
        status: "succeeded",
        paid: true,
        test: false,
        amount: { value: "13000.00", currency: "RUB" },
        createdAt: evidence,
        capturedAt: "2026-01-12T00:00:00.000Z",
        metadata: {
          order_id: invoice,
          operation_id: operation,
          user_id: user,
          purpose: "combined_early_bird",
          pricing_policy: "wave1_standard_v1",
          price_kind: "full_price",
        },
      }),
    } as never,
    { findEarlyBirdBinding: async () => binding },
  );
  const owner = randomUUID(),
    ownerOp = randomUUID(),
    ownerInvoice = randomUUID(),
    grant = randomUUID();
  await fixture.db.execute(sql`insert into users values(${owner}::uuid)`);
  await fixture.db.execute(
    sql`insert into early_bird_composite_intents values(${ownerOp}::uuid,${ownerInvoice}::uuid,${owner}::uuid,${grant}::uuid,'live','owner_test_10_20_v1','fixed_test',1000,2000,3000,'2026-01-01Z','2026-01-11Z','2027-01-11T00:00:00+03:00','unknown')`,
  );
  await fixture.db.execute(
    sql`insert into early_bird_verified_bindings values(${ownerOp}::uuid,${owner}::uuid,'owner-role-pay')`,
  );
  const ownerBinding = {
    invoiceId: ownerInvoice,
    userId: owner,
    operationId: ownerOp,
    grantId: grant,
    providerObjectId: "owner-role-pay",
    pricingPolicy: "owner_test_10_20_v1" as const,
    priceKind: "fixed_test" as const,
    mode: "live" as const,
    onboardingMinor: "1000" as const,
    subscriptionMinor: "2000" as const,
    totalMinor: "3000" as const,
    baseOfferShownAt: "2026-01-01T03:00:00+03:00",
    expiresAt: "2026-01-11T03:00:00+03:00",
    launchAt: "2027-01-11T00:00:00+03:00",
  };
  const ownerVerifier = new YooKassaEarlyBirdVerifier(
    {
      getPayment: async () => ({
        id: "owner-role-pay",
        status: "succeeded",
        paid: true,
        test: false,
        amount: { value: "30.00", currency: "RUB" },
        createdAt: evidence,
        capturedAt: "2026-01-02T00:00:00.000Z",
        metadata: {
          order_id: ownerInvoice,
          operation_id: ownerOp,
          user_id: owner,
          purpose: "combined_early_bird",
          pricing_policy: "owner_test_10_20_v1",
          price_kind: "fixed_test",
          pricing_grant_id: grant,
        },
      }),
    } as never,
    { findEarlyBirdBinding: async () => ownerBinding },
  );
  const client = await fixture.db.$client.connect();
  try {
    await client.query("set session authorization wave_test_login");
    const store = new PostgresEarlyBirdPaymentSettlementStore(
      drizzle(client) as unknown as DrizzleDb,
      verifier,
      "wave_test_login",
    );
    await store.commit(await verifier.verify(invoice));
    await store.commit(await verifier.verify(invoice));
    const ownerStore = new PostgresEarlyBirdPaymentSettlementStore(
      drizzle(client) as unknown as DrizzleDb,
      ownerVerifier,
      "wave_test_login",
    );
    await ownerStore.commit(await ownerVerifier.verify(ownerInvoice));
    await fixture.db.execute(
      sql`grant select on early_bird_payment_successes to wave_test_login`,
    );
    await expect(store.commit(await verifier.verify(invoice))).rejects.toThrow(
      "early_bird_settlement_principal_unsafe",
    );
  } finally {
    await client.query("reset session authorization");
    client.release();
  }
  const rows = await fixture.db.execute(
    sql`select * from early_bird_payment_successes where intent_id=${operation}::uuid`,
  );
  expect(rows.rows).toHaveLength(1);
  const ownerRows = await fixture.db.execute(
    sql`select * from early_bird_payment_successes where intent_id=${ownerOp}::uuid`,
  );
  expect(ownerRows.rows).toHaveLength(1);
}, 120_000);
