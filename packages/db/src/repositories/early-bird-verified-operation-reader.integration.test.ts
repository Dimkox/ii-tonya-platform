import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, expect, it } from "vitest";
import type { DrizzleDb } from "../client.js";
import {
  startDisposableTestPostgres,
  type TestDatabase,
} from "../testkit/postgres.js";
import { PostgresEarlyBirdVerifiedPaymentReader } from "./early-bird-verified-payment-reader.js";

let fixture: TestDatabase;
let limited: Pool;
beforeAll(async () => {
  // Isolated cluster: role definitions cannot collide with other test workers.
  fixture = await startDisposableTestPostgres();
  await fixture.db.execute(
    sql.raw(`
    create table early_bird_composite_intents(id uuid primary key,invoice_id uuid not null unique,user_id uuid not null,grant_id uuid,provider_mode text not null,pricing_policy text not null,price_kind text not null,onboarding_minor bigint not null,subscription_minor bigint not null,total_minor bigint not null,base_offer_shown_at timestamptz not null,expires_at timestamptz not null,launch_at timestamptz not null,status text not null,unique(id,user_id));
    create table early_bird_verified_bindings(intent_id uuid primary key,user_id uuid not null,provider_object_id text not null unique);
    create schema early_bird_private;
    revoke all on schema early_bird_private from public;
  `),
  );
  await fixture.db.execute(
    sql.raw(
      readFileSync(
        "docs/superpowers/implementation-artifacts/drafts/0084_early_bird_verified_payment_reader.sql",
        "utf8",
      ),
    ),
  );
  await fixture.db.execute(
    sql.raw(`
    create role ii_tonya_wave_verified_payment_reader nologin noinherit;
    create role wave_operation_reader login password 'synthetic-only' inherit nosuperuser nocreatedb nocreaterole nobypassrls;
    grant ii_tonya_wave_verified_payment_reader to wave_operation_reader;
    grant usage on schema early_bird_private to ii_tonya_wave_verified_payment_reader;
    grant execute on function early_bird_private.find_verified_payment(text,text) to ii_tonya_wave_verified_payment_reader;
  `),
  );
  const address = new URL(fixture.db.$client.options.connectionString!);
  address.username = "wave_operation_reader";
  address.password = "synthetic-only";
  limited = new Pool({ connectionString: address.toString(), max: 1 });
}, 120_000);
afterAll(async () => {
  await limited?.end();
  await fixture?.stop();
}, 120_000);

it("recovers only the matching verified operation under the existing restricted reader grant", async () => {
  const operation = randomUUID(),
    invoice = randomUUID(),
    user = randomUUID(),
    unbound = randomUUID();
  await fixture.db.execute(
    sql`insert into early_bird_composite_intents values(${operation}::uuid,${invoice}::uuid,${user}::uuid,null,'live','wave1_standard_v1','full_price',300000,1000000,1300000,'2026-11-01Z','2026-11-11Z','2027-01-11T00:00:00+03:00','unknown'),(${unbound}::uuid,${randomUUID()}::uuid,${user}::uuid,null,'live','wave1_standard_v1','full_price',300000,1000000,1300000,'2026-11-01Z','2026-11-11Z','2027-01-11T00:00:00+03:00','unknown')`,
  );
  await fixture.db.execute(
    sql`insert into early_bird_verified_bindings values(${operation}::uuid,${user}::uuid,'bound-operation-payment')`,
  );
  const reader = new PostgresEarlyBirdVerifiedPaymentReader(
    drizzle(limited) as unknown as DrizzleDb,
    "wave_operation_reader",
  );
  expect(await reader.findBindingByOperation(operation)).toMatchObject({
    operationId: operation,
    invoiceId: invoice,
    userId: user,
    providerObjectId: "bound-operation-payment",
    totalMinor: "1300000",
  });
  expect(await reader.findBindingByOperation(unbound)).toBeNull();
  expect(await reader.findBindingByOperation(randomUUID())).toBeNull();
  // Existing selectors share the same restricted capability.
  expect(
    await reader.findInvoiceByProviderObject("bound-operation-payment"),
  ).toBe(invoice);
  expect(await reader.findEarlyBirdBinding(invoice)).toMatchObject({
    operationId: operation,
  });
  await expect(
    limited.query("select * from early_bird_composite_intents"),
  ).rejects.toMatchObject({ code: "42501" });
  await fixture.db.execute(
    sql`grant select on early_bird_composite_intents to wave_operation_reader`,
  );
  await expect(reader.findBindingByOperation(operation)).rejects.toThrow(
    "early_bird_verified_reader_principal_unsafe",
  );
}, 120_000);
