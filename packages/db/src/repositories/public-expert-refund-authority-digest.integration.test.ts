import { createHash, randomBytes, randomUUID } from "node:crypto";
import { afterAll, beforeAll, it, expect, vi } from "vitest";
import { sql } from "drizzle-orm";
import {
  ExperimentalGatewayIpc,
  createPayerReceiptVault,
  type PublicExpertPaymentSnapshot,
  type YooKassaRefund,
  type YooKassaPayment,
} from "@ii-tonya/integrations";
import {
  startPublicExpertTestDatabase,
  publicTestPrincipal,
} from "../testkit/public-expert-payment.js";
import {
  publicFinancialOwner,
  publicFinancialPrepared,
  publicFinancialTerminal,
  publicFinancialCall,
  publicFinancialClock,
} from "../testkit/public-expert-payment-financial.js";
import { PostgresExpertResidencyProviderInboxRepository } from "./expert-residency-provider-inbox-repository.js";
import {
  PostgresYooKassaOperationRepository,
  canonicalYooKassaRequestDigest,
} from "./yookassa-operation-repository.js";
import { createPublicExpertPaymentRuntime } from "../public-expert-payment-runtime.js";
import { PostgresPublicExpertPaymentSource } from "./public-expert-payment-gateway.js";
import type { DrizzleDb } from "../client.js";
let context: Awaited<ReturnType<typeof startPublicExpertTestDatabase>>;
const pools: DrizzleDb[] = [];
beforeAll(async () => {
  context = await startPublicExpertTestDatabase();
}, 120000);
afterAll(async () => {
  vi.restoreAllMocks();
  await Promise.all(pools.map((pool) => pool.$client.end()));
  await context?.db.stop();
}, 120000);
it("preserves the real refund command authority digest while dispatching separately sealed exact public bytes", async () => {
  const database = context.db;
  const f = await publicFinancialPrepared(
    database,
    await publicFinancialOwner(database),
  );
  const terminal = await publicFinancialTerminal(database, f);
  await new PostgresExpertResidencyProviderInboxRepository(
    database.db,
  ).applyPublic(
    f.d.requestId,
    terminal.observationId,
    terminal.action.applyAttemptId,
  );
  expect(
    await publicFinancialCall(database, "public_payment_complete", [
      f.d.requestId,
      terminal.action.applyAttemptId,
    ]),
  ).toMatchObject({ kind: "already_applied" });
  const now = "2027-01-11T21:05:00.000Z";
  await publicFinancialClock(database, now);
  const operations = new PostgresYooKassaOperationRepository(database.db);
  await operations.resolve(f.s.legacyOperationId, "succeeded");
  const command = {
    commandId: randomUUID(),
    orderId: f.order.orderId,
    kind: "create_refund" as const,
    mode: "test" as const,
    amountMinor: f.s.amountMinor as string,
    currency: "RUB" as const,
    parentPaymentId: terminal.fact.providerObjectId,
    // Same financial authority format as the existing refund adapter. This is
    // deliberately not a hash of its provider JSON body.
    requestDigest: `sha256:${createHash("sha256")
      .update(
        JSON.stringify({
          version: "yookassa-request-authority-v1",
          operationKind: "create_refund",
          orderId: f.order.orderId,
          parentPaymentId: terminal.fact.providerObjectId,
          mode: "test",
          amountMinor: f.s.amountMinor,
          currency: "RUB",
          receiptPolicy: {
            vatCode: 1,
            paymentSubject: "service",
            paymentMode: "full_payment",
          },
          receiptAuthority: {
            contactKind: "email",
            authorityReference: `payer:${f.s.contactId}`,
          },
        }),
      )
      .digest("hex")}`,
  };
  await expect(
    operations.claim({ ...command, parentPaymentId: "wrong-parent" }),
  ).rejects.toMatchObject({ code: "YOOKASSA_OPERATION_INVALID" });
  const refund = await operations.claim(command);
  const authorized = (
    await database.db.$client.query(
      "select request_digest,claim_digest,payment_attempt_id from expert_residency_provider_operations where id=$1",
      [refund.id],
    )
  ).rows[0]!;
  expect(authorized.claim_digest).toBe(
    canonicalYooKassaRequestDigest({
      ...command,
      paymentAttemptId: authorized.payment_attempt_id,
    }),
  );
  const vault = createPayerReceiptVault({
    activeKeyId: "fixture",
    keys: new Map([["fixture", Buffer.alloc(32, 19)]]),
  });
  const contact = (
    await database.db.$client.query(
      "select id,quote_id,user_id,captured_at,expires_at from payer_receipt_contacts where id=$1",
      [f.s.contactId],
    )
  ).rows[0]!;
  const sealed = vault.seal("period@example.invalid", {
    id: contact.id,
    quoteId: contact.quote_id,
    userId: contact.user_id,
    kind: "email",
    basis: "fiscal_payment_dec_plt_004_v1",
    capturedAt: (contact.captured_at as Date).toISOString(),
    expiresAt: (contact.expires_at as Date).toISOString(),
  });
  await database.db.transaction(async (tx) => {
    await tx.execute(
      sql`alter table payer_receipt_contacts disable trigger payer_receipt_contact_guard`,
    );
    await tx.execute(
      sql`update payer_receipt_contacts set ciphertext=${sealed.ciphertext} where id=${contact.id}::uuid`,
    );
    await tx.execute(
      sql`alter table payer_receipt_contacts enable trigger payer_receipt_contact_guard`,
    );
  });
  const connections = {} as Parameters<
    typeof createPublicExpertPaymentRuntime
  >[1]["connections"];
  for (const [name, label] of [
    ["onboardingSender", "onboarding"],
    ["mainSender", "main"],
    ["refundSender", "refund"],
    ["binder", "binder"],
    ["observations", "writer"],
  ] as const) {
    const db = await publicTestPrincipal(context, label);
    pools.push(db);
    connections[name] = {
      db,
      login: decodeURIComponent(
        new URL(db.$client.options.connectionString!).username,
      ),
    };
  }
  for (const signature of [
    "public_payment_pending(integer,uuid)",
    "public_payment_hint(text,uuid,boolean)",
  ])
    await database.db.$client.query(
      `grant execute on function early_bird_private.${signature} to ${connections.binder.login}`,
    );
  await database.db.$client.query(
    `grant execute on function early_bird_private.public_refund_pending(integer,uuid) to ${connections.refundSender.login}`,
  );
  const gateway = new ExperimentalGatewayIpc({
    address: "\0unused-refund",
    key: Buffer.alloc(32, 1),
    authKey: Buffer.alloc(32, 2),
    timeoutMs: 10,
  });
  let sent: PublicExpertPaymentSnapshot | undefined,
    provider: YooKassaRefund | undefined,
    posts = 0;
  const parent: YooKassaPayment = {
    id: terminal.fact.providerObjectId,
    status: "succeeded",
    paid: true,
    test: true,
    refundable: true,
    amount: {
      value: `${BigInt(f.s.amountMinor) / 100n}.${(BigInt(f.s.amountMinor) % 100n).toString().padStart(2, "0")}`,
      currency: "RUB",
    },
    createdAt: terminal.fact.providerCreatedAt,
    capturedAt: terminal.fact.providerCapturedAt!,
    paymentMethodType: "bank_card",
    metadata: {
      purpose: "main_residency",
      operation_id: f.s.legacyOperationId,
      order_id: f.order.orderId,
      user_id: f.userId,
    },
  };
  vi.spyOn(gateway, "dispatchPublic").mockImplementation(
    async (snapshot, bytes) => {
      sent = snapshot;
      posts++;
      const body = JSON.parse(Buffer.from(bytes).toString());
      expect(body.payment_id).toBe(parent.id);
      expect(body.amount).toEqual(parent.amount);
      expect(snapshot.requestDigest).not.toBe(command.requestDigest);
      expect(
        (
          await database.db.$client.query(
            "select public.public_expert_gateway_claim($1,$2,$3,$4,$5,$6) value",
            [
              snapshot.userId,
              snapshot.requestId,
              snapshot.contactId,
              snapshot.idempotencyKey,
              snapshot.requestDigest,
              snapshot.kind,
            ],
          )
        ).rows[0]!.value,
      ).toMatchObject({ state: "uncertain" });
      provider = {
        id: "refund_" + randomUUID(),
        paymentId: parent.id,
        status: "succeeded",
        amount: parent.amount,
        createdAt: now,
        metadata: body.metadata,
      };
      throw Error("lost-refund-response");
    },
  );
  vi.spyOn(gateway, "listPublicPage").mockImplementation(async () => ({
    items: provider ? [provider] : [],
  }));
  vi.spyOn(gateway, "getRefund").mockImplementation(async (id) => {
    expect(id).toBe(provider!.id);
    return provider!;
  });
  vi.spyOn(gateway, "getPayment").mockResolvedValue(parent);
  vi.spyOn(Date, "now").mockReturnValue(Date.parse(now));
  const key = randomBytes(32);
  const runtime = createPublicExpertPaymentRuntime(database.db, {
    connections,
    gateway,
    mode: "test",
    messagingConsentPolicyVersion: "client-messaging-v1",
    vault,
    requestKey: key,
    requestKeyReference: "public:fixture",
    retainedRequestKeys: new Map([["public:fixture", key]]),
    returnUrl: "https://ii-tonya.ru/return",
    vatCode: 1,
  });
  try {
    expect(
      await runtime.main.createOrRecoverRefund({
        userId: randomUUID(),
        operationId: refund.id,
      }),
    ).toEqual({ kind: "unavailable" });
    expect(posts).toBe(0);
    // A process failure after preparation permits only its first authorized
    // send, using the retained sealed bytes. Uncertain dispatch never replays.
    const admission = vi
      .spyOn(PostgresPublicExpertPaymentSource.prototype, "admit")
      .mockRejectedValueOnce(Error("transient-admission-unavailable"));
    await expect(
      runtime.main.createOrRecoverRefund({
        userId: f.userId,
        operationId: refund.id,
      }),
    ).rejects.toThrow("transient-admission-unavailable");
    admission.mockRestore();
    expect(posts).toBe(0);
    expect(
      (
        await connections.refundSender.db.$client.query(
          "select early_bird_private.public_refund_pending(10,null) value",
        )
      ).rows[0]!.value,
    ).toContainEqual({ userId: f.userId, operationId: refund.id });
    await runtime.runOnce();
    expect(posts).toBe(1);
    expect(
      (
        await runtime.main.createOrRecoverRefund({
          userId: f.userId,
          operationId: refund.id,
        })
      ).kind,
    ).toBe("observed");
    expect(posts).toBe(1);
    const original = (
      await database.db.$client.query(
        "select request_digest,claim_digest from expert_residency_provider_operations where id=$1",
        [refund.id],
      )
    ).rows[0]!;
    expect(original).toEqual({
      request_digest: command.requestDigest,
      claim_digest: authorized.claim_digest,
    });
    const rejectingGateway = new ExperimentalGatewayIpc({
      address: "\0never-connect",
      key: Buffer.alloc(32, 1),
      authKey: Buffer.alloc(32, 2),
      timeoutMs: 10,
    });
    expect(
      await rejectingGateway.dispatchPublic(sent!, Buffer.from("{}")),
    ).toEqual({ kind: "unknown" });
  } finally {
    await runtime.stop();
  }
}, 30000);
