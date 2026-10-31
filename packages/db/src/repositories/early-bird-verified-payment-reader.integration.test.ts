import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { YooKassaEarlyBirdVerifier } from "@ii-tonya/integrations";
import type { DrizzleDb } from "../client.js";
import { PostgresEarlyBirdVerifiedPaymentReader } from "./early-bird-verified-payment-reader.js";
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
  await fixture.db.execute(sql`create schema early_bird_private`);
  await fixture.db.execute(
    sql`revoke all on schema early_bird_private from public`,
  );
  await fixture.db.execute(
    sql.raw(
      readFileSync(
        "docs/superpowers/implementation-artifacts/drafts/0084_early_bird_verified_payment_reader.sql",
        "utf8",
      ),
    ),
  );
}, 120_000);
afterAll(async () => {
  await fixture?.stop();
}, 120_000);
it("reads only immutable provider bindings under a dedicated isolated role", async () => {
  const user = randomUUID(),
    op = randomUUID(),
    invoice = randomUUID();
  await fixture.db.execute(sql`insert into users values(${user}::uuid)`);
  await fixture.db.execute(
    sql`insert into early_bird_composite_intents values(${op}::uuid,${invoice}::uuid,${user}::uuid,null,'live','wave1_standard_v1','full_price',300000,1000000,1300000,'2026-01-01Z','2026-01-11Z','2027-01-11T00:00:00+03:00','unknown')`,
  );
  await fixture.db.execute(
    sql`insert into early_bird_verified_bindings values(${op}::uuid,${user}::uuid,'reader-pay')`,
  );
  await fixture.db.execute(
    sql`create role ii_tonya_wave_verified_payment_reader nologin noinherit`,
  );
  await fixture.db.execute(sql`create role wave_reader_login login inherit`);
  await fixture.db.execute(
    sql`grant ii_tonya_wave_verified_payment_reader to wave_reader_login`,
  );
  await fixture.db.execute(
    sql`grant usage on schema early_bird_private to ii_tonya_wave_verified_payment_reader`,
  );
  await fixture.db.execute(
    sql`grant execute on function early_bird_private.find_verified_payment(text,text) to ii_tonya_wave_verified_payment_reader`,
  );
  const client = await fixture.db.$client.connect();
  try {
    await client.query("set session authorization wave_reader_login");
    const reader = new PostgresEarlyBirdVerifiedPaymentReader(
      drizzle(client) as unknown as DrizzleDb,
      "wave_reader_login",
    );
    expect(await reader.findInvoiceByProviderObject("reader-pay")).toBe(
      invoice,
    );
    const binding = await reader.findEarlyBirdBinding(invoice);
    expect(binding).toMatchObject({
      invoiceId: invoice,
      userId: user,
      operationId: op,
      providerObjectId: "reader-pay",
      totalMinor: "1300000",
    });
    expect(await reader.findInvoiceByProviderObject("unknown")).toBeNull();
    const verifier = new YooKassaEarlyBirdVerifier(
      {
        getPayment: async () => ({
          id: "reader-pay",
          status: "succeeded",
          paid: true,
          test: false,
          amount: { value: "13000.00", currency: "RUB" },
          createdAt: "2026-01-01T00:00:00.000Z",
          capturedAt: "2026-01-02T00:00:00.000Z",
          metadata: {
            order_id: invoice,
            operation_id: op,
            user_id: user,
            purpose: "combined_early_bird",
            pricing_policy: "wave1_standard_v1",
            price_kind: "full_price",
          },
        }),
      } as never,
      reader,
    );
    expect(await verifier.verify(invoice)).toMatchObject({
      invoiceId: invoice,
      providerObjectId: "reader-pay",
    });
    await fixture.db.execute(
      sql`grant select on early_bird_composite_intents to wave_reader_login`,
    );
    await expect(reader.findEarlyBirdBinding(invoice)).rejects.toThrow(
      "early_bird_verified_reader_principal_unsafe",
    );
  } finally {
    await client.query("reset session authorization");
    client.release();
  }
}, 120_000);
