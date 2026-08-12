import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
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
  SandboxExpertResidencyPaymentAdapter,
} from "./index.js";

const checkoutBaseUrl = new URL("https://sandbox.ii-tonya.invalid/");
let database:
  Awaited<ReturnType<typeof startExternalPostgresDatabase>> | undefined;
let db: DrizzleDb | undefined;
let repository: PostgresSandboxPaymentRepository;
let adapter: SandboxExpertResidencyPaymentAdapter;

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
  adapter = new SandboxExpertResidencyPaymentAdapter(
    repository,
    createSandboxEventVerifier(
      createCanonicalExpertResidencyPaymentEventVerifier(),
    ),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

afterAll(async () => {
  if (db) await closeDb(db);
  await database?.stop();
}, 60_000);

const checkoutCommand = () => ({
  orderId: randomUUID(),
  amountMinor: "100000",
  currency: "RUB" as const,
  idempotencyKey: `checkout:${randomUUID()}`,
});

describe("SandboxExpertResidencyPaymentAdapter", () => {
  it("returns only the provider-neutral checkout outcome", async () => {
    const checkout = await adapter.createCheckout(checkoutCommand());

    expect(checkout).toEqual({
      kind: "created",
      paymentId: checkout.paymentId,
      checkoutUrl: checkout.checkoutUrl,
    });
  });

  it("never performs a network call", async () => {
    const forbiddenFetch = vi.fn(() => {
      throw new Error("network_forbidden");
    });
    vi.stubGlobal("fetch", forbiddenFetch);

    const checkout = await adapter.createCheckout(checkoutCommand());
    await adapter.reconcile(checkout.paymentId);

    expect(forbiddenFetch).not.toHaveBeenCalled();
  });

  it("keeps a durable event pending until downstream delivery acknowledges it", async () => {
    const checkout = await adapter.createCheckout(checkoutCommand());
    const event = await repository.transition({
      paymentId: checkout.paymentId,
      transition: "settled",
      expectedVersion: 0,
      idempotencyKey: `transition:${randomUUID()}`,
      correlationId: `correlation:${randomUUID()}`,
    });

    const first = await adapter.reconcile(checkout.paymentId);
    const retry = await adapter.reconcile(checkout.paymentId);
    expect(retry).toEqual(first);
    expect(() =>
      assertVerifiedExpertResidencyPaymentEvent(first),
    ).not.toThrow();

    await repository.markEventProcessed(event.eventId);
    await expect(adapter.reconcile(checkout.paymentId)).resolves.toBeNull();
  });
});
