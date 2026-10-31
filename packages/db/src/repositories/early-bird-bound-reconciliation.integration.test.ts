import { afterAll, expect, it, vi } from "vitest";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import type { PoolClient } from "pg";
import type { DrizzleDb } from "../client.js";
import { createEarlyBirdOwnerJourney } from "../testkit/early-bird-owner-journey.js";
import { startExpertReferralTestDatabase } from "../testkit/expert-referral.js";
import { startPublicExpertFuturePostgres } from "../../../../tests/support/public-expert-gateway-provider.mjs";
import { PostgresEarlyBirdVerifiedPaymentReader } from "./early-bird-verified-payment-reader.js";
import { PostgresEarlyBirdPaymentSettlementStore } from "./early-bird-payment-settlement-store.js";
import { PostgresDeferredSnapshotReader } from "./early-bird-deferred-snapshot-reader.js";
import { PostgresDeferredVerifiedStore } from "./early-bird-deferred-verified-store.js";
import {
  YooKassaEarlyBirdVerifier,
  YooKassaDeferredVerifier,
  type YooKassaPayment,
} from "@ii-tonya/integrations";
import {
  PostgresEarlyBirdBoundReconciliationSource,
  createEarlyBirdBoundPaymentReconciler,
} from "../../../../apps/api/src/early-bird-bound-reconciliation.js";
const journeys: Awaited<ReturnType<typeof createEarlyBirdOwnerJourney>>[] = [],
  clients: PoolClient[] = [],
  clocks: Awaited<ReturnType<typeof startPublicExpertFuturePostgres>>[] = [];
const NativeDate = Date;
async function journeyOnWaveClock() {
  // Each product keeps its own disposable cluster and isolated capability roles.
  vi.unstubAllGlobals();
  const clock = await startPublicExpertFuturePostgres();
  clocks.push(clock);
  await clock.advance(
    (Date.parse("2026-11-02T12:00:00Z") - Date.parse("2027-01-11T12:00:00Z")) /
      1000,
  );
  vi.stubGlobal(
    "Date",
    new Proxy(NativeDate, {
      construct(target, args) {
        return Reflect.construct(
          target,
          args.length ? args : [NativeDate.now() + clock.offsetSeconds * 1000],
        );
      },
      get(target, property) {
        return property === "now"
          ? () => NativeDate.now() + clock.offsetSeconds * 1000
          : Reflect.get(target, property);
      },
    }),
  );
  const previous = process.env.II_TONYA_TEST_POSTGRES_ADMIN_URL;
  process.env.II_TONYA_TEST_POSTGRES_ADMIN_URL = clock.connectionString;
  try {
    const database = await startExpertReferralTestDatabase();
    try {
      return await createEarlyBirdOwnerJourney({ database });
    } catch (error) {
      try {
        await database.stop();
      } catch (cleanup) {
        throw new AggregateError(
          [error, cleanup],
          "wave_clock_journey_setup_failed",
        );
      }
      throw error;
    }
  } finally {
    if (previous === undefined)
      delete process.env.II_TONYA_TEST_POSTGRES_ADMIN_URL;
    else process.env.II_TONYA_TEST_POSTGRES_ADMIN_URL = previous;
  }
}
afterAll(async () => {
  try {
    for (const c of clients) {
      await c.query("reset session authorization");
      c.release();
    }
    for (const f of journeys) await f.db.stop();
  } finally {
    try {
      for (const clock of clocks) await clock.stop();
    } finally {
      vi.unstubAllGlobals();
    }
  }
}, 120000);
async function principal(
  db: DrizzleDb,
  cap: string,
  login: string,
  fn: string,
) {
  await db.execute(
    sql.raw(
      `DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='${cap}') THEN CREATE ROLE ${cap} NOLOGIN NOINHERIT; END IF; END $$; CREATE ROLE ${login} LOGIN INHERIT; GRANT ${cap} TO ${login}; GRANT USAGE ON SCHEMA public,early_bird_private TO ${cap}; GRANT EXECUTE ON FUNCTION ${fn} TO ${cap}`,
    ),
  );
  const c = await db.$client.connect();
  clients.push(c);
  await c.query(`set session authorization ${login}`);
  return drizzle(c) as unknown as DrizzleDb;
}
it("accounts missed-callback composite and deferred captures with real isolated stores exactly once", async () => {
  for (const product of ["composite", "deferred"] as const) {
    const f = await journeyOnWaveClock();
    journeys.push(f);
    const db = f.db.db;
    const invoice =
        product === "composite" ? f.identity.invoiceId : crypto.randomUUID(),
      providerId = "poll_" + product;
    if (product === "composite") {
      await db.execute(
        sql`update early_bird_composite_intents set status='unknown' where id=${f.identity.operationId}::uuid`,
      );
      await db.execute(
        sql`insert into early_bird_verified_bindings(intent_id,user_id,provider_object_id,evidence_digest) values(${f.identity.operationId}::uuid,${f.user}::uuid,${providerId},${"sha256:" + "a".repeat(64)})`,
      );
    } else {
      await db.execute(
        sql`update early_bird_composite_intents set status='abandoned' where id=${f.identity.operationId}::uuid`,
      );
      const choice = (
        await db.execute<{ id: string }>(
          sql`insert into early_bird_choices(user_id,base_id,positive_choice_id,revision,choice,request_key,request_digest) select user_id,base_id,positive_choice_id,revision,'later','poll-later',${"b".repeat(64)} from early_bird_choices where id=${f.choice}::uuid returning id`,
        )
      ).rows[0]!.id;
      const account = crypto.randomUUID();
      await db.execute(
        sql`select early_bird_deferred_prepare(${account}::uuid,${f.user}::uuid,${f.base}::uuid,${choice}::uuid,(select config_id from early_bird_composite_intents where id=${f.identity.operationId}::uuid))`,
      );
      await db.execute(
        sql`select early_bird_deferred_invoice(${account}::uuid,${f.user}::uuid,${invoice}::uuid,${crypto.randomUUID()}::uuid,'onboarding')`,
      );
      await db.execute(
        sql`update early_bird_deferred_invoices set dispatch_started_at=clock_timestamp() where id=${invoice}::uuid`,
      );
    }
    const timing = (
      await db.execute<{
        quoted: Date | string;
        expires: Date | string;
        created: Date | string;
      }>(
        sql`select quoted_at as quoted,expires_at as expires,clock_timestamp() as created from early_bird_composite_intents where id=${f.identity.operationId}::uuid`,
      )
    ).rows[0]!;
    const createdAt = new NativeDate(timing.created).toISOString();
    const capturedAt = new NativeDate(
      (
        await db.execute<{ at: Date | string }>(
          sql`select clock_timestamp() as at`,
        )
      ).rows[0]!.at,
    ).toISOString();
    const databaseNow = new NativeDate(
      (
        await db.execute<{ at: Date | string }>(
          sql`select clock_timestamp() as at`,
        )
      ).rows[0]!.at,
    ).getTime();
    expect(Date.parse(createdAt)).toBeGreaterThanOrEqual(
      new NativeDate(timing.quoted).getTime(),
    );
    expect(Date.parse(capturedAt)).toBeGreaterThanOrEqual(
      Date.parse(createdAt),
    );
    expect(Date.parse(capturedAt)).toBeLessThanOrEqual(databaseNow);
    expect(Date.parse(capturedAt)).toBeLessThan(
      new NativeDate(timing.expires).getTime(),
    );
    expect(Math.abs(databaseNow - Date.now())).toBeLessThan(1500);
    let succeeded = false;
    const getPayment = vi.fn(async (id: string) => {
      expect(id).toBe(providerId);
      return {
        id,
        status: succeeded ? "succeeded" : "pending",
        paid: succeeded,
        test: false,
        refundable: succeeded,
        createdAt,
        ...(succeeded ? { capturedAt } : {}),
        amount: {
          value: product === "composite" ? "30.00" : "10.00",
          currency: "RUB",
        },
        metadata: {
          order_id: invoice,
          operation_id:
            product === "composite" ? f.identity.operationId : invoice,
          user_id: f.user,
          purpose:
            product === "composite"
              ? "combined_early_bird"
              : "early_bird_deferred",
          pricing_policy: "owner_test_10_20_v1",
          pricing_grant_id: f.grant,
          ...(product === "composite"
            ? { price_kind: "fixed_test" }
            : { stage: "onboarding" }),
        },
      } as YooKassaPayment;
    });
    const readDb = await principal(
      db,
      "ii_tonya_wave_verified_payment_reader",
      "poll_read_" + product,
      "early_bird_private.find_verified_payment(text,text)",
    );
    const settleDb = await principal(
      db,
      "ii_tonya_wave_settlement_writer",
      "poll_settle_" + product,
      "public.early_bird_commit_verified_payment(jsonb,text,timestamptz)",
    );
    const snapshotDb = await principal(
      db,
      "ii_tonya_deferred_invoice_reader",
      "poll_snapshot_" + product,
      "public.early_bird_deferred_read_invoice(uuid)",
    );
    const bindDb = await principal(
      db,
      "ii_tonya_deferred_binding_writer",
      "poll_bind_" + product,
      "public.early_bird_deferred_bind_verified(uuid,uuid,text,bigint,text)",
    );
    const deferredSettleDb = await principal(
      db,
      "ii_tonya_deferred_settlement_writer",
      "poll_deferred_" + product,
      "public.early_bird_deferred_commit_verified(uuid,uuid,text,bigint,text,timestamptz)",
    );
    const verifier = new YooKassaEarlyBirdVerifier(
      { getPayment },
      new PostgresEarlyBirdVerifiedPaymentReader(
        readDb,
        "poll_read_" + product,
      ),
    );
    const deferredVerifier = new YooKassaDeferredVerifier(
      { getPayment },
      new PostgresDeferredSnapshotReader(
        snapshotDb,
        "poll_snapshot_" + product,
      ),
    );
    const compositeStore = new PostgresEarlyBirdPaymentSettlementStore(
      settleDb,
      verifier,
      "poll_settle_" + product,
    );
    const deferredStore = new PostgresDeferredVerifiedStore(
      bindDb,
      deferredSettleDb,
      deferredVerifier,
      "poll_bind_" + product,
      "poll_deferred_" + product,
    );
    if (product === "deferred")
      await deferredStore.bind(
        await deferredVerifier.verify(invoice, providerId),
      );
    const source = new PostgresEarlyBirdBoundReconciliationSource(db),
      reconcile = createEarlyBirdBoundPaymentReconciler({
        compositeVerifier: verifier,
        compositeStore,
        deferredVerifier,
        deferredStore,
      });
    const rows = await source.list(undefined, 10);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ product, providerId, ambiguous: false });
    await reconcile(rows[0]!, () => true);
    expect(await source.list(undefined, 10)).toHaveLength(1);
    succeeded = true;
    await reconcile(rows[0]!, () => true);
    await reconcile(rows[0]!, () => true);
    expect(await source.list(undefined, 10)).toHaveLength(0);
    const count =
      product === "composite"
        ? await db.execute<{ n: number }>(
            sql`select count(*)::int as n from early_bird_payment_successes where intent_id=${f.identity.operationId}::uuid`,
          )
        : await db.execute<{ n: number }>(
            sql`select count(*)::int as n from early_bird_deferred_invoices where id=${invoice}::uuid and captured_at is not null`,
          );
    expect(count.rows[0]!.n).toBe(1);
    expect(getPayment).toHaveBeenCalled();
  }
}, 120000);
