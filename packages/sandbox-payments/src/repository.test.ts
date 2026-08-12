import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, createDb, type DrizzleDb } from "@ii-tonya/db";
import { startExternalPostgresDatabase } from "../../db/src/testkit/external-postgres.js";
import {
  migrateSandboxDatabase,
  PostgresSandboxPaymentRepository,
  SandboxPaymentConflictError,
  type CreateSandboxCheckoutCommand,
} from "./index.js";

const checkoutBaseUrl = new URL("https://sandbox.ii-tonya.invalid/");
const sandboxRelations = [
  "sandbox_expert_residency_commands",
  "sandbox_expert_residency_environment",
  "sandbox_expert_residency_events",
  "sandbox_expert_residency_payments",
] as const;

let database:
  | Awaited<ReturnType<typeof startExternalPostgresDatabase>>
  | undefined;
let db: DrizzleDb | undefined;
let repository: PostgresSandboxPaymentRepository;

const checkoutCommand = (): CreateSandboxCheckoutCommand => ({
  orderId: randomUUID(),
  amountMinor: "100000",
  currency: "RUB",
  idempotencyKey: `checkout:${randomUUID()}`,
});

async function countRows(
  relation: (typeof sandboxRelations)[number],
): Promise<number> {
  const result =
    relation === "sandbox_expert_residency_environment"
      ? await db!.execute<{ count: string }>(
          sql`select count(*)::text as count from sandbox_expert_residency_environment`,
        )
      : relation === "sandbox_expert_residency_payments"
        ? await db!.execute<{ count: string }>(
            sql`select count(*)::text as count from sandbox_expert_residency_payments`,
          )
        : relation === "sandbox_expert_residency_commands"
          ? await db!.execute<{ count: string }>(
              sql`select count(*)::text as count from sandbox_expert_residency_commands`,
            )
          : await db!.execute<{ count: string }>(
              sql`select count(*)::text as count from sandbox_expert_residency_events`,
            );
  return Number(result.rows[0]?.count ?? 0);
}

function databaseErrorCode(error: unknown): string | undefined {
  const seen = new Set<unknown>();
  let current = error;
  while (
    typeof current === "object" &&
    current !== null &&
    !seen.has(current)
  ) {
    seen.add(current);
    const candidate = current as { code?: unknown; cause?: unknown };
    if (typeof candidate.code === "string") return candidate.code;
    current = candidate.cause;
  }
  return undefined;
}

beforeAll(async () => {
  const adminUrl = process.env.II_TONYA_TEST_POSTGRES_ADMIN_URL;
  if (!adminUrl) {
    throw new Error(
      "II_TONYA_TEST_POSTGRES_ADMIN_URL is required by the Claw PostgreSQL profile",
    );
  }
  database = await startExternalPostgresDatabase(adminUrl);
  db = createDb(database.getConnectionUri());
}, 120_000);

beforeEach(async () => {
  await db!.execute(sql`drop schema public cascade`);
  await db!.execute(sql`create schema public`);
  await migrateSandboxDatabase(db!);
  repository = new PostgresSandboxPaymentRepository(db!, checkoutBaseUrl);
});

afterAll(async () => {
  if (db) await closeDb(db);
  await database?.stop();
}, 60_000);

describe("sandbox payment database boundary", () => {
  it("creates only the reviewed sandbox relations and marker", async () => {
    const relations = await db!.execute<{ relationName: string }>(sql`
      select table_name as "relationName"
      from information_schema.tables
      where table_schema = 'public'
      order by table_name
    `);
    expect(relations.rows.map(({ relationName }) => relationName)).toEqual([
      ...sandboxRelations,
    ]);
    expect(await countRows("sandbox_expert_residency_environment")).toBe(1);
    await expect(repository.assertSandboxDatabase()).resolves.toBeUndefined();
  });

  it("rejects startup when the exact sandbox marker is missing", async () => {
    await db!.execute(sql`delete from sandbox_expert_residency_environment`);
    await expect(repository.assertSandboxDatabase()).rejects.toThrow(
      "sandbox_database_marker_missing",
    );
  });

  it("keeps every foreign key inside the sandbox relation boundary", async () => {
    const references = await db!.execute<{ target: string }>(sql`
      select target.relname as target
      from pg_constraint constraint_record
      join pg_class source on source.oid = constraint_record.conrelid
      join pg_class target on target.oid = constraint_record.confrelid
      where constraint_record.contype = 'f'
        and source.relname like 'sandbox_expert_residency_%'
      order by source.relname, constraint_record.conname
    `);
    expect(references.rows.map(({ target }) => target)).toEqual([
      "sandbox_expert_residency_payments",
      "sandbox_expert_residency_payments",
    ]);
  });
});

describe("PostgresSandboxPaymentRepository checkout", () => {
  it("writes one payment and one replayable command atomically", async () => {
    const checkout = await repository.createCheckout(checkoutCommand());
    expect(checkout).toMatchObject({
      kind: "created",
      state: "created",
      version: 0,
    });
    expect(checkout.paymentId).toMatch(
      /^sandbox_payment_[A-Za-z0-9_-]{22,128}$/u,
    );
    expect(checkout.checkoutUrl).toBe(
      `https://sandbox.ii-tonya.invalid/sandbox/v1/payments/${checkout.paymentId}`,
    );
    expect(await countRows("sandbox_expert_residency_payments")).toBe(1);
    expect(await countRows("sandbox_expert_residency_commands")).toBe(1);
  });

  it("returns the original checkout for an identical idempotent replay", async () => {
    const command = checkoutCommand();
    const first = await repository.createCheckout(command);
    const replay = await repository.createCheckout(command);
    expect(replay).toEqual(first);
    expect(await countRows("sandbox_expert_residency_payments")).toBe(1);
  });

  it("rejects a conflicting idempotency replay", async () => {
    const command = checkoutCommand();
    await repository.createCheckout(command);
    await expect(
      repository.createCheckout({ ...command, amountMinor: "2" }),
    ).rejects.toBeInstanceOf(SandboxPaymentConflictError);
    expect(await countRows("sandbox_expert_residency_payments")).toBe(1);
    expect(await countRows("sandbox_expert_residency_commands")).toBe(1);
  });

  it("rejects non-canonical checkout input without persisting it", async () => {
    const command = {
      ...checkoutCommand(),
      unexpected: "authority",
    } as CreateSandboxCheckoutCommand;
    await expect(repository.createCheckout(command)).rejects.toBeDefined();
    expect(await countRows("sandbox_expert_residency_payments")).toBe(0);
    expect(await countRows("sandbox_expert_residency_commands")).toBe(0);
  });

  it("commits one payment for concurrent identical commands", async () => {
    const command = checkoutCommand();
    const results = await Promise.all(
      Array.from({ length: 8 }, () => repository.createCheckout(command)),
    );
    expect(results.every((result) => result.paymentId === results[0]?.paymentId)).toBe(
      true,
    );
    expect(await countRows("sandbox_expert_residency_payments")).toBe(1);
    expect(await countRows("sandbox_expert_residency_commands")).toBe(1);
  });
});

describe("PostgresSandboxPaymentRepository transitions", () => {
  it("appends one event for each created to settled to refunded transition", async () => {
    const checkout = await repository.createCheckout(checkoutCommand());
    const settled = await repository.transition({
      paymentId: checkout.paymentId,
      transition: "settled",
      expectedVersion: 0,
      idempotencyKey: `transition:${randomUUID()}`,
      correlationId: `correlation:${randomUUID()}`,
    });
    expect(settled).toMatchObject({
      provider: "ii_tonya_sandbox",
      kind: "settled",
      paymentId: checkout.paymentId,
      state: "settled",
      version: 1,
    });
    expect(settled.payloadDigest).toMatch(/^sha256:[0-9a-f]{64}$/u);

    const refunded = await repository.transition({
      paymentId: checkout.paymentId,
      transition: "refunded",
      expectedVersion: 1,
      idempotencyKey: `transition:${randomUUID()}`,
      correlationId: `correlation:${randomUUID()}`,
    });
    expect(refunded).toMatchObject({
      provider: "ii_tonya_sandbox",
      kind: "refunded",
      paymentId: checkout.paymentId,
      state: "refunded",
      version: 2,
    });
    expect(await countRows("sandbox_expert_residency_events")).toBe(2);

    await expect(repository.nextPendingEvent(checkout.paymentId)).resolves.toEqual(
      settled,
    );
    await repository.markEventProcessed(settled.eventId);
    await expect(repository.nextPendingEvent(checkout.paymentId)).resolves.toEqual(
      refunded,
    );
  });

  it("returns the stored event for an identical transition replay", async () => {
    const checkout = await repository.createCheckout(checkoutCommand());
    const command = {
      paymentId: checkout.paymentId,
      transition: "settled" as const,
      expectedVersion: 0,
      idempotencyKey: `transition:${randomUUID()}`,
      correlationId: `correlation:${randomUUID()}`,
    };
    const first = await repository.transition(command);
    await expect(repository.transition(command)).resolves.toEqual(first);
    expect(await countRows("sandbox_expert_residency_events")).toBe(1);
  });

  it("rejects a conflicting transition replay", async () => {
    const checkout = await repository.createCheckout(checkoutCommand());
    const command = {
      paymentId: checkout.paymentId,
      transition: "settled" as const,
      expectedVersion: 0,
      idempotencyKey: `transition:${randomUUID()}`,
      correlationId: `correlation:${randomUUID()}`,
    };
    await repository.transition(command);
    await expect(
      repository.transition({ ...command, correlationId: "correlation:other" }),
    ).rejects.toBeInstanceOf(SandboxPaymentConflictError);
    expect(await countRows("sandbox_expert_residency_events")).toBe(1);
  });

  it("rolls back a refund before settlement", async () => {
    const checkout = await repository.createCheckout(checkoutCommand());
    await expect(
      repository.transition({
        paymentId: checkout.paymentId,
        transition: "refunded",
        expectedVersion: 0,
        idempotencyKey: `transition:${randomUUID()}`,
        correlationId: `correlation:${randomUUID()}`,
      }),
    ).rejects.toBeInstanceOf(SandboxPaymentConflictError);
    expect(await countRows("sandbox_expert_residency_events")).toBe(0);
    expect(await countRows("sandbox_expert_residency_commands")).toBe(1);
  });

  it("rolls back stale-version and repeated transitions", async () => {
    const checkout = await repository.createCheckout(checkoutCommand());
    const transition = (expectedVersion: number) =>
      repository.transition({
        paymentId: checkout.paymentId,
        transition: "settled",
        expectedVersion,
        idempotencyKey: `transition:${randomUUID()}`,
        correlationId: `correlation:${randomUUID()}`,
      });
    await expect(transition(1)).rejects.toBeInstanceOf(
      SandboxPaymentConflictError,
    );
    await transition(0);
    await expect(transition(1)).rejects.toBeInstanceOf(
      SandboxPaymentConflictError,
    );
    expect(await countRows("sandbox_expert_residency_events")).toBe(1);
  });

  it("rejects every transition after refund without appending an event", async () => {
    const checkout = await repository.createCheckout(checkoutCommand());
    await repository.transition({
      paymentId: checkout.paymentId,
      transition: "settled",
      expectedVersion: 0,
      idempotencyKey: `transition:${randomUUID()}`,
      correlationId: `correlation:${randomUUID()}`,
    });
    await repository.transition({
      paymentId: checkout.paymentId,
      transition: "refunded",
      expectedVersion: 1,
      idempotencyKey: `transition:${randomUUID()}`,
      correlationId: `correlation:${randomUUID()}`,
    });
    for (const transition of ["settled", "refunded"] as const) {
      await expect(
        repository.transition({
          paymentId: checkout.paymentId,
          transition,
          expectedVersion: 2,
          idempotencyKey: `transition:${randomUUID()}`,
          correlationId: `correlation:${randomUUID()}`,
        }),
      ).rejects.toBeInstanceOf(SandboxPaymentConflictError);
    }
    expect(await countRows("sandbox_expert_residency_events")).toBe(2);
  });

  it("protects command and event facts from mutation or deletion", async () => {
    const checkout = await repository.createCheckout(checkoutCommand());
    const event = await repository.transition({
      paymentId: checkout.paymentId,
      transition: "settled",
      expectedVersion: 0,
      idempotencyKey: `transition:${randomUUID()}`,
      correlationId: `correlation:${randomUUID()}`,
    });
    for (const operation of [
      () =>
        db!.execute(
          sql`update sandbox_expert_residency_commands set payload_digest=${`sha256:${"0".repeat(64)}`}`,
        ),
      () =>
        db!.execute(
          sql`delete from sandbox_expert_residency_events where event_id=${event.eventId}`,
        ),
    ]) {
      let caught: unknown;
      try {
        await operation();
      } catch (error) {
        caught = error;
      }
      expect(databaseErrorCode(caught)).toBe("55000");
    }
  });
});
