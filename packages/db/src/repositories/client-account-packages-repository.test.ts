import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { readMigrationFiles } from "drizzle-orm/migrator";
import type { DrizzleDb } from "../client.js";
import { startTestPostgres, type TestDatabase } from "../testkit/postgres.js";
import { PostgresClientAccountPackagesRepository } from "./client-account-packages-repository.js";

let fixture: TestDatabase;
beforeAll(async () => {
  fixture = await startTestPostgres();
  const version = await fixture.db.execute<{ version: string }>(
    sql`select current_setting('server_version_num') as version`,
  );
  expect(version.rows[0]?.version).toBe("170005");
  // Replay the real hand-authored history only through the deployed 0041 schema.
  const migrations = readMigrationFiles({
    migrationsFolder: "packages/db/migrations",
  }).slice(0, 42);
  await fixture.db.transaction(async (tx) => {
    for (const migration of migrations)
      for (const statement of migration.sql)
        await tx.execute(sql.raw(statement));
  });
  expect(
    (
      await fixture.db.execute<{ absent: boolean }>(
        sql`select to_regclass('client_paid_orders') is null as absent`,
      )
    ).rows[0]?.absent,
  ).toBe(true);
});
afterAll(async () => {
  await fixture?.stop();
});
async function grant(
  user: string,
  units = 10,
  expiresAt: string | null = null,
) {
  const id = randomUUID();
  await fixture.db
    .execute(sql`insert into message_packages (id, user_id, granted_messages, grant_idempotency_key, expires_at)
    values (${id}::uuid, ${user}::uuid, ${units}, ${randomUUID()}, ${expiresAt}::timestamptz)`);
  await fixture.appendGrantFact(id, units, randomUUID());
  return id;
}
it("reads ledger debits, isolates owners and prioritizes active packages", async () => {
  const user = await fixture.createUser();
  const other = await fixture.createUser();
  const active = await grant(user);
  await fixture.appendMessageDebit(active, randomUUID(), randomUUID());
  const expired = await grant(user, 10, "2020-01-01T00:00:00.000Z");
  const exhausted = await grant(user, 1);
  await fixture.appendMessageDebit(exhausted, randomUUID(), randomUUID());
  await grant(other, 100);
  const result = await new PostgresClientAccountPackagesRepository(
    fixture.db,
  ).read(user);
  expect(result.totalRemainingUnits).toBe("9");
  expect(result.packages).toHaveLength(3);
  expect(result.packages[0]).toMatchObject({
    id: active,
    remainingUnits: "9",
    expiresAt: null,
    status: "active",
  });
  expect(result.packages.find((p) => p.id === expired)?.status).toBe("expired");
  expect(result.packages.find((p) => p.id === exhausted)?.status).toBe(
    "exhausted",
  );
});
it("bounds the list but totals all packages and rejects corruption beyond the limit", async () => {
  const user = await fixture.createUser();
  for (let i = 0; i < 51; i++) await grant(user, 1);
  const repo = new PostgresClientAccountPackagesRepository(fixture.db);
  const result = await repo.read(user);
  expect(result.totalRemainingUnits).toBe("51");
  expect(result.hasMore).toBe(true);
  expect(result.packages).toHaveLength(50);
  expect(await repo.read(user)).toMatchObject({ packages: result.packages });
  const corrupt = await fixture.createLedgerPackage(user, randomUUID(), 1);
  await fixture.appendMessageDebit(corrupt, randomUUID(), randomUUID());
  await expect(repo.read(user)).rejects.toThrow();
});
it("returns a known empty balance and rejects invalid user ids", async () => {
  const repo = new PostgresClientAccountPackagesRepository(fixture.db);
  expect(await repo.read(await fixture.createUser())).toMatchObject({
    totalRemainingUnits: "0",
    hasMore: false,
    packages: [],
  });
  await expect(repo.read("invalid")).rejects.toThrow();
});
it("treats exact database timestamp expiry as expired before exhaustion", async () => {
  const user = await fixture.createUser();
  const id = randomUUID();
  await fixture.db.transaction(async (tx) => {
    await tx.execute(sql`insert into message_packages (id, user_id, granted_messages, grant_idempotency_key, expires_at)
      values (${id}::uuid, ${user}::uuid, 1, ${randomUUID()}, transaction_timestamp())`);
    const result = await new PostgresClientAccountPackagesRepository(
      tx as unknown as DrizzleDb,
    ).read(user);
    expect(result.packages[0]).toMatchObject({
      expiresAt: result.asOf,
      status: "expired",
      remainingUnits: "0",
    });
    expect(result.totalRemainingUnits).toBe("0");
  });
});
it("bounds lock waits and remains usable after timeout", async () => {
  const user = await fixture.createUser();
  await grant(user);
  const connection = await fixture.db.$client.connect();
  try {
    await connection.query("begin");
    await connection.query(
      "lock table message_packages in access exclusive mode",
    );
    await expect(
      new PostgresClientAccountPackagesRepository(fixture.db).read(user),
    ).rejects.toThrow("client_packages_unavailable");
  } finally {
    await connection.query("rollback");
    connection.release();
  }
  expect(
    (await new PostgresClientAccountPackagesRepository(fixture.db).read(user))
      .totalRemainingUnits,
  ).toBe("10");
});
