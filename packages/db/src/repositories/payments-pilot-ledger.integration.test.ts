import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { startTestPostgres, type TestDatabase } from "../testkit/postgres.js";
import { PostgresPaymentsPilotLedger } from "./payments-pilot-ledger.js";

let fixture: TestDatabase;
beforeAll(async () => {
  fixture = await startTestPostgres();
  await fixture.migrate();
}, 120_000);
afterAll(async () => {
  await fixture?.stop();
}, 120_000);

it("serializes an overlapping stale observation behind a terminal payment state", async () => {
  const ledger = new PostgresPaymentsPilotLedger(fixture.db);
  const principalId = randomUUID();
  const providerPaymentId = randomUUID();
  const idempotencyKey = randomUUID();
  await fixture.db.execute(
    sql`insert into users(id) values(${principalId}::uuid)`,
  );
  await ledger.beginCheckout({
    principalId,
    amountMinor: 1000n,
    idempotencyKey,
  });
  await ledger.recordCreated({
    providerPaymentId,
    principalId,
    amountMinor: 1000n,
    idempotencyKey,
  });
  await ledger.recordStatus({
    providerPaymentId,
    principalId,
    status: "succeeded",
  });
  await ledger.recordStatus({
    providerPaymentId,
    principalId,
    status: "pending",
  });
  expect(await ledger.find(providerPaymentId)).toMatchObject({
    status: "succeeded",
  });

  const a = await fixture.db.$client.connect();
  const b = await fixture.db.$client.connect();
  try {
    await a.query("begin");
    await a.query("select pg_advisory_xact_lock(hashtextextended($1,0))", [
      `payments-pilot-payment:${providerPaymentId}`,
    ]);
    await b.query("set lock_timeout='250ms'");
    await expect(
      ledger.recordStatus({
        providerPaymentId,
        principalId,
        status: "canceled",
      }),
    ).rejects.toMatchObject({ cause: { code: "55P03" } });
    await a.query("commit");
    expect(await ledger.find(providerPaymentId)).toMatchObject({
      status: "succeeded",
    });
  } finally {
    await a.query("rollback");
    a.release();
    b.release();
  }
}, 120_000);

it("returns one durable operation key to concurrent checkout retries", async () => {
  const ledger = new PostgresPaymentsPilotLedger(fixture.db);
  const principalId = randomUUID();
  await fixture.db.execute(
    sql`insert into users(id) values(${principalId}::uuid)`,
  );
  const keys = [randomUUID(), randomUUID()];
  const operations = await Promise.all(
    keys.map((idempotencyKey) =>
      ledger.beginCheckout({ principalId, amountMinor: 1000n, idempotencyKey }),
    ),
  );
  expect(operations[0]!.idempotencyKey).toBe(operations[1]!.idempotencyKey);
  expect(keys).toContain(operations[0]!.idempotencyKey);
}, 120_000);

it("starts a new operation only after the previous payment is durably linked", async () => {
  const ledger = new PostgresPaymentsPilotLedger(fixture.db);
  const principalId = randomUUID();
  await fixture.db.execute(
    sql`insert into users(id) values(${principalId}::uuid)`,
  );
  const firstKey = randomUUID();
  const first = await ledger.beginCheckout({
    principalId,
    amountMinor: 1000n,
    idempotencyKey: firstKey,
  });
  expect(
    (
      await ledger.beginCheckout({
        principalId,
        amountMinor: 1000n,
        idempotencyKey: randomUUID(),
      })
    ).idempotencyKey,
  ).toBe(firstKey);
  await ledger.recordCreated({
    principalId,
    amountMinor: 1000n,
    idempotencyKey: first.idempotencyKey,
    providerPaymentId: randomUUID(),
  });
  const secondKey = randomUUID();
  expect(
    (
      await ledger.beginCheckout({
        principalId,
        amountMinor: 1000n,
        idempotencyKey: secondKey,
      })
    ).idempotencyKey,
  ).toBe(secondKey);
}, 120_000);
