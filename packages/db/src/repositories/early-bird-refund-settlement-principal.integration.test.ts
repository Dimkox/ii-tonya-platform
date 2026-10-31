import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { YooKassaEarlyBirdRefundVerifier } from "@ii-tonya/integrations";
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
}, 120_000);
afterAll(async () => {
  await fixture?.stop();
}, 120_000);
it("commits verified full and partial refunds with the isolated principal", async () => {
  await fixture.db.execute(
    sql`create role ii_tonya_wave_refund_writer nologin noinherit`,
  );
  await fixture.db.execute(sql`create role wave_refund_login login inherit`);
  await fixture.db.execute(
    sql`grant ii_tonya_wave_refund_writer to wave_refund_login`,
  );
  await fixture.db.execute(
    sql`grant execute on function early_bird_commit_verified_refund(jsonb,bigint,text,timestamptz) to ii_tonya_wave_refund_writer`,
  );
  const client = await fixture.db.$client.connect();
  try {
    for (const [suffix, amount] of [
      ["full", "30.00"],
      ["partial", "10.00"],
    ] as const) {
      const user = randomUUID(),
        op = randomUUID(),
        invoice = randomUUID(),
        grant = randomUUID(),
        refundOp = randomUUID(),
        payment = `pay-${suffix}`,
        refund = `ref-${suffix}`;
      await fixture.db.execute(sql`insert into users values(${user}::uuid)`);
      await fixture.db.execute(
        sql`insert into early_bird_composite_intents values(${op}::uuid,${invoice}::uuid,${user}::uuid,${grant}::uuid,'live','owner_test_10_20_v1','fixed_test',1000,2000,3000,'2026-01-01Z','2026-01-11Z','2027-01-11T00:00:00+03:00','unknown')`,
      );
      await fixture.db.execute(
        sql`insert into early_bird_verified_bindings values(${op}::uuid,${user}::uuid,${payment})`,
      );
      await fixture.db.execute(
        sql`select early_bird_record_success(${op}::uuid,${user}::uuid,${payment},${`sha256:${"a".repeat(64)}`},'2026-01-02T00:00:00Z'::timestamptz)`,
      );
      await fixture.db.execute(
        sql`insert into early_bird_verified_refund_bindings values(${refundOp}::uuid,${op}::uuid,${user}::uuid,${payment},${refund})`,
      );
      const binding = {
        invoiceId: invoice,
        userId: user,
        operationId: op,
        refundOperationId: refundOp,
        pricingPolicy: "owner_test_10_20_v1" as const,
        priceKind: "fixed_test" as const,
        grantId: grant,
        paymentId: payment,
        refundId: refund,
        totalMinor: "3000" as const,
        mode: "live" as const,
      };
      const verifier = new YooKassaEarlyBirdRefundVerifier(
        {
          getRefund: async () => ({
            id: refund,
            paymentId: payment,
            status: "succeeded" as const,
            amount: { value: amount, currency: "RUB" as const },
            createdAt: "2026-01-03T00:00:00.000Z",
          }),
          getPayment: async () => ({
            id: payment,
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
        },
        { findRefundBinding: async () => binding },
      );
      await client.query("set session authorization wave_refund_login");
      const store = new PostgresEarlyBirdRefundSettlementStore(
        drizzle(client) as unknown as DrizzleDb,
        verifier,
        "wave_refund_login",
      );
      await store.commit(await verifier.verify(refund));
      await store.commit(await verifier.verify(refund));
      await client.query("reset session authorization");
      const result = await fixture.db.execute<{ total: string }>(
        sql`select sum(amount_minor)::text as total from early_bird_refund_registry where intent_id=${op}::uuid`,
      );
      expect(result.rows[0]!.total).toBe(suffix === "full" ? "3000" : "1000");
    }
  } finally {
    await client.query("reset session authorization");
    client.release();
  }
}, 120_000);
