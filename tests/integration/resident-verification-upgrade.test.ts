import { readFileSync } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { createPayerReceiptVault } from "@ii-tonya/integrations";
import {
  startExpertReferralTestDatabase,
  type ExpertReferralTestDatabase,
} from "../../packages/db/src/testkit/expert-referral.js";
import { seedClientConsent } from "../../packages/db/src/testkit/client-consent.js";
import { saveExpertOfferProfile } from "../../packages/db/src/repositories/expert-offer-v2.js";
import {
  PostgresExpertSeparatedSalesRepository,
  bridgeSeparatedSalesForm,
} from "../../packages/db/src/repositories/expert-separated-sales-repository.js";
import { PostgresResidentVerificationRepository } from "../../packages/db/src/repositories/resident-verification-repository.js";
import { PostgresExpertVerificationRepository } from "../../packages/db/src/repositories/expert-verification-repository.js";
import { PostgresHeldOnboardingCheckout } from "../../packages/db/src/repositories/expert-held-onboarding-repository.js";
import { PostgresPayerReceiptContactRepository } from "../../packages/db/src/repositories/payer-receipt-contact-repository.js";
import { startHeldOnboardingLocal } from "../support/held-onboarding-local.js";
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
  db = await startExpertReferralTestDatabase(async (connection) => {
    const journal = JSON.parse(
      readFileSync("packages/db/migrations/meta/_journal.json", "utf8"),
    );
    for (const e of journal.entries.filter((e: { idx: number }) => e.idx <= 61))
      await connection.execute(
        sql.raw(readFileSync(`packages/db/migrations/${e.tag}.sql`, "utf8")),
      );
  });
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
  await db.db.transaction(async (tx) => {
    const draft = {
      roles: ["EXPERT"],
      primaryRole: "EXPERT",
      category: "BASIC",
      tax: "SELF_EMPLOYED",
      city: "Казань",
      socialLinks: ["https://example.com/expert"],
      motivation: "Практика",
      specialization: "Психология",
      averageCheckMinor: "300000",
    };
    const row = (
      await tx.execute<{ id: string }>(
        sql`update residents_applications set draft=${JSON.stringify(draft)}::jsonb,submitted_draft=${JSON.stringify(draft)}::jsonb,submitted_at=clock_timestamp(),revision=revision+1,status='UNDER_REVIEW',progress='AUTO_CHECK' where user_id=${f.userId}::uuid returning id`,
      )
    ).rows[0]!;
    await tx.execute(
      sql`insert into resident_verification_check_work(application_id,user_id,submitted_revision) values(${row.id}::uuid,${f.userId}::uuid,1) on conflict(application_id) do nothing`,
    );
    await bridgeSeparatedSalesForm(tx, f.userId, row.id, 1);
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

it("upgrades genuine pending/submitted/approved/paid v1 history without rewriting financial facts or frozen bytes", async () => {
  const pending = await owner();
  const approvedOwner = await approved();
  const paid = await approved("quarter");
  try {
    await paid.checkout.createCheckout({ invoiceId: paid.invoice.id });
    paid.local.waiting();
    await paid.checkout.reconcile(paid.invoice.id);
    await paid.checkout.reconcile(paid.invoice.id);
    expect(
      (
        await db.db.execute(
          sql`select invoice_id from expert_sales_paid_locks where user_id=${paid.userId}::uuid`,
        )
      ).rows[0]?.invoice_id,
    ).toBe(paid.invoice.id);
    const submittedId = await db.createUser(),
      identity = randomUUID(),
      formId = randomUUID();
    await db.db.execute(
      sql`insert into channel_identities(id,user_id,provider,bot_key,external_id,external_chat_id,status) values(${identity}::uuid,${submittedId}::uuid,'telegram','upgrade-submitted','987654','987654','active')`,
    );
    await db.db.execute(
      sql`insert into residents_applications(id,user_id,bot_id,bot_key,channel_identity_id,telegram_user_id,chat_id) values(${formId}::uuid,${submittedId}::uuid,'717171','upgrade-submitted',${identity}::uuid,'987654','987654')`,
    );
    const draft = {
      roles: ["OTHER"],
      primaryRole: "OTHER",
      category: "BASIC",
      tax: "INDIVIDUAL",
      city: "Онлайн",
      socialLinks: ["https://example.com/"],
      motivation: "Практика",
      path: "Путь",
      cases: "Опыт",
    };
    await db.db.execute(
      sql`update residents_applications set draft=${JSON.stringify(draft)}::jsonb,submitted_draft=${JSON.stringify(draft)}::jsonb,submitted_at=clock_timestamp(),revision=1,status='UNDER_REVIEW',progress='AUTO_CHECK' where id=${formId}::uuid`,
    );
    const forms = async () =>
      (
        await db.db.execute(
          sql`select id,user_id,form_version,policy_version,education_requirement,draft,submitted_draft,submitted_at,revision,status,progress from residents_applications order by id`,
        )
      ).rows;
    const tables = [
      "expert_sales_bases",
      "expert_sales_selections",
      "expert_campaign_quotes",
      "expert_sales_form_bridges",
      "expert_onboarding_applications",
      "expert_verification_decisions",
      "expert_onboarding_invoices",
      "expert_sales_paid_locks",
      "expert_sales_fee_attempts",
    ];
    const financial = async () =>
      Promise.all(
        tables.map(
          async (table) =>
            (
              await db.db.execute(
                sql.raw(
                  `select to_jsonb(t) row from ${table} t order by to_jsonb(t)::text`,
                ),
              )
            ).rows,
        ),
      );
    const beforeForms = await forms(),
      beforeFinance = await financial();
    expect(beforeForms).toHaveLength(4);
    await db.db.execute(
      sql.raw(
        readFileSync(
          "packages/db/migrations/0062_resident_verification_messages.sql",
          "utf8",
        ),
      ),
    );
    expect(await forms()).toEqual(beforeForms);
    expect(await financial()).toEqual(beforeFinance);
    const resumed = await pending.form.mutate({
      ...command(pending.scope),
      action: "start",
    });
    expect(resumed.formVersion).toBe(1);
    expect(resumed.educationRequirement).toBe("unknown_manual_review");
    await approvedOwner.checkout.createCheckout({
      invoiceId: approvedOwner.invoice.id,
    });
    approvedOwner.local.waiting();
    await approvedOwner.checkout.reconcile(approvedOwner.invoice.id);
    await approvedOwner.checkout.reconcile(approvedOwner.invoice.id);
    expect(
      (
        await db.db.execute(
          sql`select invoice_id from expert_sales_paid_locks where user_id=${approvedOwner.userId}::uuid`,
        )
      ).rows[0]?.invoice_id,
    ).toBe(approvedOwner.invoice.id);
    await expect(
      paid.form.mutate({
        ...command(paid.scope),
        action: "reapply",
        expectedRevision: 1,
      }),
    ).rejects.toThrow();
  } finally {
    await approvedOwner.local.stop();
    await paid.local.stop();
  }
}, 30000);
