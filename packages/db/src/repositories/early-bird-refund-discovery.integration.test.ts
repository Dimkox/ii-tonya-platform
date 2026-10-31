import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { YooKassaEarlyBirdRefundDiscovery } from "../../../integrations/src/yookassa/early-bird-refund-discovery.js";
import { PostgresEarlyBirdRefundBindingReader } from "./early-bird-refund-binding-reader.js";
import { PostgresEarlyBirdRefundBindingStore } from "./early-bird-refund-binding-store.js";
import type { DrizzleDb } from "../client.js";
import { PostgresEarlyBirdRefundSettlementStore } from "./early-bird-refund-settlement-store.js";
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
        "docs/superpowers/implementation-artifacts/drafts/0085_early_bird_verified_refund_settlement.sql",
        "utf8",
      ),
    ),
  );
  await fixture.db.execute(
    sql.raw(
      readFileSync(
        "docs/superpowers/implementation-artifacts/drafts/0086_early_bird_verified_refund_binding.sql",
        "utf8",
      ),
    ),
  );
}, 120_000);
afterAll(async () => {
  await fixture?.stop();
}, 120_000);
it("discovers, binds and commits a provider refund with separate restricted roles", async () => {
  const user = randomUUID(),
    op = randomUUID(),
    invoice = randomUUID(),
    grant = randomUUID();
  await fixture.db.execute(sql`insert into users values(${user}::uuid)`);
  await fixture.db.execute(
    sql`insert into early_bird_composite_intents values(${op}::uuid,${invoice}::uuid,${user}::uuid,${grant}::uuid,'live','owner_test_10_20_v1','fixed_test',1000,2000,3000,'2026-01-01Z','2026-01-11Z','2027-01-11T00:00:00+03:00','unknown')`,
  );
  await fixture.db.execute(
    sql`insert into early_bird_verified_bindings values(${op}::uuid,${user}::uuid,'discover-pay')`,
  );
  await fixture.db.execute(
    sql`select early_bird_record_success(${op}::uuid,${user}::uuid,'discover-pay',${`sha256:${"a".repeat(64)}`},'2026-01-02T00:00:00Z'::timestamptz)`,
  );
  for (const [role, login, fn] of [
    [
      "ii_tonya_wave_refund_writer",
      "wave_settle_login",
      "early_bird_commit_verified_refund(jsonb,bigint,text,timestamptz)",
    ],
    [
      "ii_tonya_wave_refund_binder",
      "wave_bind_login",
      "early_bird_bind_verified_refund(jsonb)",
    ],
    [
      "ii_tonya_wave_refund_binding_reader",
      "wave_read_login",
      "early_bird_read_verified_refund(text)",
    ],
  ] as const) {
    await fixture.db.execute(sql.raw(`create role ${role} nologin noinherit`));
    await fixture.db.execute(sql.raw(`create role ${login} login inherit`));
    await fixture.db.execute(sql.raw(`grant ${role} to ${login}`));
    await fixture.db.execute(
      sql.raw(`grant execute on function ${fn} to ${role}`),
    );
  }
  const [a, b, c] = await Promise.all([
    fixture.db.$client.connect(),
    fixture.db.$client.connect(),
    fixture.db.$client.connect(),
  ]);
  try {
    await Promise.all([
      a.query("set session authorization wave_settle_login"),
      b.query("set session authorization wave_bind_login"),
      c.query("set session authorization wave_read_login"),
    ]);

    const reader = new PostgresEarlyBirdRefundBindingReader(
      drizzle(c) as unknown as DrizzleDb,
      "wave_read_login",
    );
    const binding = {
      invoiceId: invoice,
      userId: user,
      operationId: op,
      providerObjectId: "discover-pay",
      pricingPolicy: "owner_test_10_20_v1" as const,
      priceKind: "fixed_test" as const,
      mode: "live" as const,
      grantId: grant,
      onboardingMinor: "1000" as const,
      subscriptionMinor: "2000" as const,
      totalMinor: "3000" as const,
      baseOfferShownAt: "2026-01-01T00:00:00.000Z",
      expiresAt: "2026-01-11T00:00:00.000Z",
      launchAt: "2027-01-10T21:00:00.000Z",
    };
    const client = {
      getRefund: async (id: string) => ({
        id,
        paymentId: "discover-pay",
        status: "succeeded" as const,
        amount: { value: "10.00", currency: "RUB" as const },
        createdAt: "2026-01-03T00:00:00.000Z",
      }),
      getPayment: async () => ({
        id: "discover-pay",
        status: "succeeded" as const,
        paid: true,
        refundable: true,
        test: false,
        amount: { value: "30.00", currency: "RUB" as const },
        createdAt: "2026-01-01T00:00:00.000Z",
        capturedAt: "2026-01-02T00:00:00.000Z",
        metadata: {
          order_id: invoice,
          operation_id: op,
          user_id: user,
          purpose: "combined_early_bird",
          pricing_policy: "owner_test_10_20_v1",
          price_kind: "fixed_test",
          pricing_grant_id: grant,
        },
      }),
    };
    const discovery = new YooKassaEarlyBirdRefundDiscovery(
      client,
      {
        findInvoiceByProviderObject: async () => invoice,
        findEarlyBirdBinding: async () => binding,
      },
      {
        findRefundBinding: (id) => reader.findRefundBinding(id),
      },
      (issuer) => ({
        bind: (proof) =>
          new PostgresEarlyBirdRefundBindingStore(
            drizzle(b) as unknown as DrizzleDb,
            issuer,
            "wave_bind_login",
          ).bind(proof),
        settle: (proof) =>
          new PostgresEarlyBirdRefundSettlementStore(
            drizzle(a) as unknown as DrizzleDb,
            issuer,
            "wave_settle_login",
          ).commit(proof),
      }),
    );
    expect(await discovery.handle("discover-ref")).toBe(true);
    expect(await discovery.handle("discover-ref")).toBe(true);
    let firstAttempt = true;
    const recovery = new YooKassaEarlyBirdRefundDiscovery(
      client,
      {
        findInvoiceByProviderObject: async () => invoice,
        findEarlyBirdBinding: async () => binding,
      },
      { findRefundBinding: (id) => reader.findRefundBinding(id) },
      (issuer) => ({
        bind: (proof) =>
          new PostgresEarlyBirdRefundBindingStore(
            drizzle(b) as unknown as DrizzleDb,
            issuer,
            "wave_bind_login",
          ).bind(proof),
        settle: async (proof) => {
          if (firstAttempt) {
            firstAttempt = false;
            throw new Error("interrupted");
          }
          await new PostgresEarlyBirdRefundSettlementStore(
            drizzle(a) as unknown as DrizzleDb,
            issuer,
            "wave_settle_login",
          ).commit(proof);
        },
      }),
    );
    await expect(recovery.handle("recover-ref")).rejects.toThrow("interrupted");
    expect(await reader.findRefundBinding("recover-ref")).not.toBeNull();
    expect(await recovery.handle("recover-ref")).toBe(true);
    const overlap = await Promise.all([
      discovery.handle("race-ref"),
      discovery.handle("race-ref"),
    ]);
    expect(overlap.filter(Boolean)).toHaveLength(1);
    expect(await discovery.handle("race-ref")).toBe(true);
    const found = await reader.findRefundBinding("discover-ref");
    expect(found).toMatchObject({
      refundId: "discover-ref",
      paymentId: "discover-pay",
    });
  } finally {
    await Promise.all([
      a.query("reset session authorization"),
      b.query("reset session authorization"),
      c.query("reset session authorization"),
    ]);
    a.release();
    b.release();
    c.release();
  }
  const rows = await fixture.db.execute(
    sql`select * from early_bird_refund_reconciliation where intent_id=${op}::uuid`,
  );
  expect(rows.rows).toHaveLength(3);
}, 120_000);
