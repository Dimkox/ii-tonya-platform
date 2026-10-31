import { createHash, randomBytes, randomUUID } from "node:crypto";
import { beforeAll, afterAll, afterEach, expect, it, vi } from "vitest";
import { sql } from "drizzle-orm";
import {
  ExperimentalGatewayIpc,
  type PublicExpertPaymentSnapshot,
  type YooKassaPayment,
} from "@ii-tonya/integrations";
import {
  startPublicExpertTestDatabase,
  createPublicOnboardingFixture,
  publicTestVault,
  publicTestNow,
  publicFixtureVersion,
} from "../testkit/public-expert-payment.js";
import { createPublicExpertPaymentRuntime } from "../public-expert-payment-runtime.js";
import { createPublicExpertRuntimePrincipals } from "../testkit/public-expert-runtime-principals.js";
import { createReceiptContactFence } from "../../../../apps/api/src/receipt-disclosure-contact-fence.js";
import { composeReceiptRetention } from "../../../../apps/worker/src/receipt-disclosure-retention.js";
import { PostgresPayerReceiptContactRepository } from "./payer-receipt-contact-repository.js";
import { PostgresPrivacyRepository } from "./privacy-repository.js";

let context: Awaited<ReturnType<typeof startPublicExpertTestDatabase>>;
let principals: Awaited<ReturnType<typeof createPublicExpertRuntimePrincipals>>;
beforeAll(async () => {
  context = await startPublicExpertTestDatabase();
  expect(await publicFixtureVersion(context.db)).toBe("170005");
  principals = await createPublicExpertRuntimePrincipals(context.db.db);
}, 120000);
afterEach(() => vi.restoreAllMocks());
afterAll(async () => {
  try {
    await principals?.close();
  } finally {
    await context?.db.stop();
  }
}, 120000);
async function fixture() {
  const f = await createPublicOnboardingFixture(context);
  // The public financial clock is in January while the disposable cluster's
  // physical retention clock is the actual test date. Keep honest vault AAD and
  // millisecond timestamps valid for both clocks; no production guard is changed.
  const capturedAt = (
    await context.db.db.$client.query(
      "select date_trunc('milliseconds',clock_timestamp()-interval '2 hours') at",
    )
  ).rows[0]!.at as Date;
  const sealed = publicTestVault.seal("private-adapter@example.invalid", {
    id: f.contactId,
    quoteId: f.quoteId,
    userId: f.userId,
    kind: "email",
    basis: "fiscal_payment_dec_plt_004_v1",
    capturedAt: capturedAt.toISOString(),
    expiresAt: "2027-01-11T14:00:00.000Z",
  });
  await context.db.db.transaction(async (tx) => {
    await tx.execute(
      sql`alter table payer_receipt_contacts disable trigger payer_receipt_contact_guard`,
    );
    await tx.execute(
      sql`update payer_receipt_contacts set captured_at=${capturedAt.toISOString()}::timestamptz,ciphertext=${sealed.ciphertext} where id=${f.contactId}::uuid`,
    );
    await tx.execute(
      sql`alter table payer_receipt_contacts enable trigger payer_receipt_contact_guard`,
    );
  });
  // Serial cases share the one canonical LOGIN per capability in this cluster.
  const { connections } = principals;
  const key = randomBytes(32);
  let posts = 0,
    payment: YooKassaPayment | undefined,
    listAvailable = true;
  const gateway = new ExperimentalGatewayIpc({
    address: "\0unused-public-runtime",
    key: Buffer.alloc(32, 1),
    authKey: Buffer.alloc(32, 2),
    timeoutMs: 10,
  });
  vi.spyOn(gateway, "dispatchPublic").mockImplementation(
    async (s: PublicExpertPaymentSnapshot, body: Uint8Array) => {
      const claimed = (
        await context.db.db.$client.query(
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
      expect(claimed).toMatchObject({ state: "uncertain" });
      posts++;
      if (s.kind === "onboarding_create") {
        const metadata = JSON.parse(Buffer.from(body).toString()).metadata;
        payment = {
          id: "composed_" + randomUUID(),
          status: "pending",
          paid: false,
          test: true,
          refundable: false,
          amount: { value: "3000.00", currency: "RUB" },
          createdAt: publicTestNow,
          paymentMethodType: "bank_card",
          metadata,
          confirmation: {
            type: "redirect",
            url: "https://yookassa.ru/checkout",
          },
        };
      } else {
        expect(s.contactId).toBeNull();
        expect(s.parentPaymentId).toBe(payment!.id);
        if (s.kind === "onboarding_cancel")
          expect(Buffer.from(body).toString()).toBe("{}");
        payment = {
          ...payment!,
          status: s.kind === "onboarding_cancel" ? "canceled" : "succeeded",
          paid: s.kind !== "onboarding_cancel",
          ...(s.kind === "onboarding_capture"
            ? { capturedAt: publicTestNow }
            : {}),
        };
      }
      throw Error("lost-response-after-real-claim");
    },
  );
  vi.spyOn(gateway, "listPublicPage").mockImplementation(async () => {
    if (!listAvailable) throw Error("unavailable");
    return { items: payment ? [payment] : [] };
  });
  vi.spyOn(gateway, "getPayment").mockImplementation(async (id) => {
    if (payment?.id !== id) throw Error("not_found");
    return payment;
  });
  vi.spyOn(Date, "now").mockReturnValue(Date.parse(publicTestNow));
  const runtime = createPublicExpertPaymentRuntime(context.db.db, {
    connections,
    gateway,
    mode: "test",
    messagingConsentPolicyVersion: "client-messaging-v1",
    vault: publicTestVault,
    requestKey: key,
    requestKeyReference: "public:fixture",
    retainedRequestKeys: new Map([["public:fixture", key]]),
    returnUrl: "https://ii-tonya.ru/return",
    vatCode: 1,
  });
  return {
    f,
    connections,
    gateway,
    runtime,
    posts: () => posts,
    list: (available: boolean) => {
      listAvailable = available;
    },
    paymentId: () => payment!.id,
    waiting: () => {
      payment = { ...payment!, status: "waiting_for_capture", paid: true };
    },
  };
}
it("public runtime refuses new creation before launch without POST, regardless of configured capability", async () => {
  const r = await fixture();
  await context.db.db.$client.query(
    "create or replace function early_bird_current_time() returns timestamptz language sql volatile as $$select '2027-01-10T12:00:00Z'::timestamptz$$",
  );
  try {
    await expect(
      r.runtime.held.createCheckout({ invoiceId: r.f.invoiceId }),
    ).rejects.toThrow("held_checkout_unavailable");
    expect(r.posts()).toBe(0);
  } finally {
    await r.runtime.stop();
    await context.db.db.$client.query(
      "create or replace function early_bird_current_time() returns timestamptz language sql volatile as $$select '2027-01-11T12:00:00Z'::timestamptz$$",
    );
  }
}, 30000);
it("lost webhook recovery performs fresh GET and only the first authorized capture, posting the canonical onboarding fact", async () => {
  const r = await fixture();
  try {
    await r.runtime.assertReady();
    expect(
      await r.runtime.held.createCheckout({ invoiceId: r.f.invoiceId }),
    ).toMatchObject({ paymentId: expect.any(String) });
    r.waiting();
    await r.runtime.runOnce();
    await r.runtime.runOnce();
    expect(r.posts()).toBe(2);
    expect(
      (
        await context.db.db.$client.query(
          "select status from expert_onboarding_invoices where id=$1",
          [r.f.invoiceId],
        )
      ).rows[0]!.status,
    ).toBe("settled");
    expect(
      (
        await r.connections.binder.db.$client.query(
          "select early_bird_private.public_payment_pending(100,null) value",
        )
      ).rows[0]!.value.length,
    ).toBeLessThanOrEqual(10);
  } finally {
    await r.runtime.stop();
  }
}, 30000);
it("initially unbound callback discovers the public request from fresh GET and never repeats the uncertain POST", async () => {
  const r = await fixture();
  try {
    r.list(false);
    await expect(
      r.runtime.held.createCheckout({ invoiceId: r.f.invoiceId }),
    ).rejects.toThrow("held_checkout_unavailable");
    expect(r.posts()).toBe(1);
    const notification = {
      event: "payment.waiting_for_capture",
      object: { id: r.paymentId() },
    };
    expect(await r.runtime.handle(notification)).toBe("pending");
    r.list(true);
    expect(await r.runtime.handle(notification)).toBe("complete");
    expect(r.posts()).toBe(1);
    expect(
      (
        await context.db.db.$client.query(
          "select state,provider_object_id from public_expert_payment_requests where invoice_id=$1",
          [r.f.invoiceId],
        )
      ).rows[0],
    ).toMatchObject({ state: "bound", provider_object_id: r.paymentId() });
  } finally {
    await r.runtime.stop();
  }
}, 30000);
it.each(["privacy", "manual", "ttl"] as const)(
  "%s cleanup waits for contact ACK, erases envelopes and preserves contact-free cancellation",
  async (kind) => {
    const r = await fixture();
    try {
      await r.runtime.held.createCheckout({ invoiceId: r.f.invoiceId });
      r.waiting();
      const read = async () =>
        (
          await context.db.db.$client.query(
            "select c.ciphertext,r.encrypted_body,r.request_digest from payer_receipt_contacts c join public_expert_payment_requests r on r.contact_id=c.id where c.id=$1",
            [r.f.contactId],
          )
        ).rows[0]!;
      const before = await read();
      expect(before.ciphertext).toBeTruthy();
      expect(before.encrypted_body).toBeTruthy();
      let ack!: () => void, entered!: () => void;
      const pendingAck = new Promise<void>((resolve) => {
          ack = resolve;
        }),
        started = new Promise<void>((resolve) => {
          entered = resolve;
        });
      vi.spyOn(r.gateway, "revokeContactToken").mockImplementation(
        async (_token, id) => {
          expect(id).toBe(r.f.contactId);
          entered();
          await pendingAck;
          await context.db.db.$client.query(
            "select public.early_bird_gateway_revoke($1)",
            [id],
          );
        },
      );
      vi.spyOn(r.gateway, "revokeContact").mockImplementation(async (id) =>
        r.gateway.revokeContactToken(r.gateway.contactToken(id), id),
      );
      const repository = new PostgresPayerReceiptContactRepository(
        context.db.db,
      );
      const retention = () =>
        composeReceiptRetention(
          {
            listExpiredBatch: async () =>
              (await repository.listExpiredBatch(100)).filter(
                (row) => row.id === r.f.contactId,
              ),
            redactExpiredSelection: (plan) =>
              repository.redactExpiredSelection(plan),
          },
          { checkoutEnabled: true, gateway: r.gateway },
        )();
      const privacy = new PostgresPrivacyRepository(context.db.db, {
        beforePrivacyReceiptDisclosure: createReceiptContactFence(
          r.gateway,
          "fixture",
        ),
        privacyMutationCapability: {
          enabled: true,
          captureManifests: async () =>
            ["object_store", "selarti", "planerka", "make_projection"].map(
              (processor) => ({
                processor: processor as
                  "object_store" | "selarti" | "planerka" | "make_projection",
                ciphertext: "fixture",
                keyReference: "kms://fixture",
                algorithm: "fixture",
                version: "v1",
                subjectDeletionKeyHash: "d".repeat(64),
              }),
            ),
          verifyEnvelope: () => true,
        },
      });
      if (kind === "ttl") {
        // Fixture clock seam only: real TTL predicate must be due before cleanup.
        await context.db.db.transaction(async (tx) => {
          await tx.execute(
            sql`alter table payer_receipt_contacts disable trigger payer_receipt_contact_guard`,
          );
          await tx.execute(
            sql`update payer_receipt_contacts set captured_at=date_trunc('milliseconds',clock_timestamp()-interval '2 hours'),expires_at=date_trunc('milliseconds',clock_timestamp()-interval '1 hour') where id=${r.f.contactId}::uuid`,
          );
          await tx.execute(
            sql`alter table payer_receipt_contacts enable trigger payer_receipt_contact_guard`,
          );
        });
      }
      const erase =
        kind === "ttl"
          ? retention()
          : kind === "manual"
            ? privacy.withdrawConsentAtomically({
                targetUserId: r.f.userId,
                purpose: "client_messaging",
                policyVersion: "client-messaging-v1",
                correlationId: randomUUID(),
              })
            : privacy.startErasureAtomically({
                targetUserId: r.f.userId,
                correlationId: randomUUID(),
                idempotencyKey: randomUUID(),
                pseudonym: `hmac:${"a".repeat(64)}`,
              });
      await started;
      expect((await read()).ciphertext).toBe(before.ciphertext);
      ack();
      await erase;
      if (kind !== "ttl") await retention();
      expect(await read()).toMatchObject({
        ciphertext: null,
        encrypted_body: null,
        request_digest: before.request_digest,
      });
      if (kind !== "ttl") {
        // The genuine privacy command must preserve financial uncertainty and
        // revoke live capture authority without inventing provider cancellation.
        const retained = (
          await context.db.db.$client.query(
            "select i.status,i.application_id,op.provider_object_id from expert_onboarding_invoices i join expert_onboarding_payment_operations op on op.invoice_id=i.id where i.id=$1",
            [r.f.invoiceId],
          )
        ).rows[0]!;
        expect(retained.status).toBe("pending");
        expect(retained.provider_object_id).toBe(r.paymentId());
        if (kind === "privacy") expect(retained.application_id).toBeNull();
        const source = (
          await r.connections.onboardingSender.db.$client.query(
            "select early_bird_private.public_onboarding_invoice($1) value",
            [r.f.invoiceId],
          )
        ).rows[0]!.value;
        expect(source).toMatchObject({
          current: false,
          contact: null,
          operationId: r.f.operationId,
        });
        expect(JSON.stringify(source)).not.toContain(
          "private-adapter@example.invalid",
        );
        expect(
          await r.runtime.held.recoverCheckout({
            invoiceId: r.f.invoiceId,
            operationId: randomUUID(),
          }),
        ).toEqual({ kind: "unavailable" });
        const id = (
          await context.db.db.$client.query(
            "select id from public_expert_payment_requests where invoice_id=$1 and kind='onboarding_create'",
            [r.f.invoiceId],
          )
        ).rows[0]!.id as string;
        expect((await r.runtime.recovery.recover(id)).kind).toBe("observed");
        const descriptor = {
          requestId: randomUUID(),
          idempotencyKey: randomUUID(),
          kind: "onboarding_capture",
          legacyDeliveryOperationId: null,
          requestDigest: `sha256:${createHash("sha256").update('{"amount":{"value":"3000.00","currency":"RUB"}}').digest("hex")}`,
          bodyVersion: 1,
          ciphertext: null,
          keyReference: null,
          bodyExpiresAt: null,
        };
        expect(
          (
            await r.connections.onboardingSender.db.$client.query(
              "select early_bird_private.public_onboarding_prepare($1,$2,null,$3::jsonb) value",
              [r.f.userId, r.f.invoiceId, JSON.stringify(descriptor)],
            )
          ).rows[0]!.value,
        ).toBeNull();
        expect(r.posts()).toBe(1);
      }
      await context.db.db.$client.query(
        "create or replace function early_bird_current_time() returns timestamptz language sql volatile as $$select '2027-01-11T15:00:00Z'::timestamptz$$",
      );
      vi.spyOn(Date, "now").mockReturnValue(Date.parse("2027-01-11T15:00:00Z"));
      await r.runtime.held.reconcile(r.f.invoiceId);
      expect(r.posts()).toBe(2);
      expect(
        (
          await context.db.db.$client.query(
            "select count(*)::int n from public_expert_payment_requests where invoice_id=$1 and kind='onboarding_capture'",
            [r.f.invoiceId],
          )
        ).rows[0]!.n,
      ).toBe(0);
      expect(
        (
          await context.db.db.$client.query(
            "select kind,contact_id,encrypted_body from public_expert_payment_requests where invoice_id=$1 and kind='onboarding_cancel'",
            [r.f.invoiceId],
          )
        ).rows[0],
      ).toMatchObject({
        kind: "onboarding_cancel",
        contact_id: null,
        encrypted_body: null,
      });
    } finally {
      await r.runtime.stop();
      await context.db.db.$client.query(
        "create or replace function early_bird_current_time() returns timestamptz language sql volatile as $$select '2027-01-11T12:00:00Z'::timestamptz$$",
      );
    }
  },
  30000,
);
