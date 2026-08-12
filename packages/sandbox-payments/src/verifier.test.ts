import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, createDb, type DrizzleDb } from "@ii-tonya/db";
import {
  assertVerifiedExpertResidencyPaymentEvent,
  createCanonicalExpertResidencyPaymentEventVerifier,
} from "@ii-tonya/integrations";
import { startExternalPostgresDatabase } from "../../db/src/testkit/external-postgres.js";
import {
  createSandboxEventVerifier,
  migrateSandboxDatabase,
  PostgresSandboxPaymentRepository,
} from "./index.js";

const checkoutBaseUrl = new URL("https://sandbox.ii-tonya.invalid/");
let database:
  | Awaited<ReturnType<typeof startExternalPostgresDatabase>>
  | undefined;
let db: DrizzleDb | undefined;
let repository: PostgresSandboxPaymentRepository;

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

describe("sandbox payment event verifier", () => {
  it("brands only a repository-owned frozen sandbox event", async () => {
    const checkout = await repository.createCheckout({
      orderId: randomUUID(),
      amountMinor: "100000",
      currency: "RUB",
      idempotencyKey: `checkout:${randomUUID()}`,
    });
    const event = await repository.transition({
      paymentId: checkout.paymentId,
      transition: "settled",
      expectedVersion: 0,
      idempotencyKey: `transition:${randomUUID()}`,
      correlationId: `correlation:${randomUUID()}`,
    });
    const verifier = createSandboxEventVerifier(
      createCanonicalExpertResidencyPaymentEventVerifier(),
    );

    expect(Object.isFrozen(event)).toBe(true);
    const verified = verifier.verify(event);
    expect(verified.provider).toBe("ii_tonya_sandbox");
    expect(() =>
      assertVerifiedExpertResidencyPaymentEvent(verified),
    ).not.toThrow();

    const forged = Object.freeze({ ...event });
    expect(() => verifier.verify(forged)).toThrow(
      "sandbox_repository_event_required",
    );
  });
});
