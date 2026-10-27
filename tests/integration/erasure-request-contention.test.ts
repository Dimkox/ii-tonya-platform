import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, it } from "vitest";
import { sql, type SQL } from "drizzle-orm";
import {
  createDb,
  closeDb,
  type DrizzleDb,
} from "../../packages/db/src/client.js";
import {
  startTestPostgres,
  type TestDatabase,
} from "../../packages/db/src/testkit/postgres.js";
import { PostgresErasureRequestRepository } from "../../packages/db/src/repositories/erasure-request-repository.js";
import { createErasureRequestService } from "../../packages/application/src/erasure-request-service.js";

let fixture: TestDatabase;
let single: DrizzleDb;
const applicationName = `erasure-contention-${randomUUID()}`;
let repo: PostgresErasureRequestRepository;
let service: ReturnType<typeof createErasureRequestService>;
const receipt = `er1.${"A".repeat(43)}`;
const command = (userId: string) => ({
  principalUserId: userId,
  targetUserId: userId,
  receiptToken: receipt,
});

beforeAll(async () => {
  fixture = await startTestPostgres();
  expect(
    (await fixture.db.execute(sql`show server_version_num`)).rows[0],
  ).toEqual({ server_version_num: "170005" });
  await fixture.migrate();
  const connection = new URL(fixture.db.$client.options.connectionString!);
  connection.searchParams.set("application_name", applicationName);
  single = createDb(connection.toString());
  // Configure before acquiring any client. A nested verifier transaction cannot
  // borrow a second connection, making the same-transaction requirement observable.
  single.$client.options.max = 1;
  single.$client.options.connectionTimeoutMillis = 3500;
  repo = new PostgresErasureRequestRepository(single);
  service = createErasureRequestService({
    repository: repo,
    requestEnabled: true,
  });
}, 180000);
afterAll(async () => {
  if (single) await closeDb(single);
  await fixture?.stop();
});

async function hold(lock: SQL) {
  const client = await fixture.db.$client.connect();
  await client.query("begin");
  // Use Drizzle to render parameters without string interpolation into SQL.
  const { PgDialect } = await import("drizzle-orm/pg-core");
  const query = new PgDialect().sqlToQuery(lock);
  await client.query(query.sql, query.params);
  let released = false;
  const release = async () => {
    if (released) return;
    released = true;
    clearTimeout(safetyRelease);
    try {
      await client.query("rollback");
    } finally {
      client.release();
    }
  };
  // Test safety only: production must reject BEFORE this releases the lock.
  // Never race away from an operation or leave a blocked DB query behind.
  const safetyRelease = setTimeout(() => {
    void release();
  }, 6000);
  return { release, released: () => released };
}

async function idleAndSettingsRestored() {
  const activity = await fixture.db.execute<{
    state: string;
    transaction: unknown;
  }>(sql`
    select state,xact_start as transaction from pg_stat_activity
    where application_name=${applicationName} and datname=current_database()
  `);
  expect(activity.rows).toEqual([{ state: "idle", transaction: null }]);
  expect((await single.execute(sql`show lock_timeout`)).rows[0]).toEqual({
    lock_timeout: "0",
  });
  expect((await single.execute(sql`show statement_timeout`)).rows[0]).toEqual({
    statement_timeout: "0",
  });
}

it("bounds subject-row contention, sanitizes failure and frees the sole connection for another owner", async () => {
  const owner = await fixture.createUser();
  const other = await fixture.createUser();
  const blocker = await hold(
    sql`select id from users where id=${owner}::uuid for update`,
  );
  try {
    const started = performance.now();
    expect(await service.request(command(owner))).toEqual({
      kind: "unavailable",
    });
    expect(performance.now() - started).toBeLessThan(2500);
    expect(blocker.released()).toBe(false);
    await idleAndSettingsRestored();
    expect(
      (
        await service.request({
          ...command(other),
          receiptToken: `er1.${"B".repeat(42)}A`,
        })
      ).kind,
    ).toBe("accepted");
    expect(await repo.findOwned(owner)).toBeNull();
  } finally {
    await blocker.release();
  }
  expect((await service.request(command(owner))).kind).toBe("accepted");
}, 15000);

it("bounds job-row contention and verifies recovery inside the sole bounded transaction", async () => {
  const owner = await fixture.createUser();
  const token = `er1.${"C".repeat(42)}A`;
  const accepted = await service.request({
    ...command(owner),
    receiptToken: token,
  });
  expect(accepted.kind).toBe("accepted");
  const jobId = randomUUID();
  await fixture.db
    .execute(sql`insert into privacy_deletion_jobs(id,user_id,idempotency_key,status,erasure_receipt)
    values (${jobId}::uuid,${owner}::uuid,${jobId},'pending','{"ledgerFactsPreserved":2,"auditFactsPreserved":3}'::jsonb)`);
  await fixture.db.execute(
    sql`update client_erasure_requests set job_id=${jobId}::uuid where user_id=${owner}::uuid`,
  );
  const blocker = await hold(
    sql`select id from privacy_deletion_jobs where id=${jobId}::uuid for update`,
  );
  try {
    const started = performance.now();
    expect(await service.readReceipt(token)).toEqual({ kind: "unavailable" });
    expect(performance.now() - started).toBeLessThan(2500);
    expect(blocker.released()).toBe(false);
    await idleAndSettingsRestored();
    const other = await fixture.createUser();
    expect(
      (
        await service.request({
          ...command(other),
          receiptToken: `er1.${"D".repeat(42)}A`,
        })
      ).kind,
    ).toBe("accepted");
  } finally {
    await blocker.release();
  }
  const started = performance.now();
  expect(await service.readReceipt(token)).toMatchObject({
    kind: "found",
    request: {
      stage: "deleting",
      retainedFacts: { ledgerFactsPreserved: 2, auditFactsPreserved: 3 },
    },
  });
  expect(performance.now() - started).toBeLessThan(2500);
  await idleAndSettingsRestored();
}, 15000);

it("bounds owner, receipt and pending reads behind a table lock without leaking storage errors", async () => {
  const owner = await fixture.createUser();
  const token = `er1.${"E".repeat(42)}A`;
  expect(
    (await service.request({ ...command(owner), receiptToken: token })).kind,
  ).toBe("accepted");
  const blocker = await hold(
    sql`lock table client_erasure_requests in access exclusive mode`,
  );
  try {
    for (const action of [
      () => service.readOwned(command(owner)),
      () => service.readReceipt(token),
      async () => {
        try {
          await repo.pendingRequests(10);
          return "unexpected_success";
        } catch (error) {
          return (error as Error).message;
        }
      },
    ]) {
      const started = performance.now();
      const result = await action();
      expect(result).toEqual(
        typeof result === "string"
          ? "erasure_storage_unavailable"
          : { kind: "unavailable" },
      );
      expect(performance.now() - started).toBeLessThan(2500);
      expect(blocker.released()).toBe(false);
      await idleAndSettingsRestored();
    }
  } finally {
    await blocker.release();
  }
  expect((await service.readReceipt(token)).kind).toBe("found");
  expect(
    (await repo.pendingRequests(100)).some((row) => row.userId === owner),
  ).toBe(true);
}, 20000);
