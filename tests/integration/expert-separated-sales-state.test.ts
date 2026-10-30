import { createRequire } from "node:module";
import { createHash, randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import {
  createPayerReceiptVault,
  createYooKassaClient,
  YooKassaOnboardingPaymentVerifier,
} from "@ii-tonya/integrations";
import {
  startExpertReferralTestDatabase,
  type ExpertReferralTestDatabase,
} from "../../packages/db/src/testkit/expert-referral.js";
import { seedClientConsent } from "../../packages/db/src/testkit/client-consent.js";
import { saveExpertOfferProfile } from "../../packages/db/src/repositories/expert-offer-v2.js";
import { PostgresExpertSeparatedSalesRepository } from "../../packages/db/src/repositories/expert-separated-sales-repository.js";
import { PostgresResidentVerificationRepository } from "../../packages/db/src/repositories/resident-verification-repository.js";
import { PostgresExpertVerificationRepository } from "../../packages/db/src/repositories/expert-verification-repository.js";
import { PostgresHeldOnboardingCheckout } from "../../packages/db/src/repositories/expert-held-onboarding-repository.js";
import { PostgresPayerReceiptContactRepository } from "../../packages/db/src/repositories/payer-receipt-contact-repository.js";
import { PostgresExpertSalesScheduler } from "../../packages/db/src/repositories/expert-sales-scheduler.js";
import { startHeldOnboardingLocal } from "../support/held-onboarding-local.js";
const SYNTHETIC_FIXTURE_VALUE_1 = "synthetic_sales_secret_1234567890";
const SYNTHETIC_FIXTURE_VALUE_2 = "synthetic_recovery_manager_token_12345";

let db: ExpertReferralTestDatabase;
let tariff: string;
let session: string;
let next = 880000;
const hash = (v: string) => createHash("sha256").update(v).digest("hex");
const policy = {
  botId: "717171",
  botKey: "state-sales",
  messagingConsentPolicyVersion: "client-messaging-v1",
};
const command = <T extends object>(scope: T) => {
  const requestKey = randomUUID();
  return { ...scope, requestKey, requestDigest: hash(requestKey) };
};
beforeAll(async () => {
  db = await startExpertReferralTestDatabase();
  tariff = await db.createResidencyTariff({
    tariffKey: "PRO",
    displayName: "PRO",
    priceMinor: 999000,
    durationSeconds: 2592000,
  });
  const staff = await db.createUser();
  session = `sha256:${hash(randomUUID())}`;
  await db.db.execute(
    sql`insert into admin_sessions(session_id_hash,admin_id,mfa_verified_at,expires_at) values(${session},${staff}::uuid,clock_timestamp(),clock_timestamp()+interval '1 hour')`,
  );
  await db.db.execute(
    sql`insert into admin_role_assignments(admin_id,role) values(${staff}::uuid,'support')`,
  );
}, 120000);
afterAll(async () => {
  await db?.stop();
}, 120000);
async function owner(intake = false) {
  const userId = await db.createUser(),
    chatId = String(++next),
    scope = { ...policy, telegramUserId: chatId, chatId };
  await db.db.execute(
    sql`insert into channel_identities(user_id,provider,external_id,bot_key,external_chat_id,status) values(${userId}::uuid,'telegram',${chatId},${scope.botKey},${chatId},'active')`,
  );
  await seedClientConsent(db.db, userId, "client_messaging");
  await saveExpertOfferProfile(db.db, {
    userId,
    cityCode: "kazan",
    millionCity: false,
    serviceFormat: "offline",
    ticketMinor: "300000",
    participantKind: "expert",
    idempotencyKey: randomUUID(),
  });
  // Historical v1 cohort fixture: the final module must preserve these old rules.
  await db.db.execute(
    sql`insert into residents_applications(user_id,bot_id,bot_key,channel_identity_id,telegram_user_id,chat_id,form_version,policy_version,education_requirement) select ${userId}::uuid,${scope.botId},${scope.botKey},id,${chatId},${chatId},1,'resident_education_unknown_v1','unknown_manual_review' from channel_identities where user_id=${userId}::uuid`,
  );
  const sales = new PostgresExpertSeparatedSalesRepository(db.db, policy),
    form = new PostgresResidentVerificationRepository(db.db, policy);
  if (intake) await form.mutate({ ...command(scope), action: "start" });
  const base = await sales.transition({
    ...command(scope),
    tariffVersionId: tariff,
  });
  expect(base?.state).toBe("base");
  return { userId, scope, sales, form, base: base! };
}
async function selection(
  f: Awaited<ReturnType<typeof owner>>,
  term: "month" | "quarter" = "month",
) {
  let s = await f.sales.transition({
    ...command(f.scope),
    baseId: f.base.id,
    revision: 0,
    action: "positive",
  });
  s = await f.sales.transition({
    ...command(f.scope),
    baseId: f.base.id,
    revision: s!.revision,
    action: "promo",
  });
  return f.sales.transition({
    ...command(f.scope),
    baseId: f.base.id,
    revision: s!.revision,
    action: term,
  });
}
async function approved(
  term: "month" | "quarter" = "month",
  hooks: {
    beforeSubmit?: (f: Awaited<ReturnType<typeof owner>>) => Promise<void>;
    beforeDecision?: (f: Awaited<ReturnType<typeof owner>>) => Promise<void>;
  } = {},
) {
  const f = await owner();
  await selection(f, term);
  let form = await f.form.mutate({ ...command(f.scope), action: "start" });
  form = await f.form.mutate({
    ...command(f.scope),
    action: "patch",
    expectedRevision: form.revision,
    patch: {
      roles: ["EXPERT"],
      primaryRole: "EXPERT",
      category: "BASIC",
      tax: "SELF_EMPLOYED",
      city: "Казань",
      socialLinks: ["https://example.com/expert"],
      motivation: "Практика",
      specialization: "Психология",
      averageCheckMinor: "300000",
    },
  });
  await hooks.beforeSubmit?.(f);
  await f.form.mutate({
    ...command(f.scope),
    action: "submit",
    expectedRevision: form.revision,
  });
  const bridge = (
    await db.db.execute<{ id: string; quoteId: string }>(
      sql`select application_id id,quote_id as "quoteId" from expert_sales_form_bridges where user_id=${f.userId}::uuid`,
    )
  ).rows[0]!;
  const repo = new PostgresExpertVerificationRepository(db.db, {
    providerMode: "test",
    messagingConsentPolicyVersion: policy.messagingConsentPolicyVersion,
  });
  await hooks.beforeDecision?.(f);
  const result = await repo.decide({
    sessionHash: session,
    applicationId: bridge.id,
    decision: "approved",
    reasonCode: "identity_verified",
    idempotencyKey: randomUUID(),
  });
  const invoice = (await repo.invoiceForManager(session, result.invoiceId!))!;
  const vault = createPayerReceiptVault({
    activeKeyId: "fixture",
    keys: new Map([["fixture", new Uint8Array(32).fill(11)]]),
  });
  await new PostgresPayerReceiptContactRepository(db.db, vault, 30).capture({
    userId: f.userId,
    quoteId: bridge.quoteId,
    email: "synthetic@example.com",
    idempotencyKey: randomUUID(),
  });
  const paymentId = `fixture_${randomUUID()}`,
    local = await startHeldOnboardingLocal(paymentId);
  const checkout = new PostgresHeldOnboardingCheckout(db.db, {
    enabled: true,
    client: local.client,
    vault,
    protector: local.protector,
    decryptor: local.decryptor,
    repository: repo,
    returnUrl: "https://example.com/return",
    vatCode: 1,
    mode: "test",
  });
  return { ...f, repo, invoice, local, checkout, paymentId, vault };
}
async function expire(invoice: string) {
  // Test-only clock fixture. Production immutability is tested separately.
  await db.db.transaction(async (tx) => {
    await tx.execute(
      sql`alter table expert_sales_fee_attempts disable trigger expert_sales_attempt_immutable`,
    );
    await tx.execute(
      sql`update expert_sales_fee_attempts set expires_at=created_at+interval '1 microsecond' where invoice_id=${invoice}::uuid`,
    );
    await tx.execute(
      sql`alter table expert_sales_fee_attempts enable trigger expert_sales_attempt_immutable`,
    );
  });
}
it("explicit choices deny foreign ownership, stale revision, replay conflict and base-quarter SKU", async () => {
  const f = await owner(),
    other = await owner();
  const cmd = {
    ...command(f.scope),
    baseId: f.base.id,
    revision: 0,
    action: "positive" as const,
  };
  await f.sales.transition(cmd);
  expect((await f.sales.transition(cmd))?.replay).toBe(true);
  await expect(
    other.sales.transition({
      ...command(other.scope),
      baseId: f.base.id,
      revision: 0,
      action: "positive",
    }),
  ).rejects.toThrow();
  await expect(
    f.sales.transition({ ...cmd, requestDigest: hash("different") }),
  ).rejects.toThrow();
  await expect(
    f.sales.transition({
      ...command(f.scope),
      baseId: f.base.id,
      revision: 0,
      action: "promo",
    }),
  ).rejects.toThrow();
  await f.sales.transition({
    ...command(f.scope),
    baseId: f.base.id,
    revision: 1,
    action: "base",
  });
  await expect(
    f.sales.transition({
      ...command(f.scope),
      baseId: f.base.id,
      revision: 2,
      action: "quarter",
    }),
  ).rejects.toThrow();
});
it("scheduler does not disclose promotion or invoice to a silent owner, and unpaid erasure removes sales PII", async () => {
  const f = await owner();
  await new PostgresExpertSalesScheduler(db.db).refresh();
  expect(
    (
      await db.db.execute(
        sql`select count(*)::int n from expert_sales_notices where base_id=${f.base.id}::uuid`,
      )
    ).rows[0]?.n,
  ).toBe(0);
  await db.db.execute(
    sql`update users set active=false where id=${f.userId}::uuid`,
  );
  expect(
    (
      await db.db.execute(
        sql`select count(*)::int n from expert_sales_bases where user_id=${f.userId}::uuid`,
      )
    ).rows[0]?.n,
  ).toBe(0);
  expect(
    (
      await db.db.execute(
        sql`select count(*)::int n from expert_sales_erased_cohorts where user_id=${f.userId}::uuid`,
      )
    ).rows[0]?.n,
  ).toBe(1);
});
it("expired waiting payment is GET-verified and canceled, never captured", async () => {
  const f = await approved();
  try {
    await f.checkout.createCheckout({ invoiceId: f.invoice.id });
    await expire(f.invoice.id);
    f.local.waiting();
    const { createSeparatedSalesRunner } =
      await import("../../apps/worker/src/expert-separated-sales-composition.js");
    const { loadEnv } = await import("../../packages/config/src/env.js");
    const config = loadEnv({
      DATABASE_URL: "postgresql://synthetic:synthetic@localhost/fixture",
      ALLOW_INSECURE_LOCAL_DATABASE: "true",
      EXPERT_APPLICANT_ENABLED: "true",
      EXPERT_VERIFICATION_FORM_ENABLED: "true",
      EXPERT_SEPARATED_SALES_ENABLED: "true",
      EXPERT_ONBOARDING_HELD_ENABLED: "true",
      EXPERT_PROMO_TELEGRAM_BOT_ID: policy.botId,
      EXPERT_PROMO_TELEGRAM_BOT_KEY: policy.botKey,
      EXPERT_PROMO_TELEGRAM_WEBHOOK_SECRET: SYNTHETIC_FIXTURE_VALUE_1,
      EXPERT_PROMO_MESSAGING_CONSENT_POLICY_VERSION:
        policy.messagingConsentPolicyVersion,
      EXPERT_VERIFICATION_ENABLED: "true",
      EXPERT_VERIFICATION_CHECKOUT_ENABLED: "true",
      EXPERT_VERIFICATION_PAYMENT_VERIFICATION_ENABLED: "true",
      EXPERT_VERIFICATION_PAYMENT_MODE: "test",
      EXPERT_VERIFICATION_MESSAGING_CONSENT_POLICY_VERSION:
        policy.messagingConsentPolicyVersion,
    });
    const worker = createSeparatedSalesRunner(db.db, config, fetch, {
      client: f.local.client,
      vault: f.vault,
      protector: f.local.protector,
      decryptor: f.local.decryptor,
      returnUrl: "https://example.com/return",
      vatCode: 1,
    })!;
    await worker.runOnce();
    worker.stopAccepting();
    expect(
      f.local.requests.filter((r) => r.path.endsWith("/capture")),
    ).toHaveLength(0);
    expect(
      f.local.requests.filter((r) => r.path.endsWith("/cancel")),
    ).toHaveLength(1);
    expect(
      (
        await db.db.execute(
          sql`select count(*)::int n from expert_sales_paid_locks where user_id=${f.userId}::uuid`,
        )
      ).rows[0]?.n,
    ).toBe(0);
  } finally {
    await f.local.stop();
  }
});
it("unknown create never becomes a second POST and recovers only through actual GET identity", async () => {
  const f = await approved();
  try {
    f.local.dropCreate();
    await expect(
      f.checkout.createCheckout({ invoiceId: f.invoice.id }),
    ).rejects.toThrow();
    expect(
      (
        await f.checkout.recoverCheckout({
          invoiceId: f.invoice.id,
          operationId: f.invoice.operationId,
        })
      ).kind,
    ).toBe("pending");
    expect(f.local.requests.filter((r) => r.method === "POST")).toHaveLength(1);
    await f.checkout.recoverProviderObject(
      session,
      f.invoice.id,
      f.paymentId,
      randomUUID(),
    );
    expect(
      (
        await f.checkout.recoverCheckout({
          invoiceId: f.invoice.id,
          operationId: f.invoice.operationId,
        })
      ).kind,
    ).toBe("ready");
    expect(f.local.requests.filter((r) => r.method === "POST")).toHaveLength(1);
  } finally {
    await f.local.stop();
  }
});
it("deletion during pre-send decryption cancels actual first disclosure", async () => {
  const f = await approved();
  let entered!: () => void, release!: () => void;
  const reached = new Promise<void>((r) => (entered = r)),
    resume = new Promise<void>((r) => (release = r));
  const checkout = new PostgresHeldOnboardingCheckout(db.db, {
    enabled: true,
    client: f.local.client,
    vault: f.vault,
    protector: f.local.protector,
    decryptor: {
      async decrypt(input) {
        entered();
        await resume;
        return f.local.decryptor.decrypt(input);
      },
    },
    repository: f.repo,
    returnUrl: "https://example.com/return",
    vatCode: 1,
    mode: "test",
  });
  let pending: Promise<unknown> | undefined;
  try {
    const send = checkout.recoverCheckout({
      invoiceId: f.invoice.id,
      operationId: f.invoice.operationId,
    });
    pending = send.catch(() => {});
    await reached;
    await db.db.execute(
      sql`update users set active=false where id=${f.userId}::uuid`,
    );
    release();
    expect((await send).kind).toBe("unavailable");
    expect(f.local.requests).toHaveLength(0);
    expect(
      (
        await db.db.execute(
          sql`select encrypted_body from expert_sales_provider_requests where invoice_id=${f.invoice.id}::uuid`,
        )
      ).rows[0]?.encrypted_body,
    ).toBeNull();
  } finally {
    release();
    await pending;
    await f.local.stop();
  }
});
it("proven late money remains immutable recovery work without price lock or interview", async () => {
  const f = await approved();
  try {
    await f.checkout.createCheckout({ invoiceId: f.invoice.id });
    await expire(f.invoice.id);
    const binding = (await f.repo.findOnboardingPaymentBinding(f.invoice.id))!;
    const client = createYooKassaClient(
      { mode: "test", shopId: "test-shop", secretKey: "synthetic-only" },
      async () =>
        new Response(
          JSON.stringify({
            id: f.paymentId,
            status: "succeeded",
            paid: true,
            test: true,
            amount: { value: "3000.00", currency: "RUB" },
            created_at: new Date(Date.now() - 1000).toISOString(),
            captured_at: new Date().toISOString(),
            metadata: {
              order_id: binding.invoiceId,
              user_id: binding.userId,
              operation_id: binding.operationId,
              purpose: "onboarding",
            },
            refundable: true,
          }),
        ),
    );
    const proof = await new YooKassaOnboardingPaymentVerifier(
      client,
      f.repo,
    ).verify(f.invoice.id);
    const result = await f.repo.settleVerified(proof!);
    expect(result.stage).toBeNull();
    expect(
      (
        await db.db.execute(
          sql`select reason from expert_sales_recovery_work where invoice_id=${f.invoice.id}::uuid`,
        )
      ).rows[0]?.reason,
    ).toBe("expired_terms");
    expect(
      (
        await db.db.execute(
          sql`select count(*)::int n from expert_sales_paid_locks where user_id=${f.userId}::uuid`,
        )
      ).rows[0]?.n,
    ).toBe(0);
    await expect(
      db.db.execute(
        sql`delete from expert_onboarding_payment_facts where invoice_id=${f.invoice.id}::uuid`,
      ),
    ).rejects.toThrow();
  } finally {
    await f.local.stop();
  }
});

async function ageBase(baseId: string, hours: number) {
  // Controlled calendar fixture: move immutable historical times together, then
  // restore every guard before exercising production transitions.
  await db.db.transaction(async (tx) => {
    await tx.execute(
      sql`alter table expert_sales_bases disable trigger expert_sales_base_immutable`,
    );
    await tx.execute(
      sql`alter table expert_sales_selections disable trigger expert_sales_selection_immutable`,
    );
    await tx.execute(
      sql`update expert_sales_bases set base_offer_shown_at=base_offer_shown_at-${hours}*interval '1 hour' where id=${baseId}::uuid`,
    );
    await tx.execute(
      sql`update expert_sales_selections set selected_at=selected_at-${hours}*interval '1 hour',offer_expiry_date=offer_expiry_date-${hours}*interval '1 hour' where base_id=${baseId}::uuid`,
    );
    await tx.execute(
      sql`alter table expert_sales_selections enable trigger expert_sales_selection_immutable`,
    );
    await tx.execute(
      sql`alter table expert_sales_bases enable trigger expert_sales_base_immutable`,
    );
  });
}
it("96h refresh creates one new fixed-fee attempt under the original unchanged form approval", async () => {
  const f = await approved();
  try {
    await ageBase(f.base.id, 97);
    await expire(f.invoice.id);
    const scheduler = new PostgresExpertSalesScheduler(db.db);
    await scheduler.refresh();
    await scheduler.refresh();
    const rows = (
      await db.db.execute(
        sql`select i.amount_minor::text amount,i.sales_attempt_number number,s.energy_discount_bps discount from expert_onboarding_invoices i join expert_sales_fee_attempts a on a.invoice_id=i.id join expert_sales_selections s on s.id=a.selection_id where i.user_id=${f.userId}::uuid order by number`,
      )
    ).rows;
    expect(rows).toEqual([
      { amount: "300000", number: 1, discount: 4000 },
      { amount: "300000", number: 2, discount: 3000 },
    ]);
    expect(
      (await f.sales.transition(command(f.scope)))?.selectedTotalMinor,
    ).toBe("699300");
  } finally {
    await f.local.stop();
  }
});
it("lost quarter requires explicit monthly choice and reuses the same quality approval", async () => {
  const f = await approved("quarter");
  try {
    await ageBase(f.base.id, 169);
    await expire(f.invoice.id);
    await new PostgresExpertSalesScheduler(db.db).refresh();
    const read = await f.sales.transition(command(f.scope));
    expect(read).toMatchObject({
      state: "period",
      packagePriceMinor: null,
      termMonths: 3,
      selectedTotalMinor: null,
    });
    expect(
      (
        await db.db.execute(
          sql`select count(*)::int n from expert_onboarding_invoices where user_id=${f.userId}::uuid`,
        )
      ).rows[0]?.n,
    ).toBe(1);
    await f.sales.transition({
      ...command(f.scope),
      baseId: f.base.id,
      revision: read!.revision,
      action: "month",
    });
    expect(
      (
        await db.db.execute(
          sql`select count(*)::int n from expert_onboarding_invoices where user_id=${f.userId}::uuid`,
        )
      ).rows[0]?.n,
    ).toBe(2);
    expect(
      (
        await db.db.execute(
          sql`select count(*)::int n from expert_verification_decisions where user_id=${f.userId}::uuid`,
        )
      ).rows[0]?.n,
    ).toBe(1);
  } finally {
    await f.local.stop();
  }
});
it("day10 silence stays base-only; explicit base selection remains monthly and unlocked", async () => {
  const f = await owner();
  await ageBase(f.base.id, 241);
  await new PostgresExpertSalesScheduler(db.db).refresh();
  expect(await f.sales.transition(command(f.scope))).toMatchObject({
    state: "base",
    standardOnly: true,
    promotion: null,
    monthlyPriceMinor: null,
    selectedTotalMinor: null,
  });
  await f.sales.transition({
    ...command(f.scope),
    baseId: f.base.id,
    revision: 0,
    action: "positive",
  });
  await expect(
    f.sales.transition({
      ...command(f.scope),
      baseId: f.base.id,
      revision: 1,
      action: "promo",
    }),
  ).rejects.toThrow();
  await f.sales.transition({
    ...command(f.scope),
    baseId: f.base.id,
    revision: 1,
    action: "base",
  });
  expect(
    await f.sales.transition({
      ...command(f.scope),
      baseId: f.base.id,
      revision: 2,
      action: "month",
    }),
  ).toMatchObject({
    state: "form",
    standardOnly: true,
    promotion: false,
    termMonths: 1,
    selectedTotalMinor: "999000",
  });
});
it("24h reminders have one durable scoped receipt and revoked owners receive nothing", async () => {
  const f = await owner();
  await f.sales.transition({
    ...command(f.scope),
    baseId: f.base.id,
    revision: 0,
    action: "positive",
  });
  await ageBase(f.base.id, 73);
  let sent = 0;
  const scheduler = new PostgresExpertSalesScheduler(db.db, {
    async send(input) {
      sent++;
      return {
        botId: input.botId,
        chatId: input.chatId,
        messageId: String(sent),
        digest: input.digest,
      };
    },
  });
  await scheduler.refresh();
  await scheduler.deliver(new AbortController().signal);
  const after = sent;
  await scheduler.deliver(new AbortController().signal);
  expect(sent).toBe(after);
  expect(
    (
      await db.db.execute(
        sql`select kind,status from expert_sales_notices where base_id=${f.base.id}::uuid`,
      )
    ).rows,
  ).toEqual([{ kind: "24h", status: "delivered" }]);
  const revoked = await owner();
  await revoked.sales.transition({
    ...command(revoked.scope),
    baseId: revoked.base.id,
    revision: 0,
    action: "positive",
  });
  await ageBase(revoked.base.id, 94);
  await scheduler.refresh();
  await db.db.execute(
    sql`update users set active=false where id=${revoked.userId}::uuid`,
  );
  const before = sent;
  await scheduler.deliver(new AbortController().signal);
  expect(sent).toBe(before);
});

it("an explicit unpaid intake transition preserves the original form and enters separated sales", async () => {
  const f = await owner(true);
  const before = (
    await db.db.execute(
      sql`select id,revision,draft from residents_applications where user_id=${f.userId}::uuid`,
    )
  ).rows[0];
  expect(before).toBeDefined();
  await selection(f);
  await f.form.mutate({ ...command(f.scope), action: "start" });
  expect(
    (
      await db.db.execute(
        sql`select id,revision,draft from residents_applications where user_id=${f.userId}::uuid`,
      )
    ).rows[0],
  ).toEqual(before);
  expect((await f.sales.transition(command(f.scope)))?.state).toBe("form");
});
it("on-time capture reported after checkout expiry still locks its original bound terms", async () => {
  const f = await approved();
  try {
    await f.checkout.createCheckout({ invoiceId: f.invoice.id });
    f.local.waiting();
    await f.checkout.reconcile(f.invoice.id);
    const observation = await f.local.client.inspect(f.paymentId);
    expect(observation.status).toBe("succeeded");
    await db.db.transaction(async (tx) => {
      await tx.execute(
        sql`alter table expert_sales_fee_attempts disable trigger expert_sales_attempt_immutable`,
      );
      await tx.execute(
        sql`update expert_sales_fee_attempts set expires_at=${observation.capturedAt}::timestamptz+interval '1 microsecond' where invoice_id=${f.invoice.id}::uuid`,
      );
      await tx.execute(
        sql`alter table expert_sales_fee_attempts enable trigger expert_sales_attempt_immutable`,
      );
    });
    await f.checkout.reconcileKnown();
    expect(
      (
        await db.db.execute(
          sql`select invoice_id from expert_sales_paid_locks where user_id=${f.userId}::uuid`,
        )
      ).rows[0]?.invoice_id,
    ).toBe(f.invoice.id);
  } finally {
    await f.local.stop();
  }
});
it("a proven capture after erasure retains money and recovery but no paid lock or receipt PII", async () => {
  const f = await approved();
  try {
    await f.checkout.createCheckout({ invoiceId: f.invoice.id });
    f.local.waiting();
    await f.checkout.reconcile(f.invoice.id);
    await db.db.execute(
      sql`update users set active=false where id=${f.userId}::uuid`,
    );
    await f.checkout.reconcile(f.invoice.id);
    expect(
      (
        await db.db.execute(
          sql`select admission,reason_code from expert_onboarding_payment_facts where invoice_id=${f.invoice.id}::uuid`,
        )
      ).rows[0],
    ).toEqual({ admission: "blocked", reason_code: "owner_inactive" });
    expect(
      (
        await db.db.execute(
          sql`select count(*)::int n from expert_sales_paid_locks where user_id=${f.userId}::uuid`,
        )
      ).rows[0]?.n,
    ).toBe(0);
    expect(
      (
        await db.db.execute(
          sql`select encrypted_body from expert_sales_provider_requests where invoice_id=${f.invoice.id}::uuid and kind='create'`,
        )
      ).rows[0]?.encrypted_body,
    ).toBeNull();
  } finally {
    await f.local.stop();
  }
});
it("checkout TTL refreshes before the commercial stage without repricing or a new manager decision", async () => {
  const f = await approved();
  try {
    await expire(f.invoice.id);
    await new PostgresExpertSalesScheduler(db.db).refresh();
    expect(
      (
        await db.db.execute(
          sql`select i.sales_attempt_number number,s.selected_total_minor::text total from expert_onboarding_invoices i join expert_sales_fee_attempts a on a.invoice_id=i.id join expert_sales_selections s on s.id=a.selection_id where i.user_id=${f.userId}::uuid order by number`,
        )
      ).rows,
    ).toEqual([
      { number: 1, total: "599400" },
      { number: 2, total: "599400" },
    ]);
  } finally {
    await f.local.stop();
  }
});
it("erasing the submitted form alone blocks delayed captured money from re-admitting the applicant", async () => {
  const f = await approved();
  try {
    await f.checkout.createCheckout({ invoiceId: f.invoice.id });
    f.local.waiting();
    await f.checkout.reconcile(f.invoice.id);
    await db.db.execute(
      sql`delete from residents_applications where user_id=${f.userId}::uuid`,
    );
    await f.checkout.reconcile(f.invoice.id);
    expect(
      (
        await db.db.execute(
          sql`select admission,reason_code from expert_onboarding_payment_facts where invoice_id=${f.invoice.id}::uuid`,
        )
      ).rows[0],
    ).toEqual({ admission: "blocked", reason_code: "application_erased" });
    expect(
      (
        await db.db.execute(
          sql`select count(*)::int n from expert_sales_paid_locks where user_id=${f.userId}::uuid`,
        )
      ).rows[0]?.n,
    ).toBe(0);
  } finally {
    await f.local.stop();
  }
});

it("two genuine captures serialize to one lifetime winner and explicit duplicate-fee recovery", async () => {
  const f = await approved();
  let second: Awaited<ReturnType<typeof startHeldOnboardingLocal>> | undefined;
  try {
    await f.checkout.createCheckout({ invoiceId: f.invoice.id });
    f.local.waiting();
    await f.checkout.reconcile(f.invoice.id);
    const first = await f.local.client.inspect(f.paymentId);
    await db.db.transaction(async (tx) => {
      await tx.execute(
        sql`alter table expert_sales_fee_attempts disable trigger expert_sales_attempt_immutable`,
      );
      await tx.execute(
        sql`update expert_sales_fee_attempts set expires_at=${first.capturedAt}::timestamptz+interval '1 microsecond' where invoice_id=${f.invoice.id}::uuid`,
      );
      await tx.execute(
        sql`alter table expert_sales_fee_attempts enable trigger expert_sales_attempt_immutable`,
      );
    });
    await new PostgresExpertSalesScheduler(db.db).refresh();
    const invoice = (
      await db.db.execute<{ id: string }>(
        sql`select id from expert_onboarding_invoices where user_id=${f.userId}::uuid and sales_attempt_number=2`,
      )
    ).rows[0]!;
    second = await startHeldOnboardingLocal(`duplicate_${randomUUID()}`);
    const checkout = new PostgresHeldOnboardingCheckout(db.db, {
      enabled: true,
      client: second.client,
      vault: f.vault,
      protector: second.protector,
      decryptor: second.decryptor,
      repository: f.repo,
      returnUrl: "https://example.com/return",
      vatCode: 1,
      mode: "test",
    });
    await checkout.createCheckout({ invoiceId: invoice.id });
    second.waiting();
    await checkout.reconcile(invoice.id);
    await Promise.all([
      f.checkout.reconcile(f.invoice.id),
      checkout.reconcile(invoice.id),
    ]);
    expect(
      (
        await db.db.execute(
          sql`select count(*)::int n from expert_sales_paid_locks where user_id=${f.userId}::uuid`,
        )
      ).rows[0]?.n,
    ).toBe(1);
    expect(
      (
        await db.db.execute(
          sql`select reason_code from expert_onboarding_payment_facts where user_id=${f.userId}::uuid order by reason_code`,
        )
      ).rows,
    ).toEqual([
      { reason_code: "duplicate_fee" },
      { reason_code: "payment_verified" },
    ]);
  } finally {
    await f.local.stop();
    await second?.stop();
  }
});

it("review R3 supplemental answers preserve the submitted approval and capture authority", async () => {
  const f = await approved();
  try {
    const form = await f.form.mutate({ ...command(f.scope), action: "start" });
    await f.form.mutate({
      ...command(f.scope),
      action: "followup",
      expectedRevision: form.revision,
      answer: "Дополнение без изменения отправленной анкеты",
    });
    await f.checkout.createCheckout({ invoiceId: f.invoice.id });
    f.local.waiting();
    await f.checkout.reconcile(f.invoice.id);
    await f.checkout.reconcile(f.invoice.id);
    expect(
      (
        await db.db.execute(
          sql`select count(*)::int n from expert_sales_paid_locks where user_id=${f.userId}::uuid`,
        )
      ).rows[0]?.n,
    ).toBe(1);
  } finally {
    await f.local.stop();
  }
});
it("review R4 quarter to month before first manager approval uses the new explicit period", async () => {
  const f = await approved("quarter", {
    beforeDecision: async (f) => {
      await ageBase(f.base.id, 169);
      const read = await f.sales.transition(command(f.scope));
      await f.sales.transition({
        ...command(f.scope),
        baseId: f.base.id,
        revision: read!.revision,
        action: "month",
      });
    },
  });
  try {
    expect(
      (
        await db.db.execute(
          sql`select s.term_months term from expert_sales_fee_attempts a join expert_sales_selections s on s.id=a.selection_id where a.invoice_id=${f.invoice.id}::uuid`,
        )
      ).rows[0]?.term,
    ).toBe(1);
  } finally {
    await f.local.stop();
  }
});
it("review R5 expired monthly selection refreshes inside the real form submit transaction", async () => {
  const f = await approved("month", {
    beforeSubmit: async (f) => ageBase(f.base.id, 97),
  });
  try {
    expect(
      (
        await db.db.execute(
          sql`select s.energy_discount_bps discount from expert_sales_fee_attempts a join expert_sales_selections s on s.id=a.selection_id where a.invoice_id=${f.invoice.id}::uuid`,
        )
      ).rows[0]?.discount,
    ).toBe(3000);
  } finally {
    await f.local.stop();
  }
});
it("review R7 unresolved owner does not abort the scheduler batch", async () => {
  const f = await approved(),
    g = await approved();
  try {
    f.local.dropCreate();
    await expect(
      f.checkout.createCheckout({ invoiceId: f.invoice.id }),
    ).rejects.toThrow();
    await ageBase(f.base.id, 97);
    await ageBase(g.base.id, 97);
    await expire(f.invoice.id);
    await expire(g.invoice.id);
    await expect(
      new PostgresExpertSalesScheduler(db.db).refresh(50),
    ).resolves.toBeDefined();
    expect(
      (
        await db.db.execute(
          sql`select count(*)::int n from expert_onboarding_invoices where user_id=${f.userId}::uuid`,
        )
      ).rows[0]?.n,
    ).toBe(1);
    expect(
      (
        await db.db.execute(
          sql`select count(*)::int n from expert_onboarding_invoices where user_id=${g.userId}::uuid`,
        )
      ).rows[0]?.n,
    ).toBe(2);
  } finally {
    await f.local.stop();
    await g.local.stop();
  }
});
it("review R9 preparation failure retries definitely unsent notice", async () => {
  const f = await approved();
  let fail = true,
    sent = 0;
  try {
    await ageBase(f.base.id, 97);
    await expire(f.invoice.id);
    const scheduler = new PostgresExpertSalesScheduler(
      db.db,
      {
        async send(i) {
          sent++;
          return { ...i, messageId: "123" };
        },
      },
      {
        async recoverCheckout() {
          if (fail) throw Error("preparation_failed");
          return { kind: "pending" };
        },
      },
    );
    await scheduler.refresh(50);
    await db.db.execute(
      sql`update expert_sales_notices n set status='cancelled' from expert_sales_bases b where b.id=n.base_id and b.user_id<>${f.userId}::uuid and n.status='pending'`,
    );
    await scheduler.deliver(new AbortController().signal);
    expect(sent).toBe(0);
    expect(
      (
        await db.db.execute(
          sql`select count(*)::int n from expert_sales_notices n join expert_sales_bases b on b.id=n.base_id where b.user_id=${f.userId}::uuid and n.status='pending'`,
        )
      ).rows[0]?.n,
    ).toBe(1);
    fail = false;
    expect(
      (await scheduler.deliver(new AbortController().signal)).delivered,
    ).toBe(1);
    expect(sent).toBe(1);
  } finally {
    await f.local.stop();
  }
});
it("review R10 R11 reselection cancels superseded notices and queues one replacement", async () => {
  const f = await approved("quarter");
  try {
    await ageBase(f.base.id, 169);
    await expire(f.invoice.id);
    await new PostgresExpertSalesScheduler(db.db).refresh(50);
    const s = await f.sales.transition(command(f.scope));
    await f.sales.transition({
      ...command(f.scope),
      baseId: f.base.id,
      revision: s!.revision,
      action: "month",
    });
    const notices = (
      await db.db.execute(
        sql`select n.kind,n.status from expert_sales_notices n join expert_sales_bases b on b.id=n.base_id where b.user_id=${f.userId}::uuid`,
      )
    ).rows;
    expect(
      notices.filter((n) => n.kind === "reselect" && n.status === "pending"),
    ).toHaveLength(0);
    expect(
      notices.filter((n) => n.kind === "refresh" && n.status === "pending"),
    ).toHaveLength(1);
  } finally {
    await f.local.stop();
  }
});
it.each(["succeeded", "canceled"] as const)(
  "review R8 R13 lost capture ACK resolves authoritative %s without repost",
  async (terminal) => {
    const f = await approved();
    try {
      await f.checkout.createCheckout({ invoiceId: f.invoice.id });
      f.local.waiting();
      f.local.dropCapture(terminal);
      await expect(f.checkout.reconcile(f.invoice.id)).rejects.toThrow();
      expect(
        (
          await db.db.execute(
            sql`select status from expert_sales_provider_requests where invoice_id=${f.invoice.id}::uuid and kind='capture'`,
          )
        ).rows[0]?.status,
      ).toBe("dispatched");
      await f.checkout.reconcile(f.invoice.id);
      await f.checkout.reconcile(f.invoice.id);
      expect(
        f.local.requests.filter((r) => r.path.endsWith("/capture")),
      ).toHaveLength(1);
      expect(
        (
          await db.db.execute(
            sql`select status from expert_sales_provider_requests where invoice_id=${f.invoice.id}::uuid and kind='capture'`,
          )
        ).rows[0]?.status,
      ).toBe(terminal === "succeeded" ? "observed" : "cancelled");
      expect(
        (
          await db.db.execute(
            sql`select count(*)::int n from expert_sales_paid_locks where user_id=${f.userId}::uuid`,
          )
        ).rows[0]?.n,
      ).toBe(terminal === "succeeded" ? 1 : 0);
      if (terminal === "canceled") {
        await expire(f.invoice.id);
        await f.sales.transition(command(f.scope));
        expect(
          (
            await db.db.execute(
              sql`select count(*)::int n from expert_onboarding_invoices where user_id=${f.userId}::uuid`,
            )
          ).rows[0]?.n,
        ).toBe(2);
      }
    } finally {
      await f.local.stop();
    }
  },
);
it("review R13 lost cancel ACK is resolved by GET without repost", async () => {
  const f = await approved();
  try {
    await f.checkout.createCheckout({ invoiceId: f.invoice.id });
    f.local.waiting();
    await expire(f.invoice.id);
    f.local.dropCancel();
    await expect(f.checkout.reconcile(f.invoice.id)).rejects.toThrow();
    await f.checkout.reconcile(f.invoice.id);
    await f.checkout.reconcile(f.invoice.id);
    expect(
      f.local.requests.filter((r) => r.path.endsWith("/cancel")),
    ).toHaveLength(1);
    expect(
      (
        await db.db.execute(
          sql`select status from expert_sales_provider_requests where invoice_id=${f.invoice.id}::uuid and kind='cancel'`,
        )
      ).rows[0]?.status,
    ).toBe("observed");
    expect(
      (
        await db.db.execute(
          sql`select count(*)::int n from expert_sales_paid_locks where user_id=${f.userId}::uuid`,
        )
      ).rows[0]?.n,
    ).toBe(0);
  } finally {
    await f.local.stop();
  }
});
it("review R2 expired original bridge quote retains finite fiscal custody for later approval and replacement", async () => {
  const f = await approved("month", {
    beforeSubmit: async (f) => ageBase(f.base.id, 26),
    beforeDecision: async (f) => {
      await db.db.transaction(async (tx) => {
        await tx.execute(
          sql`alter table expert_campaign_quotes disable trigger expert_campaign_quotes_append_only`,
        );
        await tx.execute(
          sql`update expert_campaign_quotes set quoted_at=quoted_at-interval '25 hours',expires_at=expires_at-interval '25 hours' where user_id=${f.userId}::uuid`,
        );
        await tx.execute(
          sql`alter table expert_campaign_quotes enable trigger expert_campaign_quotes_append_only`,
        );
      });
    },
  });
  try {
    const receipts = new PostgresPayerReceiptContactRepository(
      db.db,
      f.vault,
      30,
    );
    await receipts.redactExpiredSelection(await receipts.listExpiredBatch(50));
    expect(
      (
        await db.db.execute(
          sql`select redacted_at from payer_receipt_contacts where user_id=${f.userId}::uuid`,
        )
      ).rows[0]?.redacted_at,
    ).toBeNull();
    await f.checkout.createCheckout({ invoiceId: f.invoice.id });
    await expire(f.invoice.id);
    await f.sales.transition(command(f.scope));
    const latest = (
      await db.db.execute<{ id: string }>(
        sql`select id from expert_onboarding_invoices where user_id=${f.userId}::uuid order by sales_attempt_number desc limit 1`,
      )
    ).rows[0]!;
    expect(latest.id).not.toBe(f.invoice.id);
    const replacement = await startHeldOnboardingLocal(
      `replacement_${randomUUID()}`,
    );
    try {
      const checkout = new PostgresHeldOnboardingCheckout(db.db, {
        enabled: true,
        client: replacement.client,
        vault: f.vault,
        protector: replacement.protector,
        decryptor: replacement.decryptor,
        repository: f.repo,
        returnUrl: "https://example.com/return",
        vatCode: 1,
        mode: "test",
      });
      await expect(
        checkout.createCheckout({ invoiceId: latest.id }),
      ).resolves.toHaveProperty("url");
    } finally {
      await replacement.stop();
    }
  } finally {
    await f.local.stop();
  }
});
it("review R6 operational recovery requires fresh manager and records the real GET binding", async () => {
  const f = await approved();
  const Fastify = createRequire(
    new URL("../../apps/api/package.json", import.meta.url),
  )(
    "fastify",
  ) as typeof import("../../apps/api/node_modules/fastify/fastify.js").default;
  const { expertVerificationRoutes } =
    await import("../../apps/api/src/routes/expert-verification.js");
  const { createExpertVerificationService } =
    await import("../../packages/application/src/expert-verification-service.js");
  const app = Fastify({ logger: false });
  try {
    f.local.dropCreate();
    await expect(
      f.checkout.createCheckout({ invoiceId: f.invoice.id }),
    ).rejects.toThrow();
    const token = SYNTHETIC_FIXTURE_VALUE_2,
      sessionHash = `sha256:${hash(token)}`;
    await db.db.execute(
      sql`insert into admin_sessions(session_id_hash,admin_id,mfa_verified_at,expires_at) select ${sessionHash},admin_id,clock_timestamp(),clock_timestamp()+interval '1 hour' from admin_sessions where session_id_hash=${session}`,
    );
    await app.register(expertVerificationRoutes, {
      enabled: true,
      service: createExpertVerificationService({
        enabled: true,
        repository: f.repo,
        heldCheckout: f.checkout,
      }),
    });
    const payload = {
        providerObjectId: f.paymentId,
        idempotencyKey: randomUUID(),
      },
      url = `/v1/admin/expert-verification/invoices/${f.invoice.id}/recover`;
    expect(
      (
        await app.inject({
          method: "POST",
          url,
          headers: {
            authorization: "Bearer synthetic_foreign_token_123456789",
          },
          payload,
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await app.inject({
          method: "POST",
          url,
          headers: { authorization: `Bearer ${token}` },
          payload: { ...payload, providerObjectId: "foreign_payment" },
        })
      ).statusCode,
    ).toBe(503);
    for (let i = 0; i < 2; i++)
      expect(
        (
          await app.inject({
            method: "POST",
            url,
            headers: { authorization: `Bearer ${token}` },
            payload,
          })
        ).statusCode,
      ).toBe(200);
    expect(
      (
        await db.db.execute(
          sql`select count(*)::int n from expert_sales_operator_recoveries where invoice_id=${f.invoice.id}::uuid`,
        )
      ).rows[0]?.n,
    ).toBe(1);
    await db.db.execute(
      sql`update admin_sessions set mfa_verified_at=clock_timestamp()-interval '16 minutes' where session_id_hash=${sessionHash}`,
    );
    expect(
      (
        await app.inject({
          method: "POST",
          url,
          headers: { authorization: `Bearer ${token}` },
          payload,
        })
      ).statusCode,
    ).toBe(403);
    expect(f.local.requests.filter((r) => r.method === "POST")).toHaveLength(1);
  } finally {
    await app.close();
    await f.local.stop();
  }
});
it.each(["foreign_bot", "foreign_chat", "matching"] as const)(
  "review R13 R14 actual worker Telegram parser %s and exact stage amounts",
  async (mode) => {
    const f = await owner();
    await selection(f);
    await ageBase(f.base.id, 95);
    await db.db.execute(
      sql`insert into expert_sales_ticks(base_id,checked_at) select id,clock_timestamp() from expert_sales_bases where id<>${f.base.id}::uuid on conflict(base_id) do update set checked_at=excluded.checked_at`,
    );
    await db.db.execute(
      sql`update expert_sales_notices set status='cancelled' where status='pending'`,
    );
    const { createSeparatedSalesRunner } =
      await import("../../apps/worker/src/expert-separated-sales-composition.js");
    const { loadEnv } = await import("../../packages/config/src/env.js");
    const config = loadEnv({
      DATABASE_URL: "postgresql://synthetic:synthetic@localhost/fixture",
      ALLOW_INSECURE_LOCAL_DATABASE: "true",
      EXPERT_APPLICANT_ENABLED: "true",
      EXPERT_VERIFICATION_FORM_ENABLED: "true",
      EXPERT_SEPARATED_SALES_ENABLED: "true",
      EXPERT_PROMO_TELEGRAM_BOT_ID: policy.botId,
      EXPERT_PROMO_TELEGRAM_BOT_KEY: policy.botKey,
      EXPERT_PROMO_TELEGRAM_WEBHOOK_SECRET: SYNTHETIC_FIXTURE_VALUE_1,
      EXPERT_PROMO_MESSAGING_CONSENT_POLICY_VERSION:
        policy.messagingConsentPolicyVersion,
    });
    let sent = "";
    const runner = createSeparatedSalesRunner(
      db.db,
      {
        ...config,
        features: { ...config.features, expertResidencyNoticeDelivery: true },
        expertApplicant: {
          ...config.expertApplicant!,
          botToken: `${policy.botId}:synthetic_test_token_only`,
        },
      },
      async (_url, init) => {
        sent = JSON.parse(String(init?.body)).text;
        return new Response(
          JSON.stringify({
            ok: true,
            result: {
              message_id: 123,
              from: {
                id: mode === "foreign_bot" ? 999 : Number(policy.botId),
                is_bot: true,
              },
              chat: {
                id: mode === "foreign_chat" ? 999 : Number(f.scope.chatId),
                type: "private",
              },
            },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      },
    )!;
    try {
      await runner.runOnce();
      expect(sent).toContain("5994 ₽");
      expect(sent).toContain("6993 ₽");
      expect(sent).toContain("Срок:");
      expect(sent).toContain("осталось");
      expect(sent).not.toContain("https://yookassa");
      expect(
        (
          await db.db.execute(
            sql`select status from expert_sales_notices where base_id=${f.base.id}::uuid and kind='3h'`,
          )
        ).rows[0]?.status,
      ).toBe(mode === "matching" ? "delivered" : "dispatched");
    } finally {
      runner.stopAccepting();
    }
  },
);
it.each(["waiting", "canceled"] as const)(
  "review R13 normal held composition receives actual HTTP %s webhook",
  async (terminal) => {
    const f = await approved();
    const Fastify = createRequire(
      new URL("../../apps/api/package.json", import.meta.url),
    )(
      "fastify",
    ) as typeof import("../../apps/api/node_modules/fastify/fastify.js").default;
    const app = Fastify({ logger: false });
    try {
      const { loadEnv } = await import("../../packages/config/src/env.js");
      const { createExpertVerificationComposition } =
        await import("../../apps/api/src/expert-verification-composition.js");
      const { yookassaWebhookRoutes } =
        await import("../../apps/api/src/routes/yookassa-webhook.js");
      const { PostgresWebhookInboxRepository } =
        await import("../../packages/db/src/repositories/webhook-inbox-repository.js");
      const { PostgresYooKassaPaymentPurposeRepository } =
        await import("../../packages/db/src/repositories/yookassa-payment-purpose-repository.js");
      const config = loadEnv({
        DATABASE_URL: "postgresql://synthetic:synthetic@localhost/fixture",
        ALLOW_INSECURE_LOCAL_DATABASE: "true",
        EXPERT_APPLICANT_ENABLED: "true",
        EXPERT_VERIFICATION_FORM_ENABLED: "true",
        EXPERT_SEPARATED_SALES_ENABLED: "true",
        EXPERT_ONBOARDING_HELD_ENABLED: "true",
        EXPERT_PROMO_TELEGRAM_BOT_ID: policy.botId,
        EXPERT_PROMO_TELEGRAM_BOT_KEY: policy.botKey,
        EXPERT_PROMO_TELEGRAM_WEBHOOK_SECRET: SYNTHETIC_FIXTURE_VALUE_1,
        EXPERT_PROMO_MESSAGING_CONSENT_POLICY_VERSION:
          policy.messagingConsentPolicyVersion,
        EXPERT_VERIFICATION_ENABLED: "true",
        EXPERT_VERIFICATION_CHECKOUT_ENABLED: "true",
        EXPERT_VERIFICATION_PAYMENT_VERIFICATION_ENABLED: "true",
        EXPERT_VERIFICATION_PAYMENT_MODE: "test",
        EXPERT_VERIFICATION_MESSAGING_CONSENT_POLICY_VERSION:
          policy.messagingConsentPolicyVersion,
      });
      const capability = createExpertVerificationComposition(db.db, config, {
        providerMode: "test",
        heldOnboarding: {
          client: f.local.client,
          vault: f.vault,
          protector: f.local.protector,
          decryptor: f.local.decryptor,
          returnUrl: "https://example.com/return",
          vatCode: 1,
        },
        paymentVerification: {
          authoritativeGet: true,
          client: { getPayment: (id) => f.local.client.inspect(id) },
        },
      })!;
      expect(
        await capability.service.checkout(session, f.invoice.id),
      ).toMatchObject({ kind: "ok", payment: { status: "ready" } });
      f.local.waiting();
      if (terminal === "canceled") {
        await expire(f.invoice.id);
        await f.checkout.reconcile(f.invoice.id);
      }
      const purposes = new PostgresYooKassaPaymentPurposeRepository(db.db);
      await yookassaWebhookRoutes(app, {
        effectivePeerAddress: () => "185.71.76.1",
        inbox: new PostgresWebhookInboxRepository(db.db),
        resolvePurpose: (id, event) => purposes.resolvePurpose(id, event),
        onboarding: capability.onboardingWebhook!,
        verify: async () => {
          throw Error("wrong_main_route");
        },
        deliver: async () => {
          throw Error("wrong_main_route");
        },
        resolveSucceeded: async () => {
          throw Error("wrong_main_route");
        },
      });
      const payload = {
        type: "notification",
        event:
          terminal === "waiting"
            ? "payment.waiting_for_capture"
            : "payment.canceled",
        object: { id: f.paymentId, metadata: { purpose: "MAIN_SUBSCRIPTION" } },
      };
      for (let n = 0; n < 2; n++) {
        const res = await app.inject({
          method: "POST",
          url: "/v1/webhooks/yookassa",
          payload,
        });
        expect(res.statusCode, res.body).toBe(200);
      }
      expect(
        f.local.requests.filter((r) => r.path.endsWith("/capture")),
      ).toHaveLength(terminal === "waiting" ? 1 : 0);
      expect(
        (
          await db.db.execute(
            sql`select status from expert_onboarding_invoices where id=${f.invoice.id}::uuid`,
          )
        ).rows[0]?.status,
      ).toBe(terminal === "waiting" ? "pending" : "cancelled");
    } finally {
      await app.close();
      await f.local.stop();
    }
  },
);
