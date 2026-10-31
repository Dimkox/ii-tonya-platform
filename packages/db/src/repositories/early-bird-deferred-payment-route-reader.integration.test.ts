import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import type { DrizzleDb } from "../client.js";
import {
  startDisposableTestPostgres,
  type TestDatabase,
} from "../testkit/postgres.js";
import { PostgresDeferredPaymentRouteReader } from "./early-bird-deferred-payment-route-reader.js";

let fixture: TestDatabase;
beforeAll(async () => {
  fixture = await startDisposableTestPostgres();
  await fixture.db.execute(
    sql.raw(`
    create table early_bird_deferred_invoices(id uuid primary key,user_id uuid not null,dispatch_started_at timestamptz,captured_at timestamptz);
    create table early_bird_deferred_verified_bindings(invoice_id uuid primary key,user_id uuid not null,provider_id text not null unique);
    create table expert_sales_erased_cohorts(user_id uuid primary key);
  `),
  );
  const draft = readFileSync(
    "docs/superpowers/implementation-artifacts/drafts/0088_early_bird_deferred_payments.sql",
    "utf8",
  );
  const start = draft.indexOf(
    "CREATE FUNCTION early_bird_deferred_payment_lookup(",
  );
  if (start < 0) throw new Error("lookup_missing");
  await fixture.db.execute(sql.raw(draft.slice(start)));
}, 120_000);
afterAll(async () => {
  await fixture?.stop();
}, 120_000);

it("routes a verified pre-settlement binding only through an isolated principal", async () => {
  const user = randomUUID(),
    invoice = randomUUID();
  await fixture.db.execute(
    sql`insert into early_bird_deferred_invoices values(${invoice}::uuid,${user}::uuid,clock_timestamp(),null)`,
  );
  await fixture.db.execute(
    sql`insert into early_bird_deferred_verified_bindings values(${invoice}::uuid,${user}::uuid,'pending-pay')`,
  );
  await fixture.db.execute(
    sql`create role ii_tonya_deferred_payment_route_reader nologin noinherit`,
  );
  await fixture.db.execute(sql`create role deferred_route_login login inherit`);
  await fixture.db.execute(
    sql`grant ii_tonya_deferred_payment_route_reader to deferred_route_login`,
  );
  await fixture.db.execute(
    sql`grant execute on function early_bird_deferred_payment_lookup(text) to ii_tonya_deferred_payment_route_reader`,
  );
  const client = await fixture.db.$client.connect();
  try {
    await client.query("set session authorization deferred_route_login");
    const reader = new PostgresDeferredPaymentRouteReader(
      drizzle(client) as unknown as DrizzleDb,
      "deferred_route_login",
    );
    expect(await reader.findByProviderPayment("pending-pay")).toEqual({
      invoiceId: invoice,
      providerId: "pending-pay",
    });
    expect(await reader.findByProviderPayment("missing")).toBeNull();
    await fixture.db.execute(
      sql`insert into expert_sales_erased_cohorts values(${user}::uuid)`,
    );
    expect(await reader.findByProviderPayment("pending-pay")).toBeNull();
    await fixture.db.execute(
      sql`grant select on early_bird_deferred_invoices to deferred_route_login`,
    );
    await expect(reader.findByProviderPayment("pending-pay")).rejects.toThrow(
      "early_bird_deferred_principal_unsafe",
    );
  } finally {
    await client.query("reset session authorization");
    client.release();
  }
}, 120_000);
