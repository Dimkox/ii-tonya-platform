import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { beforeAll, afterAll, it, expect } from "vitest";
import {
  createYooKassaClient,
  YooKassaPaymentVerifier,
  PublicExpertRecovery,
  type YooKassaPayment,
  type YooKassaRefund,
  type PublicExpertPrepareDescriptor,
} from "@ii-tonya/integrations";
import {
  startPublicExpertTestDatabase,
  publicTestPrincipal,
  publicTestDigest,
  publicTestVault,
} from "../testkit/public-expert-payment.js";
import {
  createCorrectionOnboardingFixture,
  correctionEvent,
} from "../../../../tests/support/residency-correction-fixture.js";
import { PostgresExpertOnboardingMainPaymentRepository } from "./expert-onboarding-main-payment-repository.js";
import { PostgresPayerReceiptContactRepository } from "./payer-receipt-contact-repository.js";
import {
  PostgresYooKassaOperationRepository,
  canonicalYooKassaRequestDigest,
} from "./yookassa-operation-repository.js";
import { PostgresExpertResidencyProviderInboxRepository } from "./expert-residency-provider-inbox-repository.js";
import {
  PostgresPublicExpertPaymentSource,
  PostgresPublicExpertPaymentBinder,
  PostgresPublicExpertPaymentObservations,
  PublicMainResidencyCheckout,
} from "./public-expert-payment-gateway.js";
import type { DrizzleDb } from "../client.js";
let context: Awaited<ReturnType<typeof startPublicExpertTestDatabase>>;
const connections: DrizzleDb[] = [];
let source: PostgresPublicExpertPaymentSource,
  binder: PostgresPublicExpertPaymentBinder,
  observations: PostgresPublicExpertPaymentObservations,
  gateway: DrizzleDb;
beforeAll(async () => {
  context = await startPublicExpertTestDatabase();
  const roles: DrizzleDb[] = [];
  for (const label of [
    "onboarding",
    "main",
    "refund",
    "binder",
    "writer",
    "gateway",
  ] as const)
    roles.push(await publicTestPrincipal(context, label));
  connections.push(...roles);
  source = new PostgresPublicExpertPaymentSource({
    onboarding: roles[0]!,
    main: roles[1]!,
    refund: roles[2]!,
  });
  binder = new PostgresPublicExpertPaymentBinder(roles[3]!);
  observations = new PostgresPublicExpertPaymentObservations(roles[4]!);
  gateway = roles[5]!;
}, 120000);
afterAll(async () => {
  await Promise.all(connections.map((c) => c.$client.end()));
  await context?.db.stop();
}, 120000);
async function mainOrder() {
  const f = await createCorrectionOnboardingFixture(context.db);
  await f.cards.submitPromoProof({
    ...correctionEvent(f.scope),
    expectedRevision: 0,
    proof: { kind: "link", reference: "https://example.invalid/task3-proof" },
  });
  await f.cards.confirmPromo({
    sessionHash: f.sessionHash,
    applicationId: f.applicationId,
    expectedRevision: 0,
    idempotencyKey: randomUUID(),
  });
  const revision = (await f.approveCard()).revision,
    financial = new PostgresExpertOnboardingMainPaymentRepository(
      context.db.db,
      {
        providerMode: "test",
        messagingConsentPolicyVersion: "client-messaging-v1",
      },
    );
  const quote = await financial.quoteMain({
    ...correctionEvent(f.workScope),
    tariffVersionId: f.tariffId,
    termMonths: 1,
    revision,
  });
  await financial.acceptMain({
    ...correctionEvent(f.workScope),
    quoteId: quote.id,
    revision,
  });
  await new PostgresPayerReceiptContactRepository(
    context.db.db,
    publicTestVault,
    30,
  ).capture({
    userId: f.userId,
    quoteId: quote.id,
    email: "private-adapter@example.invalid",
    idempotencyKey: randomUUID(),
  });
  const contact = (
    await context.db.db.$client.query(
      "select * from payer_receipt_contacts where user_id=$1 and quote_id=$2",
      [f.userId, quote.id],
    )
  ).rows[0]!;
  const order = await financial.createMainInvoice({
    ...correctionEvent(f.workScope),
    revision,
  });
  await context.db.db.$client.query(
    "insert into payer_receipt_order_bindings(order_id,contact_id,quote_id,user_id) values($1,$2,$3,$4)",
    [order.orderId, contact.id, quote.id, f.userId],
  );
  await context.db.db.transaction(async (tx) => {
    await tx.execute(
      sql`alter table expert_residency_orders disable trigger expert_campaign_order_snapshot_immutable`,
    );
    await tx.execute(
      sql`update expert_residency_orders set payment_deadline='2027-01-11T14:00:00Z',provider_deadline='2027-01-11T14:00:00Z' where id=${order.orderId}::uuid`,
    );
    await tx.execute(
      sql`alter table expert_residency_orders enable trigger expert_campaign_order_snapshot_immutable`,
    );
    const binding = {
      id: contact.id as string,
      quoteId: quote.id,
      userId: f.userId,
      kind: "email" as const,
      basis: "fiscal_payment_dec_plt_004_v1" as const,
      capturedAt: "2027-01-11T11:00:00.000Z",
      expiresAt: "2027-01-11T14:00:00.000Z",
    };
    const sealed = publicTestVault.seal(
      "private-adapter@example.invalid",
      binding,
    );
    await tx.execute(
      sql`alter table payer_receipt_contacts disable trigger payer_receipt_contact_guard`,
    );
    await tx.execute(
      sql`update payer_receipt_contacts set captured_at=${binding.capturedAt}::timestamptz,expires_at=${binding.expiresAt}::timestamptz,ciphertext=${sealed.ciphertext} where id=${binding.id}::uuid`,
    );
    await tx.execute(
      sql`alter table payer_receipt_contacts enable trigger payer_receipt_contact_guard`,
    );
  });
  return { ...f, order, contactId: contact.id as string };
}
function descriptor(
  kind: "main_create" | "main_refund",
): PublicExpertPrepareDescriptor {
  return {
    requestId: randomUUID(),
    idempotencyKey: randomUUID(),
    kind,
    legacyDeliveryOperationId: kind === "main_create" ? randomUUID() : null,
    requestDigest: publicTestDigest(randomUUID()),
    bodyVersion: 1,
    ciphertext: "synthetic-recovery-envelope",
    keyReference: "fixture:recovery",
    bodyExpiresAt: "2027-01-11T13:00:00.000Z",
  };
}
async function claim(
  s: NonNullable<Awaited<ReturnType<typeof source.prepare>>>,
) {
  if (s.state === "prepared") {
    const admitted = await source.admit(s);
    expect(admitted).not.toBeNull();
  }
  return (
    await gateway.$client.query(
      "select public.public_expert_gateway_claim($1,$2,$3,$4,$5,$6) value",
      [
        s.userId,
        s.requestId,
        s.contactId,
        s.idempotencyKey,
        s.requestDigest,
        s.kind,
      ],
    )
  ).rows[0]!.value;
}
it("preallocated delivery UUID changes claim identity and cannot be substituted on replay", () => {
  const command = {
    commandId: randomUUID(),
    orderId: randomUUID(),
    paymentAttemptId: randomUUID(),
    kind: "create_refund" as const,
    mode: "test" as const,
    amountMinor: "100",
    currency: "RUB" as const,
    parentPaymentId: "paid-parent",
    requestDigest: publicTestDigest("refund"),
    deliveryOperationId: randomUUID(),
  };
  expect(canonicalYooKassaRequestDigest(command)).not.toBe(
    canonicalYooKassaRequestDigest({
      ...command,
      deliveryOperationId: randomUUID(),
    }),
  );
});
it("public main loads exact accepted owner money; complete unique LIST and fresh GET bind once and legacy replay rejects the cohort", async () => {
  const f = await mainOrder();
  const loaded = (await source.source("main", f.userId, f.order.orderId))!;
  expect(loaded).toMatchObject({
    sourceId: f.order.orderId,
    userId: f.userId,
    amountMinor: f.order.cashMinor,
    contact: { binding: { id: f.contactId } },
  });
  expect(await source.source("main", randomUUID(), f.order.orderId)).toBeNull();
  const d = descriptor("main_create"),
    s = (await source.prepare(
      "main",
      f.userId,
      f.order.orderId,
      f.contactId,
      d,
    ))!;
  expect(s).not.toBeNull();
  await claim(s);
  const payment: YooKassaPayment = {
    id: "task3-main-" + randomUUID(),
    status: "pending",
    paid: false,
    test: true,
    amount: {
      value: (Number(s.amountMinor) / 100).toFixed(2),
      currency: "RUB",
    },
    createdAt: "2027-01-11T12:00:00.000Z",
    metadata: {
      purpose: "main_residency",
      operation_id: s.legacyOperationId,
      order_id: f.order.orderId,
      user_id: f.userId,
    },
    refundable: false,
    confirmation: { type: "redirect", url: "https://yookassa.ru/task3-main" },
  };
  let gets = 0;
  const transport = {
    listPayments: async () => ({ complete: true as const, items: [payment] }),
    getPayment: async () => {
      gets++;
      return payment;
    },
    listRefunds: async () => ({ complete: true as const, items: [] }),
    getRefund: async () => {
      throw Error("unexpected");
    },
  };
  const recovery = new PublicExpertRecovery({
    binder,
    observations,
    transport,
    now: () => "2027-01-11T12:00:00.000Z",
  });
  expect((await recovery.recover(s.requestId)).kind).toBe("observed");
  expect((await recovery.recover(s.requestId)).kind).toBe("observed");
  expect(gets).toBe(2);
  expect((await binder.bound(s.requestId))?.legacyOperationId).toBe(
    d.legacyDeliveryOperationId,
  );
  expect(
    await source.prepare(
      "main",
      f.userId,
      f.order.orderId,
      f.contactId,
      descriptor("main_create"),
    ),
  ).toBeNull();
  const legacy = new PostgresYooKassaOperationRepository(context.db.db);
  expect(
    await legacy.admitUnboundRecovery(s.legacyOperationId, randomUUID()),
  ).toBe(false);
  const rows = await legacy.claimUnboundRecoveryBatch({
    limit: 20,
    leaseSeconds: 60,
    maxAttempts: 3,
  });
  expect(rows.some((row) => row.operationId === s.legacyOperationId)).toBe(
    false,
  );
});
it("public main rejects UI amounts before any admission or transport; canonical source remains authoritative", async () => {
  const f = await mainOrder();
  let sends = 0;
  const checkout = new PublicMainResidencyCheckout({
    enabled: true,
    mode: "test",
    source,
    vault: publicTestVault,
    protector: {
      protect: async () => {
        throw Error("must not seal");
      },
    },
    decryptor: {
      decrypt: async () => {
        throw Error("must not decrypt");
      },
    },
    transport: {
      dispatch: async () => {
        sends++;
        return { kind: "unknown" };
      },
    },
    recovery: { recover: async () => ({ kind: "pending" }) },
    returnUrl: "https://example.invalid/return",
    vatCode: 1,
  });
  const loaded = (await source.source("main", f.userId, f.order.orderId))!;
  expect(
    await checkout.createOrRecover({
      orderId: f.order.orderId,
      userId: f.userId,
      expertId: loaded.expertId!,
      amountMinor: "1",
      currency: "RUB",
      providerMode: "test",
      purpose: "main_residency",
      paymentDeadline: loaded.paymentDeadline,
      idempotencyKey: randomUUID(),
    }),
  ).toEqual({ kind: "unavailable" });
  expect(sends).toBe(0);
});
async function refundSubject() {
  const f = await mainOrder(),
    legacy = new PostgresYooKassaOperationRepository(context.db.db);
  const payment = await legacy.claim({
    commandId: randomUUID(),
    orderId: f.order.orderId,
    kind: "create_payment",
    mode: "test",
    amountMinor: f.order.cashMinor,
    currency: "RUB",
    requestDigest: publicTestDigest("legacy-parent"),
  });
  const parentId = "task3-parent-" + randomUUID(),
    bound = await legacy.bindProviderObject(payment.id, parentId),
    time = new Date().toISOString();
  const client = createYooKassaClient(
    { mode: "test", shopId: "test-shop", secretKey: "synthetic-only" },
    async () =>
      new Response(
        JSON.stringify({
          id: parentId,
          status: "succeeded",
          paid: true,
          test: true,
          amount: {
            value: (Number(f.order.cashMinor) / 100).toFixed(2),
            currency: "RUB",
          },
          created_at: time,
          captured_at: time,
          metadata: { order_id: f.order.orderId },
          refundable: true,
        }),
        { status: 200 },
      ),
  );
  const verified = await new YooKassaPaymentVerifier(
    client,
    legacy,
  ).verifyPayment(bound);
  if (!verified) throw Error("genuine synthetic parent verification failed");
  await new PostgresExpertResidencyProviderInboxRepository(
    context.db.db,
  ).settle(verified);
  await legacy.resolve(payment.id, "succeeded");
  return { ...f, legacy, parentId };
}
it("authorized refund recovery requires exact operation metadata and independently verified parent mode; binds without POST", async () => {
  const f = await refundSubject(),
    d = descriptor("main_refund");
  const operation = await f.legacy.claim({
    commandId: randomUUID(),
    orderId: f.order.orderId,
    kind: "create_refund",
    mode: "test",
    amountMinor: f.order.cashMinor,
    currency: "RUB",
    parentPaymentId: f.parentId,
    requestDigest: d.requestDigest,
  });
  d.idempotencyKey = operation.idempotencyKey;
  const s = (await source.prepare(
    "refund",
    f.userId,
    operation.id,
    f.contactId,
    d,
  ))!;
  expect(s).not.toBeNull();
  await claim(s);
  const refund: YooKassaRefund = {
    id: "task3-refund-" + randomUUID(),
    paymentId: f.parentId,
    status: "succeeded",
    amount: {
      value: (Number(s.amountMinor) / 100).toFixed(2),
      currency: "RUB",
    },
    createdAt: "2027-01-11T12:00:00.000Z",
    metadata: {
      purpose: "public_main_refund",
      operation_id: operation.id,
      order_id: f.order.orderId,
      user_id: f.userId,
    },
  };
  let wrongMode = true;
  const parent: YooKassaPayment = {
    id: f.parentId,
    status: "succeeded",
    paid: true,
    test: true,
    amount: refund.amount,
    createdAt: "2027-01-11T11:00:00.000Z",
    capturedAt: "2027-01-11T11:01:00.000Z",
    metadata: {
      purpose: "main_residency",
      order_id: f.order.orderId,
      user_id: f.userId,
      operation_id: randomUUID(),
    },
    refundable: true,
  };
  const transport = {
    listRefunds: async () => ({ complete: true as const, items: [refund] }),
    getRefund: async () => refund,
    getPayment: async () => ({ ...parent, test: !wrongMode }),
    listPayments: async () => ({ complete: true as const, items: [] }),
  };
  const recovery = new PublicExpertRecovery({
    binder,
    observations,
    transport,
    now: () => "2027-01-11T12:00:00.000Z",
  });
  expect((await recovery.recover(s.requestId)).kind).toBe("pending");
  expect((await binder.candidate(s.requestId))?.providerObjectId).toBeNull();
  wrongMode = false;
  const result = await recovery.recover(s.requestId);
  expect(result.kind).toBe("observed");
  if (result.kind === "observed")
    expect(result.observation).toMatchObject({
      paid: null,
      providerCapturedAt: null,
      paymentMethodType: null,
      parentPaymentId: f.parentId,
    });
  expect(await source.source("refund", randomUUID(), operation.id)).toBeNull();
});

it("preallocated authorized refund sends the exact canonical fiscal body once and recovers after response loss", async () => {
  const f = await refundSubject();
  const operationId = randomUUID();
  const { buildPublicExpertPaymentRequest } =
    await import("./public-expert-payment-gateway.js");
  const { createPublicTestReplay } =
    await import("../testkit/public-expert-payment.js");
  const main = (await source.source("main", f.userId, f.order.orderId))!;
  const body = buildPublicExpertPaymentRequest(
    { ...main, product: "refund", operationId, parentPaymentId: f.parentId },
    "main_refund",
    operationId,
    "private-adapter@example.invalid",
    "https://example.invalid/return",
    1,
  );
  const command = {
    commandId: randomUUID(),
    deliveryOperationId: operationId,
    orderId: f.order.orderId,
    kind: "create_refund" as const,
    mode: "test" as const,
    amountMinor: f.order.cashMinor,
    currency: "RUB" as const,
    parentPaymentId: f.parentId,
    requestDigest: publicTestDigest(body),
  };
  const operation = await f.legacy.claim(command);
  expect(operation.id).toBe(operationId);
  expect((await f.legacy.claim(command)).id).toBe(operationId);
  await expect(
    f.legacy.claim({ ...command, deliveryOperationId: randomUUID() }),
  ).rejects.toThrow("YOOKASSA_IDEMPOTENCY_CONFLICT");
  let posts = 0;
  let refund: YooKassaRefund | undefined;
  const parent: YooKassaPayment = {
    id: f.parentId,
    status: "succeeded",
    paid: true,
    test: true,
    amount: {
      value: (Number(f.order.cashMinor) / 100).toFixed(2),
      currency: "RUB",
    },
    createdAt: "2027-01-11T11:00:00.000Z",
    capturedAt: "2027-01-11T11:01:00.000Z",
    metadata: {
      purpose: "main_residency",
      order_id: f.order.orderId,
      user_id: f.userId,
      operation_id: randomUUID(),
    },
    refundable: true,
  };
  const transport = {
    async dispatch(
      s: import("@ii-tonya/integrations").PublicExpertPaymentSnapshot,
      bytes: Uint8Array,
    ) {
      expect(Buffer.from(bytes).toString()).toBe(body);
      await claim(s);
      posts++;
      refund = {
        id: "task3-outbound-refund-" + randomUUID(),
        paymentId: f.parentId,
        status: "pending",
        amount: parent.amount,
        createdAt: "2027-01-11T12:00:00.000Z",
        metadata: {
          purpose: "public_main_refund",
          operation_id: operation.id,
          order_id: f.order.orderId,
          user_id: f.userId,
        },
      };
      throw Error("response lost");
    },
    listRefunds: async () => ({
      complete: true as const,
      items: refund ? [refund] : [],
    }),
    getRefund: async () => {
      if (!refund) throw Error("missing");
      return refund;
    },
    getPayment: async () => parent,
    listPayments: async () => ({ complete: true as const, items: [] }),
  };
  const recovery = new PublicExpertRecovery({
    binder,
    observations,
    transport,
    now: () => "2027-01-11T12:00:00.000Z",
  });
  const deps = {
    enabled: true,
    mode: "test" as const,
    source,
    vault: publicTestVault,
    ...(await createPublicTestReplay()),
    transport,
    recovery,
    returnUrl: "https://example.invalid/return",
    vatCode: 1 as const,
  };
  expect(
    (
      await new PublicMainResidencyCheckout(deps).createOrRecoverRefund({
        userId: f.userId,
        operationId,
      })
    ).kind,
  ).toBe("observed");
  expect(
    (
      await new PublicMainResidencyCheckout(deps).createOrRecoverRefund({
        userId: f.userId,
        operationId,
      })
    ).kind,
  ).toBe("observed");
  expect(posts).toBe(1);
  const publicSource = (await source.source("refund", f.userId, operationId))!;
  expect(publicSource.requests).toHaveLength(1);
  expect(publicSource.requests[0]?.requestDigest).toBe(command.requestDigest);
  const { deliveryOperationId, ...oldCommand } = command;
  void deliveryOperationId;
  const oldDigest = canonicalYooKassaRequestDigest(oldCommand);
  expect(oldDigest).not.toBe(canonicalYooKassaRequestDigest(command));
});
it("preallocated delivery UUID collision cannot claim another source or operation", async () => {
  const f = await mainOrder(),
    operations = new PostgresYooKassaOperationRepository(context.db.db);
  const command = {
    commandId: randomUUID(),
    deliveryOperationId: randomUUID(),
    orderId: f.order.orderId,
    kind: "create_payment" as const,
    mode: "test" as const,
    amountMinor: f.order.cashMinor,
    currency: "RUB" as const,
    requestDigest: publicTestDigest("delivery-collision"),
  };
  const operation = await operations.claim(command);
  expect(operation.id).toBe(command.deliveryOperationId);
  await expect(
    operations.claim({ ...command, commandId: randomUUID() }),
  ).rejects.toThrow();
  await expect(
    operations.claim({
      ...command,
      commandId: randomUUID(),
      deliveryOperationId: "bad-uuid",
    }),
  ).rejects.toThrow("YOOKASSA_OPERATION_INVALID");
});
