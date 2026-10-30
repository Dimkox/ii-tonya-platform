import { randomUUID } from "node:crypto";
import { beforeAll, afterAll, it, expect } from "vitest";
import {
  startPublicExpertTestDatabase,
  createPublicOnboardingFixture,
  publicFixtureVersion,
  publicTestPrincipal,
  publicTestVault,
} from "../testkit/public-expert-payment.js";
import {
  PostgresPublicExpertPaymentSource,
  PostgresPublicExpertPaymentBinder,
  PostgresPublicExpertPaymentObservations,
  PublicHeldOnboardingCheckout,
} from "./public-expert-payment-gateway.js";
import {
  PublicExpertRecovery,
  type PublicExpertPaymentSnapshot,
  type YooKassaPayment,
  type YooKassaReplayAssociatedData,
} from "@ii-tonya/integrations";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import type { DrizzleDb } from "../client.js";
const connections: DrizzleDb[] = [];
let context: Awaited<ReturnType<typeof startPublicExpertTestDatabase>>;
beforeAll(async () => {
  context = await startPublicExpertTestDatabase();
  expect(await publicFixtureVersion(context.db)).toBe("170005");
}, 120000);
afterAll(async () => {
  await Promise.all(connections.map((c) => c.$client.end()));
  await context?.db.stop();
}, 120000);
async function expectPermissionDenied(query: Promise<unknown>) {
  const result = await query.then(
    () => ({ ok: true as const }),
    (error: unknown) => ({ ok: false as const, error }),
  );
  expect(result).toMatchObject({
    ok: false,
    error: { code: "42501" },
  });
}
it("source capability derives approved invoice finance and sealed receipt; wrong owner reads nothing", async () => {
  const f = await createPublicOnboardingFixture(context);
  const q = (user: string) =>
    context.db.db.$client.query(
      "select early_bird_private.public_onboarding_source($1,$2) value",
      [user, f.invoiceId],
    );
  expect((await q(f.userId)).rows[0]!.value).toMatchObject({
    userId: f.userId,
    sourceId: f.invoiceId,
    operationId: f.operationId,
    amountMinor: "300000",
    mode: "test",
    contact: {
      binding: { id: f.contactId, userId: f.userId, quoteId: f.quoteId },
    },
  });
  expect((await q(randomUUID())).rows[0]!.value).toBeNull();
});

async function runtime() {
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
  const [onboarding, main, refund, binderDb, writerDb, gateway] = roles as [
    DrizzleDb,
    DrizzleDb,
    DrizzleDb,
    DrizzleDb,
    DrizzleDb,
    DrizzleDb,
  ];
  connections.push(onboarding, main, refund, binderDb, writerDb, gateway);
  const source = new PostgresPublicExpertPaymentSource({
      onboarding,
      main,
      refund,
    }),
    binder = new PostgresPublicExpertPaymentBinder(binderDb),
    observations = new PostgresPublicExpertPaymentObservations(writerDb);
  const key = randomBytes(32);
  let postCalls = 0,
    drop: "none" | "beforeClaim" | "afterClaim" | "afterResponse" = "none";
  let payment: YooKassaPayment | undefined;
  let boundSnapshot: PublicExpertPaymentSnapshot | undefined;
  const events: string[] = [];
  const protector = {
    async protect(input: {
      body: string;
      bodyVersion: number;
      associatedData: YooKassaReplayAssociatedData;
    }) {
      const iv = randomBytes(12),
        cipher = createCipheriv("aes-256-gcm", key, iv);
      cipher.setAAD(Buffer.from(JSON.stringify(input.associatedData)));
      const ciphertext = Buffer.concat([
        cipher.update(input.body),
        cipher.final(),
      ]);
      return {
        ciphertext: Buffer.concat([
          iv,
          cipher.getAuthTag(),
          ciphertext,
        ]).toString("base64url"),
        keyReference: "fixture:task3",
        bodyVersion: 1,
        expiresAt: "2027-01-11T13:00:00.000Z",
      };
    },
  };
  const decryptor = {
    async decrypt(input: {
      encryptedBody: string;
      keyReference: string;
      associatedData: YooKassaReplayAssociatedData;
    }) {
      const raw = Buffer.from(input.encryptedBody, "base64url"),
        cipher = createDecipheriv("aes-256-gcm", key, raw.subarray(0, 12));
      cipher.setAAD(Buffer.from(JSON.stringify(input.associatedData)));
      cipher.setAuthTag(raw.subarray(12, 28));
      return {
        body: Buffer.concat([
          cipher.update(raw.subarray(28)),
          cipher.final(),
        ]).toString(),
        bodyVersion: 1,
      };
    },
  };
  const transport = {
    async dispatch(snapshot: PublicExpertPaymentSnapshot, bytes: Uint8Array) {
      events.push("dispatch");
      if (drop === "beforeClaim") throw Error("lost before claim");
      const claimed = (
        await gateway.$client.query(
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
      ).rows[0]!.value;
      expect(claimed).toMatchObject({ state: "uncertain" });
      boundSnapshot = claimed;
      if (drop === "afterClaim") throw Error("lost before provider");
      postCalls++;
      if (
        snapshot.kind === "onboarding_capture" ||
        snapshot.kind === "onboarding_cancel"
      ) {
        if (!payment || snapshot.parentPaymentId !== payment.id)
          throw Error("parent mismatch");
        if (snapshot.kind === "onboarding_capture") {
          expect(JSON.parse(Buffer.from(bytes).toString())).toEqual({
            amount: { value: "3000.00", currency: "RUB" },
          });
          payment = {
            ...payment,
            status: "succeeded",
            paid: true,
            paymentMethodType: "bank_card",
            capturedAt: "2027-01-11T12:00:00.000Z",
          };
        } else {
          expect(Buffer.from(bytes).toString()).toBe("{}");
          payment = { ...payment, status: "canceled", paid: false };
        }
        if (drop === "afterResponse") throw Error("lost parent response");
        return {
          kind: "response" as const,
          providerObjectId: payment.id,
          status: payment.status,
        };
      }
      const body = JSON.parse(Buffer.from(bytes).toString()) as {
        metadata: Record<string, string>;
        receipt: { customer: { email: string } };
        amount: { value: string; currency: "RUB" };
      };
      expect(body.receipt.customer.email).toBe(
        "private-adapter@example.invalid",
      );
      payment = {
        id: `task3_${randomUUID()}`,
        status: "pending",
        paid: false,
        test: true,
        amount: body.amount,
        createdAt: "2027-01-11T12:00:00.000Z",
        metadata: body.metadata,
        confirmation: { type: "redirect", url: "https://yookassa.ru/task3" },
        refundable: false,
      };
      if (drop === "afterResponse") throw Error("lost response");
      return {
        kind: "response" as const,
        providerObjectId: payment.id,
        status: "pending" as const,
        confirmationUrl: payment.confirmation!.url,
      };
    },
    async listPayments() {
      events.push("list");
      return { complete: true as const, items: payment ? [payment] : [] };
    },
    async listRefunds() {
      return { complete: true as const, items: [] };
    },
    async getPayment(id: string) {
      events.push("get");
      if (!payment || id !== payment.id) throw Error("unavailable");
      return payment;
    },
    async getRefund() {
      throw Error("unexpected refund");
    },
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
    protector,
    decryptor,
    transport,
    recovery,
    returnUrl: "https://example.invalid/return",
    vatCode: 1 as const,
  };
  return {
    source,
    binder,
    observations,
    deps,
    events,
    onboarding,
    binderDb,
    writerDb,
    setDrop: (value: typeof drop) => {
      drop = value;
    },
    waiting: () => {
      if (!payment) throw Error("missing parent");
      payment = {
        ...payment,
        status: "waiting_for_capture",
        paid: true,
        paymentMethodType: "bank_card",
      };
    },
    counts: () => postCalls,
    snapshot: () => boundSnapshot,
    payment: () => payment,
  };
}
it("genuine approved checkout commits before gateway claim, sends one sealed canonical held body and binds through LIST/GET", async () => {
  const f = await createPublicOnboardingFixture(context),
    r = await runtime();
  const checkout = new PublicHeldOnboardingCheckout(r.deps);
  expect(checkout.strictFirstSendCancellation).toBe(true);
  expect(
    await checkout.createCheckout({ invoiceId: f.invoiceId }),
  ).toMatchObject({ url: "https://yookassa.ru/task3" });
  expect(r.events).toEqual(["dispatch", "list", "get"]);
  expect(r.counts()).toBe(1);
  const source = (await r.source.invoice(f.invoiceId))!;
  expect(source.requests).toHaveLength(1);
  expect(source.requests[0]).toMatchObject({
    state: "bound",
    legacyOperationId: f.operationId,
    amountMinor: "300000",
  });
  expect(JSON.stringify(source.requests)).not.toContain(
    "private-adapter@example.invalid",
  );
  await new PublicHeldOnboardingCheckout(r.deps).recoverCheckout({
    invoiceId: f.invoiceId,
    operationId: f.operationId,
  });
  expect(r.counts()).toBe(1);
  await expectPermissionDenied(
    r.onboarding.$client.query("select * from payer_receipt_contacts"),
  );
  await expectPermissionDenied(
    r.onboarding.$client.query(
      "select early_bird_private.public_payment_candidate($1)",
      [source.requests[0]!.requestId],
    ),
  );
  await expectPermissionDenied(
    r.binderDb.$client.query(
      "select early_bird_private.public_onboarding_source($1,$2)",
      [f.userId, f.invoiceId],
    ),
  );
  await expectPermissionDenied(
    r.writerDb.$client.query(
      "select early_bird_private.public_payment_apply_guard($1,$2,$3)",
      [randomUUID(), randomUUID(), randomUUID()],
    ),
  );
});
it.each(["beforeClaim", "afterClaim", "afterResponse"] as const)(
  "uncertainty %s survives restart without repeating POST",
  async (drop) => {
    const f = await createPublicOnboardingFixture(context),
      r = await runtime();
    r.setDrop(drop);
    const checkout = new PublicHeldOnboardingCheckout(r.deps);
    await checkout.recoverCheckout({
      invoiceId: f.invoiceId,
      operationId: f.operationId,
    });
    const count = r.counts();
    r.setDrop("none");
    await new PublicHeldOnboardingCheckout(r.deps).recoverCheckout({
      invoiceId: f.invoiceId,
      operationId: f.operationId,
    });
    expect(r.counts()).toBe(count);
    expect(count).toBe(drop === "afterResponse" ? 1 : 0);
    expect((await r.source.invoice(f.invoiceId))!.requests).toHaveLength(1);
  },
);
it("rejects forged fresh-GET facts at binder/writer API without relying on TypeScript casting", async () => {
  const r = await runtime();
  await expect(r.binder.bind(randomUUID(), {} as never)).rejects.toThrow(
    "public_fresh_get_required",
  );
  await expect(r.observations.observe({} as never)).rejects.toThrow(
    "public_fresh_get_required",
  );
});

it("fresh held observation admits capture, contact-free parent response loss recovers GET and never repeats capture", async () => {
  const f = await createPublicOnboardingFixture(context),
    r = await runtime();
  const checkout = new PublicHeldOnboardingCheckout(r.deps);
  await checkout.createCheckout({ invoiceId: f.invoiceId });
  r.waiting();
  r.setDrop("afterResponse");
  await checkout.reconcile(f.invoiceId);
  expect(r.counts()).toBe(2);
  r.setDrop("none");
  await new PublicHeldOnboardingCheckout(r.deps).reconcile(f.invoiceId);
  expect(r.counts()).toBe(2);
  const current = (await r.source.invoice(f.invoiceId))!;
  expect(current.requests.map((p) => p.kind).sort()).toEqual([
    "onboarding_create",
    "onboarding_capture",
  ].sort());
  expect(
    current.requests.find((p) => p.kind === "onboarding_capture"),
  ).toMatchObject({
    contactId: null,
    envelope: null,
    providerObjectId: r.payment()!.id,
    state: "bound",
  });
});
it("loss of qualification and contact revocation admit only contact-free cancel of the exact held parent", async () => {
  const f = await createPublicOnboardingFixture(context),
    r = await runtime();
  const checkout = new PublicHeldOnboardingCheckout(r.deps);
  await checkout.createCheckout({ invoiceId: f.invoiceId });
  r.waiting();
  await context.db.db.$client.query(
    "update expert_onboarding_applications set archived_at=clock_timestamp(),archive_until_date=clock_timestamp()+interval '1 month' where id=$1",
    [f.applicationId],
  );
  await context.db.db.$client.query(
    "insert into early_bird_gateway_contact_state(contact_id,revoked_at) values($1,clock_timestamp()) on conflict(contact_id) do update set revoked_at=excluded.revoked_at",
    [f.contactId],
  );
  await checkout.reconcile(f.invoiceId);
  expect(r.counts()).toBe(2);
  await checkout.reconcile(f.invoiceId);
  expect(r.counts()).toBe(2);
  const current = (await r.source.invoice(f.invoiceId))!;
  expect(current.requests.map((p) => p.kind).sort()).toEqual([
    "onboarding_create",
    "onboarding_cancel",
  ].sort());
  expect(
    current.requests.find((p) => p.kind === "onboarding_cancel"),
  ).toMatchObject({
    contactId: null,
    envelope: null,
    state: "bound",
  });
});
it("prepared envelope AAD binds request, idempotency, digest and kind; corrupted authentication cannot admit or send", async () => {
  const f = await createPublicOnboardingFixture(context),
    r = await runtime();
  const s = (await r.source.invoice(f.invoiceId))!;
  const requestId = randomUUID(),
    key = randomUUID(),
    digest = `sha256:${"a".repeat(64)}`;
  const protectedBody = await r.deps.protector.protect({
    body: '{"synthetic":"private"}',
    bodyVersion: 1,
    associatedData: {
      operationId: requestId,
      operationKind: "create_payment",
      idempotencyKey: key,
      requestDigest: digest,
      bodyVersion: 1,
    },
  });
  await r.source.prepare("onboarding", f.userId, f.invoiceId, f.contactId, {
    requestId,
    idempotencyKey: key,
    kind: "onboarding_create",
    legacyDeliveryOperationId: null,
    requestDigest: digest,
    bodyVersion: 1,
    ciphertext: protectedBody.ciphertext,
    keyReference: protectedBody.keyReference,
    bodyExpiresAt: protectedBody.expiresAt,
  });
  await expect(
    r.deps.decryptor.decrypt({
      encryptedBody: protectedBody.ciphertext,
      keyReference: protectedBody.keyReference,
      associatedData: {
        operationId: randomUUID(),
        operationKind: "create_payment",
        idempotencyKey: key,
        requestDigest: digest,
        bodyVersion: 1,
      },
    }),
  ).rejects.toThrow();
  expect(
    await new PublicHeldOnboardingCheckout(r.deps).recoverCheckout({
      invoiceId: f.invoiceId,
      operationId: s.operationId!,
    }),
  ).toEqual({ kind: "pending" });
  expect(r.counts()).toBe(0);
});
