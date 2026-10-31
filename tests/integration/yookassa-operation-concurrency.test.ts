import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { DrizzleDb } from "../../packages/db/src/client.js";
import {
  createYooKassaClient,
  YooKassaPaymentVerifier,
} from "@ii-tonya/integrations";
import {
  startExpertReferralTestDatabase,
  type ExpertReferralTestDatabase,
} from "../../packages/db/src/testkit/expert-referral.js";
import { PostgresExpertResidencyRepository } from "../../packages/db/src/repositories/expert-residency-repository.js";
import { PostgresExpertResidencyProviderInboxRepository } from "../../packages/db/src/repositories/expert-residency-provider-inbox-repository.js";
import { PostgresYooKassaOperationRepository } from "../../packages/db/src/repositories/yookassa-operation-repository.js";

const requestDigest = `sha256:${"c".repeat(64)}`;
let fixture: ExpertReferralTestDatabase;
let db: DrizzleDb;
let repository: PostgresYooKassaOperationRepository;
let tariffId: string;
let orderId: string;
let commandId: string;

async function settleCapturedPayment(operationId: string, paymentId: string) {
  const operation = await repository.bindProviderObject(operationId, paymentId);
  const capturedAt = (
    await db.execute<{ at: Date }>(sql`select clock_timestamp() as at`)
  ).rows[0]!.at.toISOString();
  const client = createYooKassaClient(
    { mode: "test", shopId: "test-shop", secretKey: "synthetic-fixture-only" },
    async (url, init) => {
      if (
        init.method !== "GET" ||
        new URL(url).pathname !== `/v3/payments/${paymentId}`
      )
        throw Error("unexpected_fixture_provider_request");
      return new Response(
        JSON.stringify({
          id: paymentId,
          status: "succeeded",
          paid: true,
          test: true,
          refundable: true,
          amount: { value: "500.00", currency: "RUB" },
          created_at: capturedAt,
          captured_at: capturedAt,
          metadata: { order_id: orderId },
        }),
        { status: 200 },
      );
    },
  );
  const proof = await new YooKassaPaymentVerifier(
    client,
    repository,
  ).verifyPayment(operation);
  expect(proof).not.toBeNull();
  await new PostgresExpertResidencyProviderInboxRepository(db).settle(proof!);
}

describe("YooKassa operation concurrency on an isolated canonical database", () => {
  beforeAll(async () => {
    fixture = await startExpertReferralTestDatabase(undefined, {
      forceDisposableCluster: true,
    });
    db = fixture.db;
    repository = new PostgresYooKassaOperationRepository(db);
    await fixture.enableExpertReferralCommands();
    tariffId = await fixture.createResidencyTariff({
      tariffKey: "concurrency",
      displayName: "Concurrency fixture",
      commercialPolicyVersion: "legacy_residency_v1",
      priceMinor: 50000,
      durationSeconds: 2592000,
    });
  }, 120_000);

  beforeEach(async () => {
    const expert = await fixture.createExpertIdentity();
    const order = await new PostgresExpertResidencyRepository(
      db,
    ).createCheckoutOrder({
      expertId: expert.expertId,
      tariffVersionId: tariffId,
      providerDeadline: new Date(Date.now() + 3600000),
      idempotencyKey: randomUUID(),
    });
    orderId = order.id;
    commandId = randomUUID();
  });

  afterAll(async () => {
    await fixture?.stop();
  }, 120_000);

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
      sql`select count(*)::int as count from expert_residency_provider_operations where order_id=${orderId}::uuid`,
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
    await settleCapturedPayment(payment.id, paymentId);

    const firstRefundCommand = {
      commandId: "00000000-0000-4000-8000-000000000304",
      orderId,
      kind: "create_refund" as const,
      mode: "test" as const,
      amountMinor: "40000",
      currency: "RUB" as const,
      requestDigest: `sha256:${"d".repeat(64)}`,
      parentPaymentId: paymentId,
    };
    const firstRefund = await repository.claim(firstRefundCommand);
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
    await expect(repository.claim(firstRefundCommand)).resolves.toMatchObject({
      id: firstRefund.id,
      status: "failed",
    });
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
    await settleCapturedPayment(payment.id, paymentId);

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

  it("fences exact-body recovery and atomically binds its payment attempt", async () => {
    const claimed = await repository.claim({
      commandId,
      orderId,
      kind: "create_payment",
      mode: "test",
      amountMinor: "50000",
      currency: "RUB",
      requestDigest,
    });
    await repository.attachReplaySnapshot(claimed.id, {
      ciphertext: "opaque-test-ciphertext",
      keyReference: "kms:test-key",
      bodyVersion: 1,
      expiresAt: "2030-01-01T00:00:00.000Z",
    });
    await repository.markUnknown(claimed.id);
    const [lease] = await repository.claimUnboundRecoveryBatch({
      limit: 1,
      leaseSeconds: 60,
      maxAttempts: 3,
    });
    expect(lease?.operationId).toBe(claimed.id);
    const providerId = randomUUID();
    await repository.bindRecoveredProviderObject(
      claimed.id,
      lease!.leaseToken,
      providerId,
    );
    await expect(
      repository.findByProviderObject(providerId, "create_payment"),
    ).resolves.toMatchObject({
      id: claimed.id,
      providerObjectId: providerId,
      status: "pending",
    });
  });
});
