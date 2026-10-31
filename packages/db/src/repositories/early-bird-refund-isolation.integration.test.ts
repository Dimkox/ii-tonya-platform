import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { startTestPostgres, type TestDatabase } from "../testkit/postgres.js";
let fixture: TestDatabase;
beforeAll(async () => {
  fixture = await startTestPostgres();
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
    sql`create table early_bird_composite_intents(id uuid primary key, invoice_id uuid not null, user_id uuid not null, provider_mode text not null, pricing_policy text not null, price_kind text not null, onboarding_minor bigint not null, subscription_minor bigint not null, total_minor bigint not null, base_offer_shown_at timestamptz not null, expires_at timestamptz not null, launch_at timestamptz not null, status text not null, unique(id,user_id))`,
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
}, 120_000);
afterAll(async () => {
  await fixture?.stop();
}, 120_000);
for (const isolation of ["REPEATABLE READ", "SERIALIZABLE"] as const) {
  for (const firstKind of ["partial", "full", "partial_compatible"] as const) {
    it(`${isolation}: stale snapshot retries safely after overlapping ${firstKind} refund`, async () => {
      const user = randomUUID(),
        intent = randomUUID(),
        payment = `payment-${randomUUID()}`,
        evidence = `sha256:${"a".repeat(64)}`;
      await fixture.db.execute(sql`insert into users values(${user}::uuid)`);
      await fixture.db.execute(
        sql`insert into early_bird_composite_intents values(${intent}::uuid,${randomUUID()}::uuid,${user}::uuid,'live','wave1_standard_v1','full_price',300000,1000000,1300000,'2026-01-01Z','2026-01-11Z','2027-01-11T00:00:00+03:00','unknown')`,
      );
      await fixture.db.execute(
        sql`insert into early_bird_verified_bindings values(${intent}::uuid,${user}::uuid,${payment})`,
      );
      await fixture.db.execute(
        sql`select early_bird_record_success(${intent}::uuid,${user}::uuid,${payment},${evidence},'2026-01-12T00:00:00Z'::timestamptz)`,
      );
      const a = await fixture.db.$client.connect(),
        b = await fixture.db.$client.connect();
      const callPartial =
        "select early_bird_record_refund_reconciliation($1::uuid,$2::uuid,$3::uuid,$4,$5,$6::bigint,$7)";
      const callFull =
        "select early_bird_record_full_refund($1::uuid,$2::uuid,$3,$4,$5::bigint,$6::timestamptz)";
      const paramsA = [
        randomUUID(),
        intent,
        user,
        payment,
        `first-${randomUUID()}`,
        firstKind === "partial_compatible" ? 400000 : 800000,
        evidence,
      ];
      const paramsB = [
        randomUUID(),
        intent,
        user,
        payment,
        `second-${randomUUID()}`,
        firstKind === "partial_compatible" ? 400000 : 800000,
        evidence,
      ];
      try {
        await a.query("begin");
        await a.query(
          "select pg_advisory_xact_lock(hashtextextended($1::text,0))",
          [user],
        );
        await b.query(`begin isolation level ${isolation}`);
        await b.query(
          "select count(*) from early_bird_refund_registry where intent_id=$1",
          [intent],
        );
        const pid = (
          await b.query<{ pid: number }>("select pg_backend_pid() as pid")
        ).rows[0]!.pid;
        const pending = b.query(callPartial, paramsB).then(
          () => null,
          (error: unknown) => error,
        );
        let blocked = false;
        for (let i = 0; i < 100; i++) {
          const result = await fixture.db.execute<{ waiting: boolean }>(
            sql`select exists(select 1 from pg_stat_activity where pid=${pid} and wait_event_type='Lock' and wait_event='advisory') as waiting`,
          );
          if (result.rows[0]?.waiting) {
            blocked = true;
            break;
          }
          await new Promise((resolve) => setTimeout(resolve, 10));
        }
        expect(blocked).toBe(true);
        if (firstKind !== "full") await a.query(callPartial, paramsA);
        else
          await a.query(callFull, [
            intent,
            user,
            `full-${randomUUID()}`,
            evidence,
            1300000,
            "2026-01-13T00:00:00Z",
          ]);
        await a.query("commit");
        expect(await pending).toMatchObject({ code: "40001" });
        await b.query("rollback");
        await b.query(`begin isolation level ${isolation}`);
        if (firstKind === "partial_compatible") {
          await b.query(callPartial, paramsB);
          await b.query("commit");
        } else {
          await expect(b.query(callPartial, paramsB)).rejects.toThrow(
            firstKind === "partial"
              ? "early_bird_refund_total_exceeded"
              : "early_bird_refund_source",
          );
          await b.query("rollback");
        }
        const total = await fixture.db.execute<{ total: string }>(
          sql`select sum(amount_minor)::text as total from early_bird_refund_registry where intent_id=${intent}::uuid`,
        );
        expect(total.rows[0]!.total).toBe(
          firstKind === "full" ? "1300000" : "800000",
        );
      } finally {
        await a.query("rollback");
        await b.query("rollback");
        a.release();
        b.release();
      }
    }, 120_000);
  }
}
