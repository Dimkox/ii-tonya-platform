import { PostgresEarlyBirdPaidStatus } from "./early-bird-paid-status.js";
import { applyEarlyBirdDraftIfNeeded } from "../testkit/early-bird-draft-helper.js";
import { randomUUID } from "node:crypto";
import { ownerPricingApproval } from "../testkit/owner-pricing-approval.js";
import { bridgeEarlyBirdForm } from "./early-bird-form-bridge.js";
import { PostgresResidentReviewRepository } from "./resident-review-repository.js";
import { afterAll, beforeAll, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import {
  startExpertReferralTestDatabase,
  type ExpertReferralTestDatabase,
} from "../testkit/expert-referral.js";

let db: ExpertReferralTestDatabase;
beforeAll(async () => {
  db = await startExpertReferralTestDatabase(undefined, {
    forceDisposableCluster: true,
  });
  await db.db.transaction(async (tx) => {
    await tx.execute(
      sql`update early_bird_launch_configs set active=false where active`,
    );
    await tx.execute(
      sql`insert into early_bird_launch_configs(phase,enrollment_start_at,client_start_at,promo_deadline_days,final_call_trigger_at) values ('WAVE_1_EARLY_BIRD','2026-11-01T00:00:00+03:00','2027-01-11T00:00:00+03:00',10,'2026-12-28T10:00:00+03:00')`,
    );
  });
  // A disposable DB runs the real phase logic against a deterministic launch-period clock.
  await db.db.execute(
    sql`create or replace function early_bird_current_time() returns timestamptz language sql volatile as $$ select '2026-11-02T00:00:00+03:00'::timestamptz $$`,
  );
  await applyEarlyBirdDraftIfNeeded(
    db.db,
    "docs/superpowers/implementation-artifacts/drafts/0081_early_bird_composite.sql",
  );
}, 120_000);
afterAll(async () => {
  await db?.stop();
}, 120_000);
it("requires both deferred captures and excludes pending refunds, late payments, and withdrawn consent", async () => {
  const { seedClientConsent } = await import("../testkit/client-consent.js");
  const user = await db.createUser();
  await seedClientConsent(db.db, user, "client_messaging");
  await db.db.execute(
    sql`insert into channel_identities(user_id,provider,external_id,bot_key,external_chat_id) values (${user}::uuid,'telegram','123456','fixture-bot','123456')`,
  );
  await db.db.execute(
    sql`insert into expert_offer_profiles(user_id,revision,city_code,million_city,service_format,ticket_minor,participant_kind,idempotency_key) values (${user}::uuid,1,'fixture',false,'offline',300000,'expert','fixture-profile')`,
  );
  const tariff = await db.createResidencyTariff({
    tariffKey: "PRO",
    displayName: "PRO",
    priceMinor: 1000000,
    durationSeconds: 2592000,
  });
  const base = randomUUID();
  await db.db.execute(
    sql`insert into expert_sales_bases(id,user_id,tariff_version_id,profile_revision,base_tariff_amount,participant_kind,bot_id,bot_key,chat_id,consent_version) select ${base}::uuid,${user}::uuid,t.id,1,greatest(500000,t.price_minor),'expert','1','fixture-bot','123456','client-messaging-v1' from expert_residency_tariff_versions t where t.id=${tariff}::uuid`,
  );
  const admin = await db.createAdminAudit({
    action: "fixture",
    objectId: randomUUID(),
  });
  const grantApproval = await ownerPricingApproval(db, {
    action: "grant",
    target: user,
    adminId: admin.adminId,
    sessionIdHash: admin.sessionIdHash,
  });
  const grant = randomUUID();
  await db.db.execute(
    sql`insert into owner_test_pricing_grants(id,user_id,granted_by,grant_session_hash,grant_approval_id) values(${grant}::uuid,${user}::uuid,${admin.adminId}::uuid,${admin.sessionIdHash},${grantApproval}::uuid)`,
  );
  const positive = randomUUID();
  await db.db.execute(
    sql`insert into expert_sales_choices(id,base_id,user_id,revision,action,request_key,request_digest) values (${positive}::uuid,${base}::uuid,${user}::uuid,1,'positive','positive-1',${"a".repeat(64)})`,
  );
  await db.db.execute(
    sql`insert into early_bird_positive_price_snapshots(positive_choice_id,user_id,base_id,grant_id) values(${positive}::uuid,${user}::uuid,${base}::uuid,${grant}::uuid)`,
  );
  await db.db.execute(
    sql`insert into early_bird_choices(user_id,base_id,positive_choice_id,revision,choice,request_key,request_digest) values(${user}::uuid,${base}::uuid,${positive}::uuid,1,'later','wave-1',${"b".repeat(64)})`,
  );
  const form = (
    await db.db.execute<{ id: string }>(
      sql`insert into residents_applications(user_id,bot_id,bot_key,channel_identity_id,telegram_user_id,chat_id) select ${user}::uuid,'1','fixture-bot',id,'123456','123456' from channel_identities where user_id=${user}::uuid returning id`,
    )
  ).rows[0]!.id;
  await db.db.execute(
    sql`insert into early_bird_form_enrollments(form_id,user_id,choice_id) select ${form}::uuid,${user}::uuid,id from early_bird_choices where user_id=${user}::uuid`,
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
  const result = await db.db.transaction((tx) =>
    bridgeEarlyBirdForm(tx, user, form, 1),
  );
  expect(result).toBeTruthy();
  const manager = await db.createUser();
  const session = `test-review-${randomUUID()}`;
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
    applicationId: result!,
    key: "APPROVED_BASIC",
    expectedRevision: 1,
    expectedGeneration: 1,
  });
  await review.confirm(session, result!, preview.previewId, preview.hash);
  const choice = (
    await db.db.execute<{ id: string }>(
      sql`select id from early_bird_choices where user_id=${user}::uuid`,
    )
  ).rows[0]!.id;
  const config = (
    await db.db.execute<{ id: string }>(
      sql`select id from early_bird_launch_configs where active`,
    )
  ).rows[0]!.id;
  const account = randomUUID(),
    onboarding = randomUUID(),
    subscription = randomUUID();
  await db.db.execute(
    sql`select early_bird_deferred_prepare(${account}::uuid,${user}::uuid,${base}::uuid,${choice}::uuid,${config}::uuid)`,
  );
  const scope = {
    botId: "1",
    botKey: "fixture-bot",
    telegramUserId: "123456",
    chatId: "123456",
  };
  const paid = new PostgresEarlyBirdPaidStatus(db.db, {
    botId: "1",
    botKey: "fixture-bot",
    messagingConsentPolicyVersion: "client-messaging-v1",
  });
  expect(await paid.find(scope)).toBeNull();
  await db.db.execute(
    sql`select early_bird_deferred_invoice(${account}::uuid,${user}::uuid,${onboarding}::uuid,${randomUUID()}::uuid,'onboarding')`,
  );
  const evidence = `sha256:${"a".repeat(64)}`,
    captured = new Date();
  await db.db.execute(
    sql`select early_bird_deferred_bind_verified(${onboarding}::uuid,${user}::uuid,'onboarding_provider',1000::bigint,${evidence})`,
  );
  await db.db.execute(
    sql`select early_bird_deferred_commit_verified(${onboarding}::uuid,${user}::uuid,'onboarding_provider',1000::bigint,${evidence},${captured})`,
  );
  expect(await paid.find(scope)).toBeNull();
  await db.db.execute(
    sql`select early_bird_deferred_invoice(${account}::uuid,${user}::uuid,${subscription}::uuid,${randomUUID()}::uuid,'subscription')`,
  );
  await db.db.execute(
    sql`select early_bird_deferred_bind_verified(${subscription}::uuid,${user}::uuid,'subscription_provider',2000::bigint,${evidence})`,
  );
  await db.db.execute(
    sql`select early_bird_deferred_commit_verified(${subscription}::uuid,${user}::uuid,'subscription_provider',2000::bigint,${evidence},${captured})`,
  );
  expect(await paid.find(scope)).toMatchObject({
    id: base,
    status: "FULLY_PREPAID_NO_DISCOUNT",
    lockedMonthlyMinor: "2000",
    residentStatus: "ACTIVE_PAID_WAITING_START",
    effectiveStart: "2027-01-10T21:00:00.000Z",
  });
  await expect(
    db.db.transaction(async (tx) => {
      await tx.execute(
        sql`select early_bird_deferred_bind_refund(${subscription}::uuid,${user}::uuid,'subscription_provider','pending_refund',2000::bigint,${evidence})`,
      );
      expect(
        await new PostgresEarlyBirdPaidStatus(tx as never, {
          botId: "1",
          botKey: "fixture-bot",
          messagingConsentPolicyVersion: "client-messaging-v1",
        }).find(scope),
      ).toBeNull();
      throw new Error("rollback_fixture");
    }),
  ).rejects.toThrow("rollback_fixture");
  await expect(
    db.db.transaction(async (tx) => {
      await tx.execute(sql`set local session_replication_role=replica`);
      await tx.execute(
        sql`update early_bird_deferred_invoices set captured_at='2027-01-11T00:00:00+03:00'::timestamptz where id=${subscription}::uuid`,
      );
      expect(
        await new PostgresEarlyBirdPaidStatus(tx as never, {
          botId: "1",
          botKey: "fixture-bot",
          messagingConsentPolicyVersion: "client-messaging-v1",
        }).find(scope),
      ).toBeNull();
      throw new Error("rollback_fixture");
    }),
  ).rejects.toThrow("rollback_fixture");
  await db.db.execute(
    sql`insert into consents(user_id,consent_type,decision,policy_version,basis,created_at) values(${user}::uuid,'client_messaging','revoked','client-messaging-v1','consent',clock_timestamp())`,
  );
  expect(await paid.find(scope)).toBeNull();
}, 120_000);
