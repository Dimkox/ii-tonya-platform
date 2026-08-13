import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { closeDb, createDb, type DrizzleDb } from "../../packages/db/src/index.js";
import { createCanonicalExpertResidencyPaymentEventVerifier } from "../../packages/integrations/src/index.js";
import { startExternalPostgresDatabase } from "../../packages/db/src/testkit/external-postgres.js";
import {
  createSandboxEventVerifier,
  deliverSandboxPaymentEvent,
  migrateSandboxDatabase,
  PostgresSandboxPaymentRepository,
  SandboxExpertResidencyPaymentAdapter,
} from "../../packages/sandbox-payments/src/index.js";

let database: Awaited<ReturnType<typeof startExternalPostgresDatabase>> | undefined;
let db: DrizzleDb | undefined;
let repository: PostgresSandboxPaymentRepository;
let adapter: SandboxExpertResidencyPaymentAdapter;

beforeAll(async () => {
  const adminUrl = process.env.II_TONYA_TEST_POSTGRES_ADMIN_URL;
  if (!adminUrl) throw new Error("II_TONYA_TEST_POSTGRES_ADMIN_URL is required by Claw");
  database = await startExternalPostgresDatabase(adminUrl);
  db = createDb(database.getConnectionUri());
}, 120_000);

beforeEach(async () => {
  await db!.execute(sql`drop schema public cascade`);
  await db!.execute(sql`create schema public`);
  await migrateSandboxDatabase(db!);
  repository = new PostgresSandboxPaymentRepository(db!, new URL("https://sandbox.ii-tonya.invalid"));
  adapter = new SandboxExpertResidencyPaymentAdapter(
    repository,
    createSandboxEventVerifier(createCanonicalExpertResidencyPaymentEventVerifier()),
  );
});

afterAll(async () => {
  if (db) await closeDb(db);
  await database?.stop();
});

async function pending(kind: "settled" | "refunded" = "settled") {
  const checkout = await repository.createCheckout({
    orderId: randomUUID(), amountMinor: "100000", currency: "RUB",
    idempotencyKey: `checkout:${randomUUID()}`,
  });
  if (kind === "refunded") {
    await repository.transition({ paymentId: checkout.paymentId, transition: "settled", expectedVersion: 0, idempotencyKey: `settle:${randomUUID()}`, correlationId: `correlation:${randomUUID()}` });
    const first = await repository.nextPendingEvent(checkout.paymentId);
    await repository.markEventProcessed(first!.eventId);
  }
  const event = await repository.transition({ paymentId: checkout.paymentId, transition: kind, expectedVersion: kind === "settled" ? 0 : 1, idempotencyKey: `${kind}:${randomUUID()}`, correlationId: `correlation:${randomUUID()}` });
  return { checkout, event };
}

describe("sandbox payment reconciliation", () => {
  it("keeps the same durable event pending when downstream settlement fails before acknowledge", async () => {
    const { checkout, event } = await pending();
    const inbox = { settle: vi.fn().mockRejectedValueOnce(new Error("downstream_failed")), reverse: vi.fn() };
    const acknowledge = vi.fn((eventId: string) => repository.markEventProcessed(eventId));
    await expect(deliverSandboxPaymentEvent({ paymentId: checkout.paymentId, adapter, inbox: inbox as never, acknowledge })).rejects.toThrow("downstream_failed");
    expect(acknowledge).not.toHaveBeenCalled();
    const retry = await adapter.reconcile(checkout.paymentId);
    expect(retry).toMatchObject({ eventId: event.eventId, payloadDigest: event.payloadDigest });
    inbox.settle.mockResolvedValueOnce({ firstSettlement: true });
    await expect(deliverSandboxPaymentEvent({ paymentId: checkout.paymentId, adapter, inbox: inbox as never, acknowledge })).resolves.toBe("settled");
    expect(inbox.settle.mock.calls[1]![0]).toMatchObject({ eventId: event.eventId, payloadDigest: event.payloadDigest });
    expect(acknowledge).toHaveBeenCalledOnce();
    await expect(deliverSandboxPaymentEvent({ paymentId: checkout.paymentId, adapter, inbox: inbox as never, acknowledge })).resolves.toBe("none");
  });

  it("routes refunds only through the canonical reversal inbox and acknowledges after success", async () => {
    const { checkout, event } = await pending("refunded");
    const order: string[] = [];
    const inbox = { settle: vi.fn(), reverse: vi.fn(async () => { order.push("reverse"); }) };
    const acknowledge = vi.fn(async (eventId: string) => { order.push("ack"); await repository.markEventProcessed(eventId); });
    await expect(deliverSandboxPaymentEvent({ paymentId: checkout.paymentId, adapter, inbox: inbox as never, acknowledge })).resolves.toBe("refunded");
    expect(inbox.settle).not.toHaveBeenCalled();
    expect(inbox.reverse).toHaveBeenCalledWith(expect.objectContaining({ eventId: event.eventId, kind: "refunded" }));
    expect(order).toEqual(["reverse", "ack"]);
  });
});
