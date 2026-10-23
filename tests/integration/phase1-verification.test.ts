import { verifyExpertOfferProfile } from "../../packages/db/src/repositories/expert-offer-v2.js";
import { createHash, randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  createYooKassaClient,
  YooKassaOnboardingPaymentVerifier,
  YooKassaOnboardingWebhookCapability,
  type OnboardingPaymentBinding,
  type VerifiedOnboardingPayment,
} from "@ii-tonya/integrations";
import { PostgresExpertVerificationRepository } from "../../packages/db/src/repositories/expert-verification-repository.js";
import { PostgresExpertPromoRepository } from "../../packages/db/src/repositories/expert-promo-repository.js";
import { PostgresPrivacyRepository } from "../../packages/db/src/repositories/privacy-repository.js";
import { PostgresWebhookInboxRepository } from "../../packages/db/src/repositories/webhook-inbox-repository.js";
import { seedClientConsent } from "../../packages/db/src/testkit/client-consent.js";
import {
  startExpertReferralTestDatabase,
  type ExpertReferralTestDatabase,
} from "../../packages/db/src/testkit/expert-referral.js";
import { yookassaWebhookRoutes } from "../../apps/api/src/routes/yookassa-webhook.js";

const apiRequire = createRequire(
  new URL("../../apps/api/package.json", import.meta.url),
);
const Fastify = apiRequire("fastify") as (options: {
  logger: false;
}) => Parameters<typeof yookassaWebhookRoutes>[0];
let database: ExpertReferralTestDatabase;
let repo: PostgresExpertVerificationRepository;
let promo: PostgresExpertPromoRepository;
let tariffId: string;
let support: { userId: string; sessionHash: string };
let sequence = 920000;
const sha = (v: string) => createHash("sha256").update(v).digest("hex");
const request = <T extends object>(scope: T) => {
  const requestKey = randomUUID();
  return { ...scope, requestKey, requestDigest: sha(requestKey) };
};
async function manager(
  role = "support",
  state:
    | "active"
    | "expired"
    | "stale_mfa"
    | "revoked"
    | "infinite_expiry" = "active",
) {
  const userId = await database.createUser();
  const sessionHash = `sha256:${sha(randomUUID())}`;
  await database.db.execute(
    sql`insert into admin_sessions(session_id_hash,admin_id,mfa_verified_at,expires_at,revoked_at) values(${sessionHash},${userId}::uuid,clock_timestamp()-${state === "expired" ? 7200 : state === "stale_mfa" ? 1200 : 0}*interval '1 second',${state === "infinite_expiry" ? sql`'infinity'::timestamptz` : sql`clock_timestamp()+${state === "expired" ? -3600 : 3600}*interval '1 second'`},${state === "revoked" ? sql`clock_timestamp()` : sql`null`})`,
  );
  await database.db.execute(
    sql`insert into admin_role_assignments(admin_id,role) values(${userId}::uuid,${role})`,
  );
  return { userId, sessionHash };
}
async function application() {
  const userId = await database.createUser();
  const telegramUserId = String(++sequence);
  const scope = {
    userId,
    botKey: "verification-fixture",
    botId: "717171",
    telegramUserId,
    chatId: telegramUserId,
  };
  await database.db.execute(
    sql`insert into channel_identities(user_id,provider,external_id,bot_key,external_chat_id,status) values(${userId}::uuid,'telegram',${telegramUserId},${scope.botKey},${telegramUserId},'active')`,
  );
  const consent = await seedClientConsent(
    database.db,
    userId,
    "client_messaging",
  );
  await database.db.execute(
    sql`insert into expert_promo_enrollments(user_id,channel_identity_id,bot_id,presentation_id,policy_version,status) select ${userId}::uuid,ci.id,${scope.botId},c.presentation_id,'client-messaging-v1','granted' from channel_identities ci join consents c on c.id=${consent.decisionId}::uuid where ci.user_id=${userId}::uuid and ci.provider='telegram' and ci.bot_key=${scope.botKey} and ci.external_id=${scope.telegramUserId} and ci.external_chat_id=${scope.chatId} and ci.status='active' on conflict(user_id) do nothing`,
  );
  await promo.register(request(scope));
  const profile = await promo.saveProfile({
    ...request(scope),
    cityCode: "kazan",
    millionCity: false,
    serviceFormat: "offline",
    ticketMinor: "300000",
    participantKind: "expert",
  });
  await verifyExpertOfferProfile(database.db, {
    sessionHash: support.sessionHash,
    userId,
    revision: profile.revision,
  });
  const quote = await promo.createQuote({
    ...request(scope),
    tariffVersionId: tariffId,
    termMonths: 1,
  });
  const app = await promo.createApplication({
    ...request(scope),
    quoteId: quote.id,
  });
  return { scope, quote, applicationId: app.applicationId };
}
async function approved() {
  const f = await application();
  const decision = await repo.decide({
    sessionHash: support.sessionHash,
    applicationId: f.applicationId,
    decision: "approved",
    reasonCode: "identity_verified",
    idempotencyKey: randomUUID(),
  });
  const invoice = await repo.invoiceForOwner(f.scope, decision.invoiceId!);
  if (!invoice) throw new Error("fixture_invoice_missing");
  return { ...f, invoice };
}
async function bound() {
  const f = await approved();
  const providerObjectId = `synthetic_${randomUUID()}`;
  await repo.bindPayment(f.invoice.id, {
    id: f.invoice.operationId,
    providerObjectId,
    userId: f.scope.userId,
    purpose: "onboarding",
    amountMinor: "300000",
    currency: "RUB",
    mode: "test",
  });
  const binding = await repo.findOnboardingPaymentBinding(f.invoice.id);
  if (!binding) throw new Error("fixture_binding_missing");
  return { ...f, binding };
}
function payment(
  binding: OnboardingPaymentBinding,
  patch: Record<string, unknown> = {},
) {
  return {
    id: binding.providerObjectId,
    status: "succeeded",
    paid: true,
    amount: { value: "3000.00", currency: "RUB" },
    test: binding.mode === "test",
    created_at: new Date(Date.now() - 1000).toISOString(),
    captured_at: new Date().toISOString(),
    metadata: {
      order_id: binding.invoiceId,
      user_id: binding.userId,
      purpose: binding.purpose,
      operation_id: binding.operationId,
    },
    refundable: true,
    ...patch,
  };
}
function verifier(
  binding: OnboardingPaymentBinding,
  body: Record<string, unknown> = payment(binding),
  bindingPort: Pick<
    PostgresExpertVerificationRepository,
    "findOnboardingPaymentBinding"
  > = repo,
) {
  const calls: { url: string; method: string }[] = [];
  const client = createYooKassaClient(
    {
      mode: binding.mode,
      shopId: "test-shop",
      secretKey: "synthetic-fixture-only",
    },
    async (url, init) => {
      calls.push({ url, method: String(init.method) });
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    },
  );
  return {
    verifier: new YooKassaOnboardingPaymentVerifier(client, bindingPort),
    calls,
  };
}
async function webhook(
  binding: OnboardingPaymentBinding,
  body: Record<string, unknown> = payment(binding),
) {
  const get = verifier(binding, body);
  const legacy = vi.fn(async () => {
    throw new Error("legacy_unbound_payment_retry");
  });
  const app = Fastify({ logger: false });
  await yookassaWebhookRoutes(app, {
    effectivePeerAddress: () => "185.71.76.1",
    inbox: new PostgresWebhookInboxRepository(database.db),
    verify: legacy,
    deliver: async () => {
      throw new Error("residency_delivery_forbidden");
    },
    resolveSucceeded: async () => {
      throw new Error("residency_resolution_forbidden");
    },
    onboarding: new YooKassaOnboardingWebhookCapability(
      repo,
      get.verifier,
      repo,
    ),
  });
  return {
    app,
    legacy,
    calls: get.calls,
    notify: () =>
      app.inject({
        method: "POST",
        url: "/v1/webhooks/yookassa",
        payload: {
          type: "notification",
          event: "payment.succeeded",
          object: { id: binding.providerObjectId },
        },
      }),
  };
}
function privacy() {
  return new PostgresPrivacyRepository(database.db, {
    privacyMutationCapability: {
      enabled: true,
      captureManifests: async () =>
        ["object_store", "selarti", "planerka", "make_projection"].map(
          (processor) => ({
            processor: processor as
              "object_store" | "selarti" | "planerka" | "make_projection",
            ciphertext: `ciphertext:${processor}`,
            keyReference: `fixture:${processor}`,
            algorithm: "test-envelope-v1",
            version: "1",
            subjectDeletionKeyHash: `sha256:${processor}`,
          }),
        ),
      verifyEnvelope: () => true,
    },
  });
}
async function noResidencyAuthority() {
  expect(
    (
      await database.db.execute(
        sql`select (select count(*)::int from expert_residency_orders) orders,(select count(*)::int from expert_first_residency_settlements) first_settlements,(select count(*)::int from expert_referral_reward_grants) rewards,(select count(*)::int from expert_referral_ledger_entries) referral_ledger,(select count(*)::int from experts) experts,(select count(*)::int from client_coupon_grants) coupons,(select count(*)::int from message_ledger_entries) message_ledger`,
      )
    ).rows[0],
  ).toEqual({
    orders: 0,
    first_settlements: 0,
    rewards: 0,
    referral_ledger: 0,
    experts: 0,
    coupons: 0,
    message_ledger: 0,
  });
}

describe("Phase1 manager verification and isolated onboarding payment (PG17.5)", () => {
  beforeAll(async () => {
    database = await startExpertReferralTestDatabase();
    expect(
      (await database.db.execute(sql`show server_version_num`)).rows[0]
        ?.server_version_num,
    ).toBe("170005");
    repo = new PostgresExpertVerificationRepository(database.db, {
      providerMode: "test",
      messagingConsentPolicyVersion: "client-messaging-v1",
    });
    promo = new PostgresExpertPromoRepository(database.db, {
      messagingConsentPolicyVersion: "client-messaging-v1",
    });
    tariffId = await database.createResidencyTariff({
      tariffKey: "PRO",
      displayName: "PRO",
      priceMinor: 999000,
      durationSeconds: 2592000,
    });
    support = await manager();
  }, 120000);
  afterAll(async () => {
    await database?.stop();
  }, 120000);
  it("uses original MFA roles for masked queue and protected necessary contact detail", async () => {
    const f = await application();
    const queue = await repo.listQueue(support.sessionHash, 1);
    expect(queue).toHaveLength(1);
    expect(queue[0]).toMatchObject({
      applicationId: f.applicationId,
      maskedContact: "telegram:***",
      status: "pending",
    });
    expect(JSON.stringify(queue)).not.toContain(f.scope.telegramUserId);
    expect(
      await repo.applicationDetail(support.sessionHash, f.applicationId),
    ).toMatchObject({
      userId: f.scope.userId,
      contact: [{ provider: "telegram", externalId: f.scope.telegramUserId }],
      questionnaire: {
        status: "waiting_content",
        contentSlot: "TODO: Wait for Content Spec",
      },
    });
    const security = await manager("security_admin");
    expect(
      await repo.applicationDetail(security.sessionHash, f.applicationId),
    ).not.toBeNull();
    await expect(repo.listQueue(support.sessionHash, 51)).rejects.toThrow(
      "verification_invalid_request",
    );
  });
  it.each(["expired", "stale_mfa", "revoked", "infinite_expiry"] as const)(
    "rejects %s sessions without queue or contact disclosure",
    async (state) => {
      const wrong = await manager("support", state);
      const f = await application();
      await expect(repo.listQueue(wrong.sessionHash)).rejects.toThrow(
        "verification_forbidden",
      );
      await expect(
        repo.applicationDetail(wrong.sessionHash, f.applicationId),
      ).rejects.toThrow("verification_forbidden");
      await expect(
        repo.decide({
          sessionHash: wrong.sessionHash,
          applicationId: f.applicationId,
          decision: "approved",
          reasonCode: "identity_verified",
          idempotencyKey: randomUUID(),
        }),
      ).rejects.toThrow("verification_forbidden");
      if (state === "infinite_expiry") {
        await expect(
          database.db.$client.query(
            "insert into expert_verification_decisions(application_id,application_audit_id,user_id,manager_id,manager_session_hash,decision,reason_code,idempotency_key) values($1::uuid,$1::uuid,$2::uuid,$3::uuid,$4,'approved','identity_verified',$5)",
            [
              f.applicationId,
              f.scope.userId,
              wrong.userId,
              wrong.sessionHash,
              randomUUID(),
            ],
          ),
        ).rejects.toMatchObject({ code: "23514" });
      }
    },
  );
  it("rejects NULL MFA at the original session authority and never authorizes a missing invalid session", async () => {
    const userId = await database.createUser();
    const sessionHash = `sha256:${sha(randomUUID())}`;
    await database.db.execute(
      sql`insert into admin_role_assignments(admin_id,role) values(${userId}::uuid,'support')`,
    );
    await expect(
      database.db.$client.query(
        "insert into admin_sessions(session_id_hash,admin_id,mfa_verified_at,expires_at) values($1,$2::uuid,null,clock_timestamp()+interval '1 hour')",
        [sessionHash, userId],
      ),
    ).rejects.toMatchObject({ code: "23502" });
    await expect(repo.listQueue(sessionHash)).rejects.toThrow(
      "verification_forbidden",
    );
  });
  it("rejects wrong roles and rechecks role revocation on an existing session", async () => {
    const wrong = await manager("catalog_admin");
    await expect(repo.listQueue(wrong.sessionHash)).rejects.toThrow(
      "verification_forbidden",
    );
    const revoked = await manager();
    await database.db.execute(
      sql`delete from admin_role_assignments where admin_id=${revoked.userId}::uuid`,
    );
    await expect(repo.listQueue(revoked.sessionHash)).rejects.toThrow(
      "verification_forbidden",
    );
  });
  it("concurrent duplicate approval creates one immutable audited invoice and purpose-bound operation", async () => {
    const f = await application();
    const input = {
      sessionHash: support.sessionHash,
      applicationId: f.applicationId,
      decision: "approved" as const,
      reasonCode: "identity_verified",
      idempotencyKey: randomUUID(),
    };
    const [first, repeat] = await Promise.all([
      repo.decide(input),
      repo.decide(input),
    ]);
    expect(first.invoiceId).toBe(repeat.invoiceId);
    expect([first.replay, repeat.replay].sort()).toEqual([false, true]);
    const invoice = await repo.invoiceForOwner(f.scope, first.invoiceId!);
    expect(invoice).toMatchObject({
      purpose: "onboarding",
      amountMinor: "300000",
      currency: "RUB",
      mode: "test",
      status: "pending",
    });
    expect(uuidLike(invoice!.operationId)).toBe(true);
    expect(
      await repo.invoiceForManager(support.sessionHash, invoice!.id),
    ).toMatchObject({
      operationId: invoice!.operationId,
      operationStatus: "created",
      providerObjectId: null,
    });
    const wrongManager = await manager("catalog_admin");
    await expect(
      repo.invoiceForManager(wrongManager.sessionHash, invoice!.id),
    ).rejects.toThrow("verification_forbidden");
    expect(
      (
        await database.db.execute(
          sql`select count(*)::int n from expert_verification_decisions where application_audit_id=${f.applicationId}::uuid`,
        )
      ).rows[0]?.n,
    ).toBe(1);
    expect(
      (
        await database.db.execute(
          sql`select count(*)::int n from audit_events where action='expert_verification.approved' and object_id=${f.applicationId}::uuid`,
        )
      ).rows[0]?.n,
    ).toBe(1);
    await expect(
      repo.decide({
        ...input,
        decision: "rejected",
        reasonCode: "identity_unverified",
      }),
    ).rejects.toThrow("verification_idempotency_conflict");
    const other = await application();
    await expect(
      repo.decide({ ...input, applicationId: other.applicationId }),
    ).rejects.toThrow("verification_idempotency_conflict");
    await expect(
      promo.createApplication({
        ...request(f.scope),
        quoteId: (
          await promo.createQuote({
            ...request(f.scope),
            tariffVersionId: tariffId,
            termMonths: 3,
          })
        ).id,
      }),
    ).rejects.toThrow("promo_application_locked");
    await expect(
      database.db.execute(
        sql`update expert_onboarding_applications set campaign_quote_id=null where id=${f.applicationId}::uuid`,
      ),
    ).rejects.toThrow();
    await noResidencyAuthority();
  });
  it("rejects with a bounded reason work item and no invoice or invented content", async () => {
    const f = await application();
    const input = {
      sessionHash: support.sessionHash,
      applicationId: f.applicationId,
      decision: "rejected" as const,
      reasonCode: "qualification_unverified",
      idempotencyKey: randomUUID(),
    };
    expect(await repo.decide(input)).toMatchObject({
      decision: "rejected",
      invoiceId: null,
      replay: false,
    });
    expect(await repo.decide(input)).toMatchObject({
      decision: "rejected",
      invoiceId: null,
      replay: true,
    });
    expect(
      (
        await database.db.execute(
          sql`select kind,reason_code,content_slot from expert_verification_work where application_id=${f.applicationId}::uuid`,
        )
      ).rows,
    ).toEqual([
      {
        kind: "verification_rejected",
        reason_code: "qualification_unverified",
        content_slot: "TODO: Wait for Content Spec",
      },
    ]);
    await expect(
      repo.decide({ ...input, reasonCode: "raw contact @someone" }),
    ).rejects.toThrow("verification_invalid_request");
  });
  it("binds owner, purpose, amount, mode and a preallocated operation before provider verification", async () => {
    const f = await approved();
    const other = await application();
    expect(await repo.invoiceForOwner(other.scope, f.invoice.id)).toBeNull();
    const input = {
      id: f.invoice.operationId,
      providerObjectId: `synthetic_${randomUUID()}`,
      userId: f.scope.userId,
      purpose: "onboarding" as const,
      amountMinor: "300000" as const,
      currency: "RUB" as const,
      mode: "test" as const,
    };
    for (const patch of [
      { id: randomUUID() },
      { userId: other.scope.userId },
      { purpose: "residency" },
      { amountMinor: "300001" },
      { mode: "live" },
    ])
      await expect(
        repo.bindPayment(f.invoice.id, { ...input, ...patch } as never),
      ).rejects.toThrow("verification_payment_binding_mismatch");
    await repo.bindPayment(f.invoice.id, input);
    expect(
      await repo.findOnboardingInvoiceByProviderObjectId(
        input.providerObjectId,
      ),
    ).toBe(f.invoice.id);
    await expect(
      repo.bindPayment(f.invoice.id, {
        ...input,
        providerObjectId: `synthetic_${randomUUID()}`,
      }),
    ).rejects.toThrow("verification_payment_binding_mismatch");
    await expect(
      database.db.execute(
        sql`update expert_onboarding_invoices set purpose='residency' where id=${f.invoice.id}::uuid`,
      ),
    ).rejects.toThrow();
    await expect(
      database.db.execute(
        sql`update expert_onboarding_payment_operations set amount_minor=1 where id=${f.invoice.operationId}::uuid`,
      ),
    ).rejects.toThrow();
  });
  it("actual fixed-origin GET proof admits interview once under concurrent settlement and rejects copied proof", async () => {
    const f = await bound();
    const beforeInvoice = verifier(
      f.binding,
      payment(f.binding, {
        created_at: new Date(Date.now() - 7200000).toISOString(),
        captured_at: new Date(Date.now() - 3600000).toISOString(),
      }),
    );
    const oldProof = await beforeInvoice.verifier.verify(f.invoice.id);
    if (!oldProof) throw new Error("fixture_proof_missing");
    await expect(repo.settleVerified(oldProof)).rejects.toThrow(
      "verification_payment_binding_mismatch",
    );
    const get = verifier(f.binding);
    const proof = await get.verifier.verify(f.invoice.id);
    expect(get.calls).toEqual([
      {
        url: `https://api.yookassa.ru/v3/payments/${f.binding.providerObjectId}`,
        method: "GET",
      },
    ]);
    if (!proof) throw new Error("fixture_proof_missing");
    await expect(
      repo.settleVerified({ ...proof } as VerifiedOnboardingPayment),
    ).rejects.toThrow("onboarding_payment_proof_required");
    const [first, duplicate] = await Promise.all([
      repo.settleVerified(proof),
      repo.settleVerified(proof),
    ]);
    expect([first.replay, duplicate.replay].sort()).toEqual([false, true]);
    expect(first.stage).toBe("interview");
    expect(
      (
        await database.db.execute(
          sql`select verification_status,onboarding_stage from expert_onboarding_applications where id=${f.applicationId}::uuid`,
        )
      ).rows[0],
    ).toEqual({
      verification_status: "approved",
      onboarding_stage: "interview",
    });
    expect(
      (
        await database.db.execute(
          sql`select count(*)::int n from expert_onboarding_payment_facts where invoice_id=${f.invoice.id}::uuid`,
        )
      ).rows[0]?.n,
    ).toBe(1);
    await privacy().startErasureAtomically({
      targetUserId: f.scope.userId,
      correlationId: `verification-after-admit:${f.scope.userId}`,
      idempotencyKey: `verification-after-admit:${f.scope.userId}`,
      pseudonym: "hmac:synthetic-after-admit-erasure",
    });
    expect(await repo.settleVerified(proof)).toMatchObject({
      settled: true,
      replay: true,
      stage: null,
    });
    expect(
      (
        await database.db.execute(
          sql`select admission,reason_code from expert_onboarding_payment_facts where invoice_id=${f.invoice.id}::uuid`,
        )
      ).rows,
    ).toEqual([{ admission: "interview", reason_code: "payment_verified" }]);
    expect(
      (
        await database.db.execute(
          sql`select count(*)::int n from expert_onboarding_applications where id=${f.applicationId}::uuid`,
        )
      ).rows[0]?.n,
    ).toBe(0);
    await noResidencyAuthority();
  });
  it("rechecks stored binding even for a real private proof minted from a misconfigured binding port", async () => {
    const f = await bound();
    const wrong = { ...f.binding, userId: await database.createUser() };
    const proof = await verifier(wrong, payment(wrong), {
      findOnboardingPaymentBinding: async () => wrong,
    }).verifier.verify(f.invoice.id);
    if (!proof) throw new Error("fixture_proof_missing");
    await expect(repo.settleVerified(proof)).rejects.toThrow(
      "verification_payment_binding_mismatch",
    );
    expect(
      (
        await database.db.execute(
          sql`select count(*)::int n from expert_onboarding_payment_facts where invoice_id=${f.invoice.id}::uuid`,
        )
      ).rows[0]?.n,
    ).toBe(0);
  });
  it("configured merchant callback with durable inbox routes GET settlement and acknowledges duplicate once", async () => {
    const f = await bound();
    const route = await webhook(f.binding);
    try {
      expect((await route.notify()).statusCode).toBe(200);
      expect((await route.notify()).statusCode).toBe(200);
      expect(route.calls).toHaveLength(1);
      expect(route.legacy).not.toHaveBeenCalled();
      expect(
        (
          await database.db.execute(
            sql`select onboarding_stage from expert_onboarding_applications where id=${f.applicationId}::uuid`,
          )
        ).rows[0]?.onboarding_stage,
      ).toBe("interview");
      expect(
        (
          await database.db.execute(
            sql`select count(*)::int n from expert_onboarding_payment_facts where invoice_id=${f.invoice.id}::uuid`,
          )
        ).rows[0]?.n,
      ).toBe(1);
    } finally {
      await route.app.close();
    }
    await noResidencyAuthority();
  });
  it.each([
    "pending",
    "waiting_for_capture",
    "canceled",
    "wrong_amount",
    "wrong_owner",
  ] as const)(
    "callback %s stays retryable and cannot grant interview",
    async (kind) => {
      const f = await bound();
      const patch =
        kind === "wrong_amount"
          ? { amount: { value: "2999.00", currency: "RUB" } }
          : kind === "wrong_owner"
            ? {
                metadata: {
                  order_id: f.invoice.id,
                  user_id: randomUUID(),
                  purpose: "onboarding",
                  operation_id: f.invoice.operationId,
                },
              }
            : { status: kind, paid: false, captured_at: undefined };
      const route = await webhook(f.binding, payment(f.binding, patch));
      try {
        expect((await route.notify()).statusCode).toBe(503);
        expect(route.legacy).not.toHaveBeenCalled();
        expect(
          (
            await database.db.execute(
              sql`select onboarding_stage from expert_onboarding_applications where id=${f.applicationId}::uuid`,
            )
          ).rows[0]?.onboarding_stage,
        ).toBeNull();
        expect(
          (
            await database.db.execute(
              sql`select count(*)::int n from expert_onboarding_payment_facts where invoice_id=${f.invoice.id}::uuid`,
            )
          ).rows[0]?.n,
        ).toBe(0);
      } finally {
        await route.app.close();
      }
    },
  );
  it("unknown payment remains retryable through the existing legacy path", async () => {
    const f = await bound();
    const route = await webhook({
      ...f.binding,
      providerObjectId: "synthetic_unbound_payment",
    });
    try {
      expect((await route.notify()).statusCode).toBe(503);
      expect(route.legacy).toHaveBeenCalledOnce();
      expect(route.calls).toHaveLength(0);
    } finally {
      await route.app.close();
    }
  });
  it("withdrawal cancels unsent work and records later actual payment without admission", async () => {
    const f = await bound();
    await privacy().withdrawConsentAtomically({
      targetUserId: f.scope.userId,
      purpose: "client_messaging",
      policyVersion: "client-messaging-v1",
      correlationId: `verification-withdraw:${f.scope.userId}`,
    });
    expect(await repo.invoiceForOwner(f.scope, f.invoice.id)).toBeNull();
    expect(
      await repo.invoiceForManager(support.sessionHash, f.invoice.id),
    ).toBeNull();
    const route = await webhook(f.binding);
    try {
      expect((await route.notify()).statusCode).toBe(200);
    } finally {
      await route.app.close();
    }
    expect(
      (
        await database.db.execute(
          sql`select admission,reason_code from expert_onboarding_payment_facts where invoice_id=${f.invoice.id}::uuid`,
        )
      ).rows[0],
    ).toEqual({ admission: "blocked", reason_code: "consent_unavailable" });
    expect(
      (
        await database.db.execute(
          sql`select onboarding_stage from expert_onboarding_applications where id=${f.applicationId}::uuid`,
        )
      ).rows[0]?.onboarding_stage,
    ).toBeNull();
    expect(
      (
        await database.db.execute(
          sql`select status from expert_onboarding_invoices where id=${f.invoice.id}::uuid`,
        )
      ).rows[0]?.status,
    ).toBe("settled");
  });
  it("physical application erasure preserves invoice audit facts and later configured GET callback cannot resurrect it", async () => {
    const f = await bound();
    await privacy().startErasureAtomically({
      targetUserId: f.scope.userId,
      correlationId: `verification-erase:${f.scope.userId}`,
      idempotencyKey: `verification-erase:${f.scope.userId}`,
      pseudonym: "hmac:synthetic-verification-erasure",
    });
    expect(
      (
        await database.db.execute(
          sql`select application_id,application_audit_id from expert_onboarding_invoices where id=${f.invoice.id}::uuid`,
        )
      ).rows[0],
    ).toEqual({ application_id: null, application_audit_id: f.applicationId });
    expect(
      (
        await database.db.execute(
          sql`select application_id,application_audit_id from expert_verification_decisions where application_audit_id=${f.applicationId}::uuid`,
        )
      ).rows[0],
    ).toEqual({ application_id: null, application_audit_id: f.applicationId });
    const route = await webhook(f.binding);
    try {
      expect((await route.notify()).statusCode).toBe(200);
      expect((await route.notify()).statusCode).toBe(200);
    } finally {
      await route.app.close();
    }
    expect(
      (
        await database.db.execute(
          sql`select admission,reason_code from expert_onboarding_payment_facts where invoice_id=${f.invoice.id}::uuid`,
        )
      ).rows[0],
    ).toEqual({ admission: "blocked", reason_code: "application_erased" });
    expect(
      (
        await database.db.execute(
          sql`select count(*)::int n from expert_onboarding_applications where id=${f.applicationId}::uuid`,
        )
      ).rows[0]?.n,
    ).toBe(0);
    expect(
      await repo.applicationDetail(support.sessionHash, f.applicationId),
    ).toBeNull();
    await noResidencyAuthority();
  });
  it("retains a late provider receipt after erasure without reviving send permission or admission", async () => {
    const f = await approved();
    await privacy().startErasureAtomically({
      targetUserId: f.scope.userId,
      correlationId: `verification-late-bind:${f.scope.userId}`,
      idempotencyKey: `verification-late-bind:${f.scope.userId}`,
      pseudonym: "hmac:synthetic-late-bind-erasure",
    });
    await repo.bindPayment(f.invoice.id, {
      id: f.invoice.operationId,
      providerObjectId: `synthetic_${randomUUID()}`,
      userId: f.scope.userId,
      purpose: "onboarding",
      amountMinor: "300000",
      currency: "RUB",
      mode: "test",
    });
    const binding = await repo.findOnboardingPaymentBinding(f.invoice.id);
    if (!binding) throw new Error("fixture_binding_missing");
    expect(
      await repo.invoiceForManager(support.sessionHash, f.invoice.id),
    ).toBeNull();
    const route = await webhook(binding);
    try {
      expect((await route.notify()).statusCode).toBe(200);
    } finally {
      await route.app.close();
    }
    expect(
      (
        await database.db.execute(
          sql`select admission,reason_code from expert_onboarding_payment_facts where invoice_id=${f.invoice.id}::uuid`,
        )
      ).rows[0],
    ).toEqual({ admission: "blocked", reason_code: "application_erased" });
    await noResidencyAuthority();
  });
  it("detail rechecks erasure after waiting on the subject barrier", async () => {
    const f = await application();
    const blocker = await database.db.$client.connect();
    try {
      await blocker.query("begin");
      await blocker.query(
        "select pg_advisory_xact_lock(hashtextextended($1::uuid::text,0))",
        [f.scope.userId],
      );
      const detail = repo
        .applicationDetail(support.sessionHash, f.applicationId)
        .then(
          (value) => ({ kind: "resolved" as const, value }),
          (error) => ({ kind: "rejected" as const, error }),
        );
      for (let i = 0; i < 100; i++) {
        const waiting = await database.db.$client.query(
          "select count(*)::int n from pg_stat_activity where datname=current_database() and wait_event_type='Lock' and query like 'select pg_advisory_xact_lock%' ",
        );
        if (waiting.rows[0]?.n > 0) break;
        await new Promise((resolve) => setTimeout(resolve, 2));
      }
      await blocker.query("update users set active=false where id=$1", [
        f.scope.userId,
      ]);
      await blocker.query(
        "delete from expert_onboarding_applications where id=$1",
        [f.applicationId],
      );
      await blocker.query("commit");
      expect(await detail).toEqual({ kind: "resolved", value: null });
    } finally {
      await blocker.query("rollback");
      blocker.release();
    }
  });
});
function uuidLike(value: string) {
  return /^[0-9a-f-]{36}$/u.test(value);
}
