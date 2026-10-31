import { randomUUID, createHash } from "node:crypto";
import { beforeAll, afterAll, it, expect } from "vitest";
import {
  startExpertReferralTestDatabase,
  type ExpertReferralTestDatabase,
} from "../../../packages/db/src/testkit/expert-referral.js";
import { seedClientConsent } from "../../../packages/db/src/testkit/client-consent.js";
import { ownerPricingApproval } from "../../../packages/db/src/testkit/owner-pricing-approval.js";
import { saveExpertOfferProfile } from "../../../packages/db/src/repositories/expert-offer-v2.js";
import { PostgresExpertSeparatedSalesRepository } from "../../../packages/db/src/repositories/expert-separated-sales-repository.js";
import { PostgresEarlyBirdChoiceRepository } from "../../../packages/db/src/repositories/early-bird-choice-repository.js";
import { PostgresResidentVerificationRepository } from "../../../packages/db/src/repositories/resident-verification-repository.js";
import { PostgresResidentReviewRepository } from "../../../packages/db/src/repositories/resident-review-repository.js";
import { PostgresDeferredScopeSource } from "../../../packages/db/src/repositories/early-bird-deferred-scope-source.js";
import { PostgresDeferredReceiptContact } from "../../../packages/db/src/repositories/early-bird-deferred-receipt-contact.js";
import { PostgresDeferredOnboardingStatus } from "../../../packages/db/src/repositories/early-bird-deferred-onboarding-status.js";
import { createPayerReceiptVault } from "@ii-tonya/integrations";
import { createEarlyBirdOwnerCheckoutComposition } from "./expert-early-bird-checkout-composition.js";
import { createEarlyBirdStandardCheckoutComposition } from "./expert-early-bird-standard-checkout-composition.js";
import { createPostgresEarlyBirdAuthority } from "./expert-early-bird-authority.js";
import {
  createExpertEarlyBirdService,
  type WaveInvoice,
} from "./expert-early-bird-service.js";
import { EarlyBirdDeferredAuthority } from "./expert-early-bird-deferred-authority.js";
import { EarlyBirdDeferredStatus } from "./expert-early-bird-deferred-status.js";
let db: ExpertReferralTestDatabase,
  tariff: string,
  sequence = 880000;
const start = Date.parse("2027-01-11T00:00:00+03:00"),
  enrollment = Date.parse("2026-11-01T00:00:00+03:00");
const SYNTHETIC_FIXTURE_VALUE_1 = "synthetic-continuation-only";
const policy = {
  botId: "1",
  botKey: "continuation",
  webhookSecret: SYNTHETIC_FIXTURE_VALUE_1,
  messagingConsentPolicyVersion: "client-messaging-v1",
};
const q = (text: string, args: unknown[] = []) =>
  db.db.$client.query(text, args);
const hash = (s: string) => createHash("sha256").update(s).digest("hex");
const vault = createPayerReceiptVault({
  activeKeyId: "fixture",
  keys: new Map([["fixture", Buffer.alloc(32, 8)]]),
});
beforeAll(async () => {
  db = await startExpertReferralTestDatabase(undefined, {
    forceDisposableCluster: true,
  });
  expect((await q("show server_version_num")).rows[0]!.server_version_num).toBe(
    "170005",
  );
  await q("update early_bird_launch_configs set active=false where active");
  await q(
    "insert into early_bird_launch_configs(phase,enrollment_start_at,client_start_at,promo_deadline_days,final_call_trigger_at) values('WAVE_1_EARLY_BIRD','2026-11-01T00:00:00+03','2027-01-11T00:00:00+03',10,'2026-12-28T10:00:00+03')",
  );
  await q(
    "create or replace function early_bird_current_time() returns timestamptz language sql volatile as $$select '2026-11-02T00:00:00Z'::timestamptz$$",
  );
  tariff = await db.createResidencyTariff({
    tariffKey: "PRO",
    displayName: "PRO",
    priceMinor: 999000,
    durationSeconds: 2592000,
  });
}, 120000);
afterAll(async () => db?.stop(), 120000);
async function fixture(choice: "now" | "later", owner = false) {
  const user = await db.createUser(),
    chat = String(++sequence),
    scope = { ...policy, telegramUserId: chat, chatId: chat };
  const event = () => {
    const requestKey = randomUUID();
    return { ...scope, requestKey, requestDigest: hash(requestKey) };
  };
  await q(
    "insert into channel_identities(user_id,provider,external_id,external_chat_id,bot_key,status) values($1,'telegram',$2,$2,$3,'active')",
    [user, chat, policy.botKey],
  );
  await seedClientConsent(db.db, user, "client_messaging");
  await saveExpertOfferProfile(db.db, {
    userId: user,
    cityCode: "kazan",
    millionCity: false,
    serviceFormat: "offline",
    ticketMinor: "300000",
    participantKind: "expert",
    idempotencyKey: randomUUID(),
  });
  let grant: string | null = null;
  if (owner) {
    const previous = (
      await q(
        "select id,granted_by,grant_session_hash from owner_test_pricing_grants where revoked_at is null",
      )
    ).rows;
    for (const old of previous) {
      const revoked = await ownerPricingApproval(db, {
        action: "revoke",
        target: old.id,
        adminId: old.granted_by,
        sessionIdHash: old.grant_session_hash,
      });
      await q(
        "update owner_test_pricing_grants set revoked_at=clock_timestamp(),revoked_by=$2,revoke_session_hash=$3,revoke_approval_id=$4 where id=$1",
        [old.id, old.granted_by, old.grant_session_hash, revoked],
      );
    }
    const admin = await db.createAdminAudit({
      action: "fixture",
      objectId: randomUUID(),
    });
    const approval = await ownerPricingApproval(db, {
      action: "grant",
      target: user,
      adminId: admin.adminId,
      sessionIdHash: admin.sessionIdHash,
    });
    grant = randomUUID();
    await q(
      "insert into owner_test_pricing_grants(id,user_id,granted_by,grant_session_hash,grant_approval_id) values($1,$2,$3,$4,$5)",
      [grant, user, admin.adminId, admin.sessionIdHash, approval],
    );
  }
  const sales = new PostgresExpertSeparatedSalesRepository(db.db, policy);
  const base = (await sales.transition({
    ...event(),
    tariffVersionId: tariff,
    waveStartAtMs: start,
    waveEnrollmentStartMs: enrollment,
  }))!;
  const positive = (await sales.transition({
    ...event(),
    baseId: base.id,
    revision: base.revision,
    action: "positive",
    waveStartAtMs: start,
    waveEnrollmentStartMs: enrollment,
    waveExpectedGrantId: grant,
  }))!;
  const selected = (await new PostgresEarlyBirdChoiceRepository(
    db.db,
    policy,
  ).record({
    ...scope,
    updateId: ++sequence,
    offerId: base.id,
    revision: positive.revision,
    choice,
  }))!;
  const forms = new PostgresResidentVerificationRepository(db.db, {
    ...policy,
    earlyBirdForm: true,
  });
  let form = await forms.mutate({ ...event(), action: "start" });
  form = await forms.mutate({
    ...event(),
    action: "patch",
    expectedRevision: form.revision,
    patch: {
      roles: ["EXPERT"],
      primaryRole: "EXPERT",
      category: "BASIC",
      tax: "SELF_EMPLOYED",
      city: "Казань",
      socialLinks: ["https://example.invalid/continuation"],
      motivation: "Работа с клиентами",
      specialization: "Психология",
      averageCheckMinor: "300000",
      methods: "Практика",
      experienceYears: 5,
      cases: "Пример",
    },
  });
  await forms.mutate({
    ...event(),
    action: "submit",
    expectedRevision: form.revision,
  });
  const manager = await db.createUser(),
    session = `continuation-${randomUUID()}`;
  await q(
    "insert into admin_sessions(session_id_hash,admin_id,mfa_verified_at,expires_at) values($1,$2,clock_timestamp(),clock_timestamp()+interval '1 hour')",
    [session, manager],
  );
  await q(
    "insert into admin_role_assignments(admin_id,role) values($1,'support')",
    [manager],
  );
  async function approve() {
    const row = (
      await q(
        "select b.application_id,f.revision,f.check_generation from early_bird_form_bridges b join residents_applications f on f.id=b.form_id where b.user_id=$1",
        [user],
      )
    ).rows[0]!;
    const review = new PostgresResidentReviewRepository(db.db, {
      providerMode: "test",
      messagingConsentPolicyVersion: policy.messagingConsentPolicyVersion,
      earlyBirdReview: true,
    });
    const preview = await review.preview(session, {
      applicationId: row.application_id,
      key: "APPROVED_BASIC",
      expectedRevision: row.revision,
      expectedGeneration: row.check_generation,
    });
    await review.confirm(
      session,
      row.application_id,
      preview.previewId,
      preview.hash,
    );
  }
  const config = {
    policy,
    identityKey: Buffer.alloc(32, 3),
    requestKey: Buffer.alloc(32, 4),
    requestKeyReference: "fixture:key",
    receiptVault: vault,
    returnUrl: "https://example.invalid/return",
    onboardingFiscal: {
      vatCode: 1,
      paymentSubject: "service",
      paymentMode: "full_payment",
    },
    subscriptionFiscal: {
      vatCode: 1,
      paymentSubject: "service",
      paymentMode: "full_payment",
    },
  };
  const checkout = owner
    ? createEarlyBirdOwnerCheckoutComposition(db.db, config)!
    : createEarlyBirdStandardCheckoutComposition(db.db, config)!;
  let prepares = 0;
  const prepare = {
    async prepare(input: Parameters<typeof checkout.prepare.prepare>[0]) {
      prepares++;
      const result = await checkout.prepare.prepare(input);
      if (result.kind === "unavailable") return result;
      const identity = await checkout.source.resolve(input);
      if (!identity) return { kind: "unavailable" as const };
      const intent = (
        await q(
          "select total_minor::text,onboarding_minor::text,subscription_minor::text from early_bird_composite_intents where id=$1",
          [identity.operationId],
        )
      ).rows[0]!;
      return {
        kind: "invoice" as const,
        purpose: "combined" as const,
        url: `https://yoomoney.ru/${identity.invoiceId}`,
        totalMinor: intent.total_minor,
        onboardingMinor: intent.onboarding_minor,
        subscriptionMinor: intent.subscription_minor,
        clientStart: new Date(start).toISOString(),
      } satisfies WaveInvoice;
    },
  };
  const deferredSource = new PostgresDeferredScopeSource(db.db, policy),
    contacts = new PostgresDeferredReceiptContact(db.db, deferredSource, vault);
  // Production uses isolated SQL principals. This test calls the SAME guarded
  // canonical SQL capabilities; the only external-provider boundary is a URL seam.
  const deferred = new EarlyBirdDeferredAuthority({
    scope: deferredSource,
    contacts,
    payments: {
      async prepare(i: {
        accountId: string;
        userId: string;
        baseId: string;
        choiceId: string;
        configId: string;
      }) {
        await q("select public.early_bird_deferred_prepare($1,$2,$3,$4,$5)", [
          i.accountId,
          i.userId,
          i.baseId,
          i.choiceId,
          i.configId,
        ]);
      },
      async invoice(i: {
        accountId: string;
        userId: string;
        invoiceId: string;
        idempotencyKey: string;
        stage: string;
      }) {
        return BigInt(
          (
            await q(
              "select public.early_bird_deferred_invoice($1,$2,$3,$4,$5)::text amount",
              [i.accountId, i.userId, i.invoiceId, i.idempotencyKey, i.stage],
            )
          ).rows[0]!.amount,
        );
      },
    } as never,
    checkout: {
      checkout: async (_s: unknown, id: string) => ({
        kind: "ready",
        confirmationUrl: `https://yoomoney.ru/${id}`,
      }),
    } as never,
    status: new EarlyBirdDeferredStatus(
      deferredSource,
      new PostgresDeferredOnboardingStatus(db.db),
    ),
    engagement: { recordEngagementForUser: async () => {} },
    identityKey: Buffer.alloc(32, 6),
    clientStartMs: start,
  });
  const authority = createPostgresEarlyBirdAuthority(
    db.db,
    policy,
    start,
    enrollment,
    prepare,
    checkout.receipt,
    deferred,
  );
  const service = createExpertEarlyBirdService(authority, {
    phase: "WAVE_1_EARLY_BIRD",
    enrollmentStartMs: enrollment,
    clientStartMs: start,
    now: () => Date.parse("2026-11-02T00:00:00Z"),
  });
  const input = () => ({ ...scope, updateId: ++sequence, text: "/my_tariff" });
  const click = () =>
    service.handle({ ...input(), text: "", callbackData: "eb:continue" });
  async function saveReceipt() {
    if (choice === "now") {
      const s = await checkout.source.resolveCurrent(scope);
      if (!s) throw Error("approved_scope_missing");
      await checkout.contacts.capture(
        s,
        "continued@example.invalid",
        randomUUID(),
      );
    } else {
      const s = await deferredSource.resolveCurrent(scope);
      if (!s) throw Error("deferred_account_missing");
      await contacts.capture(s, "continued@example.invalid", randomUUID());
    }
  }
  return {
    user,
    scope,
    base,
    selected,
    service,
    input,
    click,
    approve,
    saveReceipt,
    prepares: () => prepares,
  };
}

it.each([false, true])(
  "approved combined owner=%s status→Pay uses existing receipt, exact single combined invoice and frozen choice",
  async (owner) => {
    const f = await fixture("now", owner);
    expect((await f.service.handle(f.input()))?.status).toBe("handled");
    expect(JSON.stringify(await f.service.handle(f.input()))).not.toContain(
      "eb:continue",
    );
    await f.click();
    expect(f.prepares()).toBe(0);
    await f.approve();
    await f.saveReceipt();
    expect(JSON.stringify(await f.service.handle(f.input()))).toContain(
      "eb:continue",
    );
    expect(f.prepares()).toBe(0);
    expect(
      (
        await q(
          "select count(*)::int n from early_bird_composite_intents where user_id=$1",
          [f.user],
        )
      ).rows[0]!.n,
    ).toBe(0);
    const reply = await f.click();
    expect(reply).toMatchObject({ status: "handled" });
    expect(JSON.stringify(reply)).toContain("Единый счёт");
    if (owner)
      expect(JSON.stringify(reply)).toContain("10 ₽ + тариф 20 ₽ = 30 ₽");
    const first = (
      await q(
        "select id,invoice_id,total_minor::text,onboarding_minor::text,subscription_minor::text,choice_id from early_bird_composite_intents where user_id=$1",
        [f.user],
      )
    ).rows;
    expect(first).toHaveLength(1);
    expect(first[0]!.choice_id).toBe(f.selected.id);
    expect(BigInt(first[0]!.total_minor)).toBe(
      BigInt(first[0]!.onboarding_minor) + BigInt(first[0]!.subscription_minor),
    );
    expect(JSON.stringify(await f.click())).toContain(first[0]!.invoice_id);
    expect(
      (
        await q(
          "select id,invoice_id,total_minor::text,onboarding_minor::text,subscription_minor::text,choice_id from early_bird_composite_intents where user_id=$1",
          [f.user],
        )
      ).rows,
    ).toEqual(first);
    expect(
      (
        await q(
          "select count(*)::int n from early_bird_choices where user_id=$1",
          [f.user],
        )
      ).rows[0]!.n,
    ).toBe(1);
  },
  60000,
);

it("later continuation creates only the same-choice onboarding invoice, with missing-receipt guidance and no combined charge", async () => {
  const f = await fixture("later", true);
  await f.approve();
  expect(JSON.stringify(await f.click())).toContain("/receipt");
  await f.saveReceipt();
  const reply = await f.click();
  expect(JSON.stringify(reply)).toContain("Счёт за онбординг: 10 ₽");
  const rows = (
    await q(
      "select i.id,i.stage,i.amount_minor::text from early_bird_deferred_invoices i where i.user_id=$1",
      [f.user],
    )
  ).rows;
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({ stage: "onboarding", amount_minor: "1000" });
  expect(JSON.stringify(await f.click())).toContain(rows[0]!.id);
  expect(
    (
      await q(
        "select count(*)::int n from early_bird_composite_intents where user_id=$1",
        [f.user],
      )
    ).rows[0]!.n,
  ).toBe(0);
  expect(
    (
      await q(
        "select count(*)::int n from early_bird_choices where user_id=$1",
        [f.user],
      )
    ).rows[0]!.n,
  ).toBe(1);
}, 60000);

it("unapproved, foreign, revoked and stale choices cannot prepare a combined invoice", async () => {
  const f = await fixture("now", true);
  await f.click();
  expect(f.prepares()).toBe(0);
  await f.approve();
  await f.service.handle({
    ...f.input(),
    telegramUserId: "999999999",
    chatId: "999999999",
    text: "",
    callbackData: "eb:continue",
  });
  expect(f.prepares()).toBe(0);
  const repo = new PostgresEarlyBirdChoiceRepository(db.db, policy);
  await repo.record({
    ...f.scope,
    updateId: ++sequence,
    offerId: f.base.id,
    revision: f.selected
      ? (
          await q("select revision from early_bird_choices where id=$1", [
            f.selected.id,
          ])
        ).rows[0]!.revision
      : 2,
    choice: "later",
  });
  await f.click();
  expect(f.prepares()).toBe(0);
  await q(
    "insert into consents(user_id,consent_type,decision,policy_version,channel,basis,scope_fields) values($1,'client_messaging','revoked','client-messaging-v1','telegram','consent','{}')",
    [f.user],
  );
  await f.click();
  expect(f.prepares()).toBe(0);
  expect(
    (
      await q(
        "select count(*)::int n from early_bird_composite_intents where user_id=$1",
        [f.user],
      )
    ).rows[0]!.n,
  ).toBe(0);
}, 60000);
