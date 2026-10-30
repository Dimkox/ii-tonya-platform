import { applyEarlyBirdDraftIfNeeded } from "../testkit/early-bird-draft-helper.js";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { YooKassaEarlyBirdCandidateVerifier } from "@ii-tonya/integrations";
import { PostgresEarlyBirdCandidateIntentReader } from "./early-bird-candidate-intent-reader.js";
import { PostgresEarlyBirdVerifiedBindingRepository } from "./early-bird-verified-binding-repository.js";
import { PostgresEarlyBirdIntentTransitions } from "./early-bird-intent-transitions.js";
import { seedEarlyBirdDraftRequest } from "../testkit/early-bird-draft-request.js";
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
  await applyEarlyBirdDraftIfNeeded(
    db.db,
    "docs/superpowers/implementation-artifacts/drafts/0082_early_bird_settlement.sql",
  );
}, 120_000);
afterAll(async () => {
  await db?.stop();
}, 120_000);
it("marks an intent terminal only after verified success or refund", async () => {
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
    sql`insert into early_bird_choices(user_id,base_id,positive_choice_id,revision,choice,request_key,request_digest) values(${user}::uuid,${base}::uuid,${positive}::uuid,1,'now','wave-1',${"b".repeat(64)})`,
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
  const operation = randomUUID(),
    invoice = randomUUID(),
    idem = randomUUID();
  const insertIntent = () =>
    db.db.execute(
      sql`insert into early_bird_composite_intents(id,invoice_id,user_id,base_id,choice_id,grant_id,config_id,pricing_policy,idempotency_key,onboarding_minor,subscription_minor,total_minor,base_offer_shown_at,expires_at,launch_at,request_digest) select ${operation}::uuid,${invoice}::uuid,b.user_id,b.id,c.id,${grant}::uuid,cfg.id,'owner_test_10_20_v1',${idem}::uuid,1000,2000,3000,b.base_offer_shown_at,b.base_offer_shown_at+interval '240 hours',cfg.client_start_at,${`sha256:${"c".repeat(64)}`} from expert_sales_bases b join early_bird_choices c on c.base_id=b.id and c.user_id=b.user_id join early_bird_launch_configs cfg on cfg.active where b.id=${base}::uuid`,
    );
  await expect(insertIntent()).rejects.toThrow();
  const preview = await review.preview(session, {
    applicationId: result!,
    key: "APPROVED_BASIC",
    expectedRevision: 1,
    expectedGeneration: 1,
  });
  const confirmed = await review.confirm(
    session,
    result!,
    preview.previewId,
    preview.hash,
  );
  expect(confirmed.action).toBe("APPROVED_BASIC");
  await expect(insertIntent()).resolves.toBeDefined();
  await seedEarlyBirdDraftRequest(db.db, {
    intentId: operation,
    userId: user,
    idempotencyKey: idem,
    digest: `sha256:${"c".repeat(64)}`,
  });
  expect(
    await new PostgresEarlyBirdIntentTransitions(db.db).markUnknown({
      userId: user,
      intentId: operation,
    }),
  ).toBe(true);
  await db.db.execute(
    sql`create role ii_tonya_wave_verifier nologin noinherit nosuperuser nocreatedb nocreaterole nobypassrls`,
  );
  await db.db.execute(
    sql`create role ii_tonya_wave_intent_reader nologin noinherit nosuperuser nocreatedb nocreaterole nobypassrls`,
  );
  await db.db.execute(
    sql`create role wave_writer_10_20 login password 'synthetic-writer' noinherit nosuperuser nocreatedb nocreaterole nobypassrls`,
  );
  await db.db.execute(
    sql`create role wave_reader_10_20 login password 'synthetic-reader' noinherit nosuperuser nocreatedb nocreaterole nobypassrls`,
  );
  await db.db.execute(sql`grant ii_tonya_wave_verifier to wave_writer_10_20`);
  await db.db.execute(
    sql`grant ii_tonya_wave_intent_reader to wave_reader_10_20`,
  );
  await db.db.execute(
    sql`grant usage on schema early_bird_private to wave_writer_10_20, wave_reader_10_20`,
  );
  await db.db.execute(
    sql`grant execute on function early_bird_private.bind_verified(uuid,uuid,text,text,jsonb) to wave_writer_10_20`,
  );
  await db.db.execute(
    sql`grant execute on function early_bird_private.find_candidate_intent(uuid) to wave_reader_10_20`,
  );
  const url = new URL(db.db.$client.options.connectionString!);
  url.username = "wave_reader_10_20";
  url.password = "synthetic-reader";
  const readerPool = new Pool({ connectionString: url.toString() });
  url.username = "wave_writer_10_20";
  url.password = "synthetic-writer";
  const writerPool = new Pool({ connectionString: url.toString() });
  try {
    const reader = new PostgresEarlyBirdCandidateIntentReader(
      drizzle(readerPool) as never,
      "wave_reader_10_20",
    );
    const verifier = new YooKassaEarlyBirdCandidateVerifier(
      {
        getPayment: async () => ({
          id: "payment_30",
          status: "pending",
          paid: false,
          test: false,
          amount: { value: "30.00", currency: "RUB" },
          createdAt: new Date().toISOString(),
          metadata: {
            order_id: invoice,
            user_id: user,
            operation_id: operation,
            purpose: "combined_early_bird",
            pricing_policy: "owner_test_10_20_v1",
            price_kind: "fixed_test",
            pricing_grant_id: grant,
          },
        }),
      } as never,
      reader,
    );
    const proof = await verifier.verify(operation, "payment_30");
    expect(proof).toMatchObject({
      onboardingMinor: "1000",
      subscriptionMinor: "2000",
      totalMinor: "3000",
    });
    await new PostgresEarlyBirdVerifiedBindingRepository(
      drizzle(writerPool) as never,
      verifier,
      "wave_writer_10_20",
    ).bind(proof);
    expect(
      (
        await db.db.execute(
          sql`select provider_object_id from early_bird_verified_bindings where intent_id=${operation}::uuid`,
        )
      ).rows,
    ).toEqual([{ provider_object_id: "payment_30" }]);
  } finally {
    await readerPool.end();
    await writerPool.end();
  }
  await expect(
    db.db.execute(
      sql`update early_bird_composite_intents set status='settled' where id=${operation}::uuid`,
    ),
  ).rejects.toThrow();
  await db.db.execute(
    sql`select public.early_bird_record_success(${operation}::uuid,${user}::uuid,'payment_30',${`sha256:${"e".repeat(64)}`},clock_timestamp())`,
  );
  expect(
    (
      await db.db.execute<{ status: string }>(
        sql`select status from early_bird_composite_intents where id=${operation}::uuid`,
      )
    ).rows[0]?.status,
  ).toBe("settled");
  await db.db.execute(
    sql`select public.early_bird_record_full_refund(${operation}::uuid,${user}::uuid,'refund_30',${`sha256:${"f".repeat(64)}`},3000,clock_timestamp())`,
  );
  expect(
    (
      await db.db.execute<{ status: string }>(
        sql`select status from early_bird_composite_intents where id=${operation}::uuid`,
      )
    ).rows[0]?.status,
  ).toBe("refunded");
}, 120_000);
