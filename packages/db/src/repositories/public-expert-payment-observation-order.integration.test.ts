import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, it } from "vitest";
import {
  PublicExpertRecovery,
  type YooKassaPayment,
} from "@ii-tonya/integrations";
import {
  createPublicOnboardingFixture,
  createPublicTestReplay,
  publicTestDigest,
  publicTestPrincipal,
  publicTestNow,
  startPublicExpertTestDatabase,
} from "../testkit/public-expert-payment.js";
import {
  PostgresPublicExpertPaymentBinder,
  PostgresPublicExpertPaymentObservations,
  PostgresPublicExpertPaymentSource,
} from "./public-expert-payment-gateway.js";
import type { DrizzleDb } from "../client.js";

let context: Awaited<ReturnType<typeof startPublicExpertTestDatabase>>;
const connections: DrizzleDb[] = [];

beforeAll(async () => {
  context = await startPublicExpertTestDatabase();
}, 120000);

afterAll(async () => {
  await Promise.all(connections.map((connection) => connection.$client.end()));
  await context?.db.stop();
}, 120000);

it("uses observation insertion order when equal provider timestamps move a held payment to capture", async () => {
  const fixture = await createPublicOnboardingFixture(context);
  const onboarding = await publicTestPrincipal(context, "onboarding");
  const binderDb = await publicTestPrincipal(context, "binder");
  const writerDb = await publicTestPrincipal(context, "writer");
  const gatewayDb = await publicTestPrincipal(context, "gateway");
  connections.push(onboarding, binderDb, writerDb, gatewayDb);

  const source = new PostgresPublicExpertPaymentSource({
    onboarding,
    main: onboarding,
    refund: onboarding,
  });
  const binder = new PostgresPublicExpertPaymentBinder(binderDb);
  const observations = new PostgresPublicExpertPaymentObservations(writerDb);
  const requestId = randomUUID();
  const idempotencyKey = randomUUID();
  const requestDigest = publicTestDigest("equal-time-held-payment");
  const replay = await createPublicTestReplay();
  const protectedBody = await replay.protector.protect({
    body: "{}",
    bodyVersion: 1,
    associatedData: {
      operationId: requestId,
      operationKind: "create_payment",
      idempotencyKey,
      requestDigest,
      bodyVersion: 1,
    },
  });
  const prepared = await source.prepare(
    "onboarding",
    fixture.userId,
    fixture.invoiceId,
    fixture.contactId,
    {
      requestId,
      idempotencyKey,
      kind: "onboarding_create",
      legacyDeliveryOperationId: null,
      requestDigest,
      bodyVersion: 1,
      ciphertext: protectedBody.ciphertext,
      keyReference: protectedBody.keyReference,
      bodyExpiresAt: protectedBody.expiresAt,
    },
  );
  expect(prepared).not.toBeNull();
  const admitted = await source.admit(prepared!);
  expect(admitted).not.toBeNull();

  let payment: YooKassaPayment = {
    id: `task3-equal-time-${randomUUID()}`,
    status: "pending",
    paid: false,
    test: true,
    amount: { value: "3000.00", currency: "RUB" },
    createdAt: publicTestNow,
    metadata: {
      purpose: "onboarding",
      operation_id: fixture.operationId,
      order_id: fixture.invoiceId,
      user_id: fixture.userId,
    },
    refundable: false,
    confirmation: {
      type: "redirect",
      url: "https://yookassa.ru/task3-equal-time",
    },
  };
  const claimed = (
    await gatewayDb.$client.query(
      "select public.public_expert_gateway_claim($1,$2,$3,$4,$5,$6) value",
      [
        fixture.userId,
        requestId,
        fixture.contactId,
        idempotencyKey,
        requestDigest,
        "onboarding_create",
      ],
    )
  ).rows[0]?.value;
  expect(claimed).toMatchObject({ state: "uncertain" });

  const recovery = new PublicExpertRecovery({
    binder,
    observations,
    now: () => publicTestNow,
    transport: {
      listPayments: async () => ({ complete: true as const, items: [payment] }),
      getPayment: async () => payment,
      listRefunds: async () => ({ complete: true as const, items: [] }),
      getRefund: async () => {
        throw Error("unexpected refund GET");
      },
    },
  });

  expect((await recovery.recover(requestId)).kind).toBe("observed");
  payment = {
    ...payment,
    status: "waiting_for_capture",
    paid: true,
    paymentMethodType: "bank_card",
  };
  expect((await recovery.recover(requestId)).kind).toBe("observed");

  const recorded = await context.db.db.$client.query<{
    observation_sequence: string;
    status: string;
    observed_at: Date;
  }>(
    "select observation_sequence::text,status,observed_at from public_expert_payment_observations where request_id=$1 order by observation_sequence",
    [requestId],
  );
  expect(recorded.rows.map((row) => row.status)).toEqual([
    "pending",
    "waiting_for_capture",
  ]);
  expect(recorded.rows[0]?.observed_at).toEqual(recorded.rows[1]?.observed_at);
  expect(BigInt(recorded.rows[0]!.observation_sequence)).toBeLessThan(
    BigInt(recorded.rows[1]!.observation_sequence),
  );

  const capture = await source.prepare(
    "onboarding",
    fixture.userId,
    fixture.invoiceId,
    null,
    {
      requestId: randomUUID(),
      idempotencyKey: randomUUID(),
      kind: "onboarding_capture",
      legacyDeliveryOperationId: null,
      requestDigest: publicTestDigest("equal-time-capture"),
      bodyVersion: 1,
      ciphertext: null,
      keyReference: null,
      bodyExpiresAt: null,
    },
  );
  expect(capture).toMatchObject({
    kind: "onboarding_capture",
    parentPaymentId: payment.id,
    state: "prepared",
  });
  expect(await source.admit(capture!)).toMatchObject({
    kind: "onboarding_capture",
    state: "admitted",
  });
});
