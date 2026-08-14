import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, createDb } from "../../packages/db/src/client.js";
import { PostgresYooKassaOperationRepository } from "../../packages/db/src/repositories/yookassa-operation-repository.js";

const schema = "yookassa_task2_test";
const connectionString = process.env.II_TONYA_TEST_POSTGRES_ADMIN_URL;
if (!connectionString) throw new Error("test_database_unavailable");

const isolatedUrl = new URL(connectionString);
isolatedUrl.searchParams.set("options", `-c search_path=${schema},public`);
const db = createDb(isolatedUrl.toString());
const repository = new PostgresYooKassaOperationRepository(db);

const orderId = "00000000-0000-4000-8000-000000000301";
const attemptId = "00000000-0000-4000-8000-000000000302";
const commandId = "00000000-0000-4000-8000-000000000303";
const requestDigest = `sha256:${"c".repeat(64)}`;

describe("YooKassa operation concurrency on the shared Claw test database", () => {
  beforeAll(async () => {
    await db.execute(
      sql`drop table if exists expert_residency_provider_operations, expert_residency_payment_attempts, expert_residency_orders cascade`,
    );
    await db.execute(
      sql.raw(`
      create table expert_residency_orders (id uuid primary key);
      create table expert_residency_payment_attempts (
        id uuid primary key,
        order_id uuid not null references expert_residency_orders(id),
        unique (id, order_id)
      );
    `),
    );
    const migration = await readFile(
      "packages/db/migrations/0023_yookassa_provider_operations.sql",
      "utf8",
    );
    await db.execute(sql.raw(migration));
  });

  beforeEach(async () => {
    await db.execute(
      sql`truncate expert_residency_provider_operations, expert_residency_payment_attempts, expert_residency_orders`,
    );
    await db.execute(
      sql`insert into expert_residency_orders (id) values (${orderId}::uuid)`,
    );
    await db.execute(
      sql`insert into expert_residency_payment_attempts (id, order_id) values (${attemptId}::uuid,${orderId}::uuid)`,
    );
  });

  afterAll(async () => {
    await db.execute(
      sql`drop table if exists expert_residency_provider_operations, expert_residency_payment_attempts, expert_residency_orders cascade`,
    );
    await closeDb(db);
  });

  it("returns one durable claim under eight concurrent identical commands", async () => {
    const command = {
      commandId,
      orderId,
      paymentAttemptId: attemptId,
      kind: "create_payment" as const,
      mode: "test" as const,
      amountMinor: "50000",
      currency: "RUB" as const,
      requestDigest,
    };
    const claims = await Promise.all(
      Array.from({ length: 8 }, () => repository.claim(command)),
    );

    expect(new Set(claims.map(({ id }) => id))).toHaveLength(1);
    expect(
      new Set(claims.map(({ idempotencyKey }) => idempotencyKey)),
    ).toHaveLength(1);
    const rows = await db.execute<{ count: number }>(
      sql`select count(*)::int as count from expert_residency_provider_operations`,
    );
    expect(rows.rows[0]?.count).toBe(1);
  });

  it("rejects conflicting replay and compare-and-set provider rebinding", async () => {
    const claimed = await repository.claim({
      commandId,
      orderId,
      paymentAttemptId: attemptId,
      kind: "create_payment",
      mode: "test",
      amountMinor: "50000",
      currency: "RUB",
      requestDigest,
    });
    await expect(
      repository.claim({
        commandId,
        orderId,
        paymentAttemptId: attemptId,
        kind: "create_payment",
        mode: "test",
        amountMinor: "50001",
        currency: "RUB",
        requestDigest,
      }),
    ).rejects.toMatchObject({ code: "YOOKASSA_IDEMPOTENCY_CONFLICT" });

    const providerId = randomUUID();
    expect(
      (await repository.bindProviderObject(claimed.id, providerId))
        .providerObjectId,
    ).toBe(providerId);
    await expect(
      repository.bindProviderObject(claimed.id, randomUUID()),
    ).rejects.toMatchObject({ code: "YOOKASSA_PROVIDER_BINDING_CONFLICT" });
  });
});
