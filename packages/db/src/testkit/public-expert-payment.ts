import { createHash, randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { createPayerReceiptVault } from "@ii-tonya/integrations";
import {
  startExpertReferralTestDatabase,
  type ExpertReferralTestDatabase,
} from "./expert-referral.js";
import { PostgresPayerReceiptContactRepository } from "../repositories/payer-receipt-contact-repository.js";
import { seedClientConsent } from "./client-consent.js";
import { saveExpertOfferProfile } from "../repositories/expert-offer-v2.js";
import { PostgresExpertSeparatedSalesRepository } from "../repositories/expert-separated-sales-repository.js";
import { PostgresResidentVerificationRepository } from "../repositories/resident-verification-repository.js";
import { PostgresExpertVerificationRepository } from "../repositories/expert-verification-repository.js";
export const publicTestNow = "2027-01-11T12:00:00.000Z";
export const publicTestVault = createPayerReceiptVault({
  activeKeyId: "fixture",
  keys: new Map([["fixture", new Uint8Array(32).fill(21)]]),
});
export const publicTestDigest = (s: string) =>
  `sha256:${createHash("sha256").update(s).digest("hex")}`;
export async function startPublicExpertTestDatabase() {
  const db = await startExpertReferralTestDatabase(undefined, {
    forceDisposableCluster: true,
  });
  await db.enableExpertReferralCommands();
  const tariff = await db.createResidencyTariff({
    tariffKey: "PRO",
    displayName: "PRO",
    priceMinor: 999000,
    durationSeconds: 2592000,
  });
  const staff = await db.createUser(),
    session = publicTestDigest(randomUUID());
  await db.db.execute(
    sql`insert into admin_sessions(session_id_hash,admin_id,mfa_verified_at,expires_at) values(${session},${staff}::uuid,clock_timestamp(),clock_timestamp()+interval '1 hour')`,
  );
  await db.db.execute(
    sql`insert into admin_role_assignments(admin_id,role) values(${staff}::uuid,'support')`,
  );
  await db.db.execute(
    sql`create or replace function early_bird_current_time() returns timestamptz language sql volatile as $$select '2027-01-11T12:00:00.000Z'::timestamptz$$`,
  );
  return { db, tariff, session };
}
/** New adapter fixture creates real manager-approved sales/form/invoice authority and real sealed contact. */
export async function createPublicOnboardingFixture(
  context: Awaited<ReturnType<typeof startPublicExpertTestDatabase>>,
) {
  const { db, tariff, session } = context;
  const userId = await db.createUser(),
    chat = String(Math.floor(Math.random() * 900000000) + 100000000);
  const policy = {
    botId: "717171",
    botKey: "public-adapter",
    messagingConsentPolicyVersion: "client-messaging-v1",
  };
  const scope = { ...policy, telegramUserId: chat, chatId: chat };
  const event = () => {
    const requestKey = randomUUID();
    return {
      ...scope,
      requestKey,
      requestDigest: publicTestDigest(requestKey).slice(7),
    };
  };
  await db.db.execute(
    sql`insert into channel_identities(user_id,provider,external_id,bot_key,external_chat_id,status) values(${userId}::uuid,'telegram',${chat},${policy.botKey},${chat},'active')`,
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
  await db.db.execute(
    sql`insert into residents_applications(user_id,bot_id,bot_key,channel_identity_id,telegram_user_id,chat_id,form_version,policy_version,education_requirement) select ${userId}::uuid,${policy.botId},${policy.botKey},id,${chat},${chat},1,'resident_education_unknown_v1','unknown_manual_review' from channel_identities where user_id=${userId}::uuid`,
  );
  const sales = new PostgresExpertSeparatedSalesRepository(db.db, policy),
    forms = new PostgresResidentVerificationRepository(db.db, policy);
  const base = (await sales.transition({
    ...event(),
    tariffVersionId: tariff,
  }))!;
  let selection = await sales.transition({
    ...event(),
    baseId: base.id,
    revision: 0,
    action: "positive",
  });
  selection = await sales.transition({
    ...event(),
    baseId: base.id,
    revision: selection!.revision,
    action: "base",
  });
  await sales.transition({
    ...event(),
    baseId: base.id,
    revision: selection!.revision,
    action: "month",
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
      socialLinks: ["https://example.invalid"],
      motivation: "Практика",
      specialization: "Психология",
      averageCheckMinor: "300000",
    },
  });
  await forms.mutate({
    ...event(),
    action: "submit",
    expectedRevision: form.revision,
  });
  const bridge = (
    await db.db.$client.query(
      "select application_id,quote_id from expert_sales_form_bridges where user_id=$1",
      [userId],
    )
  ).rows[0]!;
  const verification = new PostgresExpertVerificationRepository(db.db, {
    providerMode: "test",
    messagingConsentPolicyVersion: policy.messagingConsentPolicyVersion,
  });
  const decision = await verification.decide({
    sessionHash: session,
    applicationId: bridge.application_id,
    decision: "approved",
    reasonCode: "identity_verified",
    idempotencyKey: randomUUID(),
  });
  const invoice = (await verification.invoiceForManager(
    session,
    decision.invoiceId!,
  ))!;
  await new PostgresPayerReceiptContactRepository(
    db.db,
    publicTestVault,
    30,
  ).capture({
    userId,
    quoteId: bridge.quote_id,
    email: "private-adapter@example.invalid",
    idempotencyKey: randomUUID(),
  });
  const contactId = (
    await db.db.$client.query(
      "select id from payer_receipt_contacts where user_id=$1",
      [userId],
    )
  ).rows[0]!.id as string;
  const binding = {
    id: contactId,
    quoteId: bridge.quote_id as string,
    userId,
    kind: "email" as const,
    basis: "fiscal_payment_dec_plt_004_v1" as const,
    capturedAt: "2027-01-11T11:00:00.000Z",
    expiresAt: "2027-01-11T14:00:00.000Z",
  };
  const envelope = publicTestVault.seal(
    "private-adapter@example.invalid",
    binding,
  );
  // Time seam applies only to fixture clocks after real manager admission. Contact itself uses actual vault AAD.
  await db.db.transaction(async (tx) => {
    await tx.execute(
      sql`alter table expert_sales_fee_attempts disable trigger expert_sales_attempt_immutable`,
    );
    await tx.execute(
      sql`update expert_sales_fee_attempts set created_at='2027-01-11T11:00:00Z',expires_at='2027-01-11T14:00:00Z' where invoice_id=${invoice.id}::uuid`,
    );
    await tx.execute(
      sql`alter table expert_sales_fee_attempts enable trigger expert_sales_attempt_immutable`,
    );
    await tx.execute(
      sql`alter table payer_receipt_contacts disable trigger payer_receipt_contact_guard`,
    );
    await tx.execute(
      sql`update payer_receipt_contacts set captured_at=${binding.capturedAt}::timestamptz,expires_at=${binding.expiresAt}::timestamptz,ciphertext=${envelope.ciphertext} where id=${contactId}::uuid`,
    );
    await tx.execute(
      sql`alter table payer_receipt_contacts enable trigger payer_receipt_contact_guard`,
    );
  });
  return {
    userId,
    invoiceId: invoice.id,
    operationId: invoice.operationId,
    contactId,
    applicationId: bridge.application_id as string,
    quoteId: binding.quoteId,
  };
}
export async function publicFixtureVersion(db: ExpertReferralTestDatabase) {
  return (await db.db.$client.query("show server_version_num")).rows[0]!
    .server_version_num as string;
}

export async function publicTestPrincipal(
  context: Awaited<ReturnType<typeof startPublicExpertTestDatabase>>,
  label: "onboarding" | "main" | "refund" | "binder" | "writer" | "gateway",
) {
  const { createDb } = await import("../client.js");
  const role = `task3_${label}_${randomUUID().replaceAll("-", "")}`;
  const functions =
    label === "gateway"
      ? ["public.public_expert_gateway_claim(uuid,uuid,uuid,uuid,text,text)"]
      : label === "binder"
        ? [
            "early_bird_private.public_payment_candidate(uuid)",
            "early_bird_private.public_payment_bound(uuid)",
            "early_bird_private.public_payment_bind(uuid,text,jsonb)",
          ]
        : label === "writer"
          ? [
              "early_bird_private.public_payment_observe(uuid,text,jsonb)",
              "early_bird_private.public_payment_resolve(uuid,uuid)",
              "early_bird_private.public_payment_expire(uuid,uuid)",
              "early_bird_private.public_payment_complete(uuid,uuid)",
            ]
          : [
              `early_bird_private.public_${label}_source(uuid,uuid)`,
              `early_bird_private.public_${label}_prepare(uuid,uuid,uuid,jsonb)`,
              `early_bird_private.public_${label}_snapshot(uuid,uuid)`,
              `early_bird_private.public_${label}_admit(uuid,uuid,text)`,
              ...(label === "onboarding"
                ? [
                    "early_bird_private.public_onboarding_invoice(uuid)",
                    "early_bird_private.public_onboarding_pending(integer,uuid)",
                  ]
                : []),
            ];
  const q = context.db.db.$client;
  const password = ["synthetic", "task3", "only"].join("-");
  await q.query(`create role ${role} login password '${password}'`);
  await q.query(`grant usage on schema public,early_bird_private to ${role}`);
  for (const f of functions)
    await q.query(`grant execute on function ${f} to ${role}`);
  const url = new URL(q.options.connectionString!);
  url.username = role;
  url.password = password;
  return createDb(url.toString());
}

/** Real AEAD fixture for the replay port. AAD mutations cannot open the sealed fiscal body. */
export async function createPublicTestReplay() {
  const { createCipheriv, createDecipheriv, randomBytes } =
    await import("node:crypto");
  const key = randomBytes(32);
  const protector: import("@ii-tonya/integrations").YooKassaReplayProtector = {
    async protect(input) {
      const iv = randomBytes(12),
        cipher = createCipheriv("aes-256-gcm", key, iv);
      cipher.setAAD(Buffer.from(JSON.stringify(input.associatedData)));
      const bytes = Buffer.concat([cipher.update(input.body), cipher.final()]);
      return {
        ciphertext: Buffer.concat([iv, cipher.getAuthTag(), bytes]).toString(
          "base64url",
        ),
        keyReference: "fixture:public",
        bodyVersion: 1,
        expiresAt: "2027-01-11T13:00:00.000Z",
      };
    },
  };
  const decryptor: import("@ii-tonya/integrations").YooKassaReplayDecryptor = {
    async decrypt(input) {
      const bytes = Buffer.from(input.encryptedBody, "base64url"),
        cipher = createDecipheriv("aes-256-gcm", key, bytes.subarray(0, 12));
      cipher.setAAD(Buffer.from(JSON.stringify(input.associatedData)));
      cipher.setAuthTag(bytes.subarray(12, 28));
      return {
        body: Buffer.concat([
          cipher.update(bytes.subarray(28)),
          cipher.final(),
        ]).toString(),
        bodyVersion: 1,
      };
    },
  };
  return { protector, decryptor };
}
