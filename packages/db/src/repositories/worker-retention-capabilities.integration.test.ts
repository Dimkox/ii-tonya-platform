import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, it } from "vitest";
import { createDb, closeDb, type DrizzleDb } from "../client.js";
import {
  startDisposableTestPostgres,
  type TestDatabase,
} from "../testkit/postgres.js";
import { PostgresWorkerReceiptRetention } from "./early-bird-worker-receipt-retention.js";
let fixture: TestDatabase;
let worker: DrizzleDb;
beforeAll(async () => {
  fixture = await startDisposableTestPostgres();
  // The full journal installs the reviewed worker functions in canonical 0082.
  await fixture.migrate();
  await fixture.db.$client.query(
    `create role test_retention login password 'synthetic'; grant usage on schema public to test_retention; grant execute on function public.early_bird_wave_retention_list(integer), public.early_bird_wave_retention_expire(uuid,uuid), public.early_bird_worker_review_list(uuid,integer), public.early_bird_worker_review_resolve(uuid,uuid) to test_retention`,
  );
  const url = new URL(fixture.db.$client.options.connectionString!);
  url.username = "test_retention";
  url.password = "synthetic";
  worker = createDb(url.toString());
}, 120000);
afterAll(async () => {
  if (worker) await closeDb(worker);
  await fixture?.stop();
}, 120000);
it("requires durable gateway revocation and denies direct contact mutation", async () => {
  const user = await fixture.createUser(),
    id = randomUUID(),
    choice = randomUUID();
  const client = await fixture.db.$client.connect();
  try {
    await client.query("set session_replication_role = replica");
    await client.query(
      `insert into early_bird_receipt_contacts(id,user_id,choice_id,idempotency_key,captured_at,expires_at,key_id,ciphertext) values($1,$2,$3,'fixture-key-1',date_trunc('milliseconds',clock_timestamp()-interval '2 hours'),date_trunc('milliseconds',clock_timestamp()-interval '1 hour'),'v1','prc1.'||repeat('a',40))`,
      [id, user, choice],
    );
  } finally {
    await client.query("set session_replication_role = origin");
    client.release();
  }
  expect(
    (
      await worker.$client.query(
        "select * from early_bird_wave_retention_list(100)",
      )
    ).rows,
  ).toEqual([{ id, user_id: user }]);
  expect(
    (
      await worker.$client.query(
        "select early_bird_wave_retention_expire($1,$2) as expired",
        [id, user],
      )
    ).rows[0].expired,
  ).toBe(false);
  await expect(
    worker.$client.query(
      "delete from early_bird_receipt_contacts where id=$1",
      [id],
    ),
  ).rejects.toMatchObject({ code: "42501" });
  await fixture.db.$client.query("select early_bird_gateway_revoke($1)", [id]);
  expect(
    (
      await worker.$client.query(
        "select early_bird_wave_retention_expire($1,$2) as expired",
        [id, user],
      )
    ).rows[0].expired,
  ).toBe(true);
}, 120000);

it("review capabilities run on the canonical schema without granting access to source tables", async () => {
  expect(
    (
      await worker.$client.query(
        "select * from early_bird_worker_review_list(null, 100)",
      )
    ).rows,
  ).toEqual([]);
  expect(
    (
      await worker.$client.query(
        "select * from early_bird_worker_review_resolve($1,$2)",
        [randomUUID(), randomUUID()],
      )
    ).rows,
  ).toEqual([]);
  await expect(
    worker.$client.query("select * from resident_review_events"),
  ).rejects.toMatchObject({ code: "42501" });
}, 120000);

it("the actual retention adapter accepts only its dedicated capability role", async () => {
  await fixture.db.$client
    .query(`create role ii_tonya_worker_wave_retention nologin noinherit;
    create role test_worker_adapter login password 'synthetic';
    grant ii_tonya_worker_wave_retention to test_worker_adapter;
    grant usage on schema public to ii_tonya_worker_wave_retention;
    grant execute on function public.early_bird_wave_retention_list(integer), public.early_bird_wave_retention_expire(uuid,uuid) to ii_tonya_worker_wave_retention`);
  const url = new URL(fixture.db.$client.options.connectionString!);
  url.username = "test_worker_adapter";
  url.password = "synthetic";
  const db = createDb(url.toString());
  try {
    const repository = new PostgresWorkerReceiptRetention(
      db,
      "test_worker_adapter",
      "wave",
    );
    expect(await repository.listExpired()).toEqual([]);
    await fixture.db.$client.query(
      "grant select on public.users to test_worker_adapter",
    );
    await expect(repository.listExpired()).rejects.toThrow(
      "early_bird_worker_review_principal_unsafe",
    );
  } finally {
    await closeDb(db);
  }
}, 120000);
