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
const commandId = "00000000-0000-4000-8000-000000000303";
const requestDigest = `sha256:${"c".repeat(64)}`;

describe("YooKassa operation concurrency on the shared Claw test database", () => {
  beforeAll(async () => {
    await db.execute(
      sql`drop table if exists expert_residency_provider_operations, expert_residency_payment_attempts, expert_residency_orders cascade`,
    );
    await db.execute(
      sql.raw(`
      create table expert_residency_orders (
        id uuid primary key,
        cash_minor bigint not null,
        currency text not null,
        status text not null
      );
      create table expert_residency_payment_attempts (
        id uuid primary key default gen_random_uuid(),
        order_id uuid not null references expert_residency_orders(id),
        provider text not null,
        provider_request_id text not null,
        expected_amount_minor bigint not null,
        currency text not null,
        status text not null default 'created',
        idempotency_key text not null,
        resolved_at timestamptz,
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now(),
        unique (provider, provider_request_id),
        unique (idempotency_key),
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
      sql`insert into expert_residency_orders (id,cash_minor,currency,status) values (${orderId}::uuid,50000,'RUB','payment_pending')`,
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
    expect(
      new Set(claims.map(({ paymentAttemptId }) => paymentAttemptId)),
    ).toHaveLength(1);
    const attempts = await db.execute<{ count: number }>(
      sql`select count(*)::int as count from expert_residency_payment_attempts where order_id=${orderId}::uuid and provider='yookassa' and expected_amount_minor=50000`,
    );
    expect(attempts.rows[0]?.count).toBe(1);
  });

  it("rejects conflicting replay and compare-and-set provider rebinding", async () => {
    const claimed = await repository.claim({
      commandId,
      orderId,
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
      repository.findByProviderObject(providerId, "create_payment"),
    ).resolves.toMatchObject({ id: claimed.id, providerObjectId: providerId });
    await expect(
      repository.findByProviderObject(providerId, "create_refund"),
    ).resolves.toBeNull();
    const attempt = await db.execute<{
      providerRequestId: string;
      status: string;
    }>(
      sql`select provider_request_id as "providerRequestId",status from expert_residency_payment_attempts where id=${claimed.paymentAttemptId}::uuid`,
    );
    expect(attempt.rows[0]).toEqual({
      providerRequestId: providerId,
      status: "pending",
    });
    await expect(
      repository.bindProviderObject(claimed.id, randomUUID()),
    ).rejects.toMatchObject({ code: "YOOKASSA_PROVIDER_BINDING_CONFLICT" });
  });

  it("rejects cumulative refund claims above captured cash before provider I/O", async () => {
    const payment = await repository.claim({
      commandId,
      orderId,
      kind: "create_payment",
      mode: "test",
      amountMinor: "50000",
      currency: "RUB",
      requestDigest,
    });
    const paymentId = randomUUID();
    await repository.bindProviderObject(payment.id, paymentId);
    await db.execute(
      sql`update expert_residency_payment_attempts set status='settled',resolved_at=now() where id=${payment.paymentAttemptId}::uuid`,
    );

    const firstRefund = await repository.claim({
      commandId: "00000000-0000-4000-8000-000000000304",
      orderId,
      kind: "create_refund",
      mode: "test",
      amountMinor: "40000",
      currency: "RUB",
      requestDigest: `sha256:${"d".repeat(64)}`,
      parentPaymentId: paymentId,
    });
    expect(firstRefund).toMatchObject({ kind: "create_refund" });
    await expect(
      repository.claim({
        commandId: "00000000-0000-4000-8000-000000000305",
        orderId,
        kind: "create_refund",
        mode: "test",
        amountMinor: "20000",
        currency: "RUB",
        requestDigest: `sha256:${"e".repeat(64)}`,
        parentPaymentId: paymentId,
      }),
    ).rejects.toMatchObject({ code: "YOOKASSA_OPERATION_INVALID" });

    await repository.resolve(firstRefund.id, "failed");
    await expect(
      repository.claim({
        commandId: "00000000-0000-4000-8000-000000000307",
        orderId,
        kind: "create_refund",
        mode: "test",
        amountMinor: "20000",
        currency: "RUB",
        requestDigest: `sha256:${"9".repeat(64)}`,
        parentPaymentId: paymentId,
      }),
    ).resolves.toMatchObject({ kind: "create_refund", amountMinor: "20000" });
  });

  it("binds an explicit refund attempt to the exact parent provider payment", async () => {
    const payment = await repository.claim({
      commandId,
      orderId,
      kind: "create_payment",
      mode: "test",
      amountMinor: "50000",
      currency: "RUB",
      requestDigest,
    });
    const paymentId = randomUUID();
    await repository.bindProviderObject(payment.id, paymentId);
    await db.execute(
      sql`update expert_residency_payment_attempts set status='settled',resolved_at=now() where id=${payment.paymentAttemptId}::uuid`,
    );

    await expect(
      repository.claim({
        commandId: "00000000-0000-4000-8000-000000000306",
        orderId,
        paymentAttemptId: payment.paymentAttemptId,
        kind: "create_refund",
        mode: "test",
        amountMinor: "10000",
        currency: "RUB",
        requestDigest: `sha256:${"f".repeat(64)}`,
        parentPaymentId: randomUUID(),
      }),
    ).rejects.toMatchObject({ code: "YOOKASSA_OPERATION_INVALID" });
  });
});
