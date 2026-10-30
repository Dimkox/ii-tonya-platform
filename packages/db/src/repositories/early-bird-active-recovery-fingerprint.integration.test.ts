import { createHash, randomUUID } from "node:crypto";
import { PostgresEarlyBirdRecoveryFingerprintRepository } from "./early-bird-recovery-fingerprint-repository.js";
import { afterAll, beforeAll, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { seedEarlyBirdDraftRequest } from "../testkit/early-bird-draft-request.js";
import { calculateSeparatedSalesTerms } from "@ii-tonya/domain";
import { bridgeEarlyBirdForm } from "./early-bird-form-bridge.js";
import { PostgresResidentReviewRepository } from "./resident-review-repository.js";
import { PostgresEarlyBirdIntentTransitions } from "./early-bird-intent-transitions.js";
import {
  startExpertReferralTestDatabase,
  type ExpertReferralTestDatabase,
} from "../testkit/expert-referral.js";
let db: ExpertReferralTestDatabase;
beforeAll(async () => {
  db = await startExpertReferralTestDatabase();
  await db.db.execute(
    sql`create or replace function early_bird_current_time() returns timestamptz language sql volatile as $$ select '2026-11-02T00:00:00+03:00'::timestamptz $$`,
  );
}, 120_000);
afterAll(async () => {
  await db?.stop();
}, 120_000);
it("derives a bounded recovery fingerprint only while the subject is active", async () => {
  const { seedClientConsent } = await import("../testkit/client-consent.js");
  const user = await db.createUser();
  await seedClientConsent(db.db, user, "client_messaging");
  await db.db.execute(
    sql`insert into channel_identities(user_id,provider,external_id,bot_key,external_chat_id) values(${user}::uuid,'telegram','123456','fixture-bot','123456')`,
  );
  await db.db.execute(
    sql`insert into expert_offer_profiles(user_id,revision,city_code,million_city,service_format,ticket_minor,participant_kind,idempotency_key) values(${user}::uuid,1,'fixture',false,'offline',300000,'expert','fixture-profile')`,
  );
  const tariff = await db.createResidencyTariff({
    tariffKey: "PRO",
    displayName: "PRO",
    priceMinor: 1000000,
    durationSeconds: 2592000,
  });
  const base = randomUUID(),
    positive = randomUUID(),
    choice = randomUUID();
  await db.db.execute(
    sql`insert into expert_sales_bases(id,user_id,tariff_version_id,profile_revision,base_tariff_amount,participant_kind,bot_id,bot_key,chat_id,consent_version) select ${base}::uuid,${user}::uuid,t.id,1,greatest(500000,t.price_minor),'expert','1','fixture-bot','123456','client-messaging-v1' from expert_residency_tariff_versions t where t.id=${tariff}::uuid`,
  );
  await db.db.execute(
    sql`insert into expert_sales_choices(id,base_id,user_id,revision,action,request_key,request_digest) values(${positive}::uuid,${base}::uuid,${user}::uuid,1,'positive','positive-1',${"a".repeat(64)})`,
  );
  const config = await db.db.transaction(async (tx) => {
    await tx.execute(
      sql`update early_bird_launch_configs set active=false where active`,
    );
    return (
      await tx.execute<{ id: string }>(
        sql`insert into early_bird_launch_configs(phase,enrollment_start_at,client_start_at,promo_deadline_days,final_call_trigger_at) values('WAVE_1_EARLY_BIRD','2026-11-01 00:00:00+03','2027-01-11 00:00:00+03',10,'2026-12-28 10:00:00+03') returning id`,
      )
    ).rows[0]!.id;
  });
  await db.db.execute(
    sql`insert into early_bird_positive_price_snapshots(positive_choice_id,user_id,base_id,grant_id) values(${positive}::uuid,${user}::uuid,${base}::uuid,null)`,
  );
  await db.db.execute(
    sql`insert into early_bird_choices(id,user_id,base_id,positive_choice_id,revision,choice,request_key,request_digest) values(${choice}::uuid,${user}::uuid,${base}::uuid,${positive}::uuid,1,'now','wave-1',${"b".repeat(64)})`,
  );
  const form = (
    await db.db.execute<{ id: string }>(
      sql`insert into residents_applications(user_id,bot_id,bot_key,channel_identity_id,telegram_user_id,chat_id) select ${user}::uuid,'1','fixture-bot',id,'123456','123456' from channel_identities where user_id=${user}::uuid returning id`,
    )
  ).rows[0]!.id;
  await db.db.execute(
    sql`insert into early_bird_form_enrollments(form_id,user_id,choice_id) values(${form}::uuid,${user}::uuid,${choice}::uuid)`,
  );
  const draft = {
    roles: ["EXPERT"],
    primaryRole: "EXPERT",
    category: "BASIC",
    tax: "SELF_EMPLOYED",
    city: "Казань",
    socialLinks: ["https://example.com"],
    motivation: "Работа",
    specialization: "Психология",
    averageCheckMinor: "300000",
    methods: "Практика",
    experienceYears: 5,
    cases: "Пример",
  };
  await db.db.execute(
    sql`update residents_applications set draft=${JSON.stringify(draft)}::jsonb,submitted_draft=${JSON.stringify(draft)}::jsonb,submitted_at=clock_timestamp(),status='UNDER_REVIEW',progress='AUTO_CHECK',revision=revision+1 where id=${form}::uuid`,
  );
  const application = await db.db.transaction((tx) =>
    bridgeEarlyBirdForm(tx, user, form, 1),
  );
  expect(application).toBeTruthy();
  const b = (
    await db.db.execute<{ amount: string; first: string }>(
      sql`select base_tariff_amount::text amount,base_offer_shown_at::text first from expert_sales_bases where id=${base}::uuid`,
    )
  ).rows[0]!;
  const monthly = calculateSeparatedSalesTerms({
    baseMonthlyMinor: BigInt(b.amount),
    participantKind: "expert",
    firstOfferAtMs: Date.parse(b.first),
    quotedAtMs: Date.parse("2026-11-02T00:00:00+03:00"),
    promotion: true,
    termMonths: 1,
  }).monthlyPriceMinor;
  const op = randomUUID(),
    invoice = randomUUID(),
    idem = randomUUID();
  const insert = (amount: bigint) =>
    db.db.execute(
      sql`insert into early_bird_composite_intents(id,invoice_id,user_id,base_id,choice_id,grant_id,config_id,pricing_policy,idempotency_key,onboarding_minor,subscription_minor,total_minor,base_offer_shown_at,expires_at,launch_at,request_digest) select ${op}::uuid,${invoice}::uuid,b.user_id,b.id,${choice}::uuid,null,${config}::uuid,'wave1_standard_v1',${idem}::uuid,300000,${amount.toString()}::bigint,${(amount + 300000n).toString()}::bigint,b.base_offer_shown_at,b.base_offer_shown_at+interval '240 hours','2027-01-10T21:00:00Z',${`sha256:${"c".repeat(64)}`} from expert_sales_bases b where b.id=${base}::uuid`,
    );
  await expect(insert(monthly)).rejects.toThrow();
  const manager = await db.createUser(),
    session = `test-review-${randomUUID()}`;
  await db.db.execute(
    sql`insert into admin_sessions(session_id_hash,admin_id,mfa_verified_at,expires_at) values(${session},${manager}::uuid,clock_timestamp(),clock_timestamp()+interval '1 hour')`,
  );
  await db.db.execute(
    sql`insert into admin_role_assignments(admin_id,role) values(${manager}::uuid,'support')`,
  );
  const review = new PostgresResidentReviewRepository(db.db, {
    providerMode: "test",
    messagingConsentPolicyVersion: "client-messaging-v1",
    earlyBirdReview: true,
  });
  const preview = await review.preview(session, {
    applicationId: application!,
    key: "APPROVED_BASIC",
    expectedRevision: 1,
    expectedGeneration: 1,
  });
  const confirmed = await review.confirm(
    session,
    application!,
    preview.previewId,
    preview.hash,
  );
  expect(confirmed.action).toBe("APPROVED_BASIC");
  await insert(monthly);
  await seedEarlyBirdDraftRequest(db.db, {
    intentId: op,
    userId: user,
    idempotencyKey: idem,
    digest: `sha256:${"c".repeat(64)}`,
  });
  expect(
    await new PostgresEarlyBirdIntentTransitions(db.db).markUnknown({
      userId: user,
      intentId: op,
    }),
  ).toBe(true);
  const repo = new PostgresEarlyBirdRecoveryFingerprintRepository(db.db);
  const fingerprint = await repo.read(op);
  expect(fingerprint).toMatchObject({
    operationId: op,
    invoiceId: invoice,
    userIdSha256: createHash("sha256").update(user).digest("hex"),
    pricingPolicy: "wave1_standard_v1",
    priceKind: "discounted",
    totalMinor: (monthly + 300000n).toString(),
    mode: "live",
  });
  expect(
    Date.parse(fingerprint!.createdBefore) -
      Date.parse(fingerprint!.createdFrom),
  ).toBeLessThanOrEqual(86400000);
  await db.db.execute(
    sql`update users set active=false where id=${user}::uuid`,
  );
  expect(await repo.read(op)).toBeNull();
}, 120_000);
