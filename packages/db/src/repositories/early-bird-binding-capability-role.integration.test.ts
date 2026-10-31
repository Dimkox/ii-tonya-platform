import { applyEarlyBirdDraftIfNeeded } from "../testkit/early-bird-draft-helper.js";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { YooKassaEarlyBirdCandidateVerifier } from "@ii-tonya/integrations";
import { PostgresEarlyBirdVerifiedBindingRepository } from "./early-bird-verified-binding-repository.js";
import { seedEarlyBirdDraftRequest } from "../testkit/early-bird-draft-request.js";
import { PostgresEarlyBirdIntentTransitions } from "./early-bird-intent-transitions.js";
import { bridgeEarlyBirdForm } from "./early-bird-form-bridge.js";
import { PostgresResidentReviewRepository } from "./resident-review-repository.js";
import { afterAll, beforeAll, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import {
  startExpertReferralTestDatabase,
  type ExpertReferralTestDatabase,
} from "../testkit/expert-referral.js";
const SYNTHETIC_FIXTURE_VALUE_1 = "synthetic-only-password";

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
  await db.db.execute(
    sql`create role ii_tonya_wave_verifier nologin noinherit nosuperuser nocreatedb nocreaterole nobypassrls`,
  );
  await applyEarlyBirdDraftIfNeeded(
    db.db,
    "docs/superpowers/implementation-artifacts/drafts/0081_early_bird_composite.sql",
  );
}, 120_000);
afterAll(async () => {
  await db?.stop();
}, 120_000);
it("rejects an unsafe verifier capability role", async () => {
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
  const positive = randomUUID();
  await db.db.execute(
    sql`insert into expert_sales_choices(id,base_id,user_id,revision,action,request_key,request_digest) values (${positive}::uuid,${base}::uuid,${user}::uuid,1,'positive','positive-1',${"a".repeat(64)})`,
  );
  await db.db.execute(
    sql`insert into early_bird_positive_price_snapshots(positive_choice_id,user_id,base_id,grant_id) values(${positive}::uuid,${user}::uuid,${base}::uuid,null)`,
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
      sql`insert into early_bird_composite_intents(id,invoice_id,user_id,base_id,choice_id,config_id,pricing_policy,idempotency_key,onboarding_minor,subscription_minor,total_minor,base_offer_shown_at,expires_at,launch_at,request_digest) select ${operation}::uuid,${invoice}::uuid,b.user_id,b.id,c.id,cfg.id,'wave1_standard_v1',${idem}::uuid,300000,p.amount,p.amount+300000,b.base_offer_shown_at,b.base_offer_shown_at+interval '240 hours',cfg.client_start_at,${`sha256:${"c".repeat(64)}`} from expert_sales_bases b join early_bird_choices c on c.base_id=b.id and c.user_id=b.user_id join early_bird_launch_configs cfg on cfg.active cross join lateral (select greatest(500000,(b.base_tariff_amount*(10000-case when early_bird_current_time()<b.base_offer_shown_at+interval '96 hours' then 4000 when early_bird_current_time()<b.base_offer_shown_at+interval '168 hours' then 3000 when early_bird_current_time()<b.base_offer_shown_at+interval '240 hours' then 2000 else 0 end)+5000)/10000) amount) p where b.id=${base}::uuid`,
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
  const snapshot = (
    await db.db.execute<{ data: Record<string, unknown> }>(
      sql`select jsonb_build_object('invoiceId',i.invoice_id::text,'userId',i.user_id::text,'operationId',i.id::text,'grantId',i.grant_id::text,'pricingPolicy',i.pricing_policy,'priceKind',i.price_kind,'mode',i.provider_mode,'onboardingMinor',i.onboarding_minor::text,'subscriptionMinor',i.subscription_minor::text,'totalMinor',i.total_minor::text,'baseOfferShownAt',to_char(i.base_offer_shown_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'expiresAt',to_char(i.expires_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'launchAt',to_char(i.launch_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'baseMonthlyMinor',i.base_monthly_minor::text,'ruleVersion',i.rule_version,'participantKind',i.participant_kind,'promotionEligible',i.promotion_eligible,'quotedAt',to_char(i.quoted_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) as data from early_bird_composite_intents i where i.id=${operation}::uuid`,
    )
  ).rows[0]!.data;
  expect(
    (
      await db.db.execute<{ allowed: boolean }>(
        sql`select has_function_privilege('public','early_bird_private.bind_verified(uuid,uuid,text,text,jsonb)','execute') as allowed`,
      )
    ).rows[0]?.allowed,
  ).toBe(false);
  expect(
    (
      await db.db.execute<{ allowed: boolean }>(
        sql`select has_table_privilege('ii_tonya_wave_verifier','early_bird_verified_bindings','insert') as allowed`,
      )
    ).rows[0]?.allowed,
  ).toBe(false);
  await db.db.execute(
    sql`revoke execute on all functions in schema public from public`,
  );
  await db.db.execute(
    sql`grant usage on schema early_bird_private to ii_tonya_wave_verifier`,
  );
  await db.db.execute(
    sql`grant execute on function early_bird_private.bind_verified(uuid,uuid,text,text,jsonb) to ii_tonya_wave_verifier`,
  );
  const standard = Object.fromEntries(
    Object.entries(snapshot).filter(([key]) => key !== "grantId"),
  );
  const minor = BigInt(snapshot.totalMinor as string),
    amount = `${minor / 100n}.${String(minor % 100n).padStart(2, "0")}`;
  // Synthetic provider creation follows the persisted quote's logical clock.
  const providerCreatedAt = snapshot.quotedAt as string;
  expect(Date.parse(providerCreatedAt)).toBeGreaterThanOrEqual(
    Date.parse(snapshot.baseOfferShownAt as string),
  );
  expect(Date.parse(providerCreatedAt)).toBeLessThan(
    Date.parse(snapshot.expiresAt as string),
  );
  const verifier = new YooKassaEarlyBirdCandidateVerifier(
    {
      getPayment: async () => ({
        id: "payment_123",
        status: "pending",
        paid: false,
        test: false,
        amount: { value: amount, currency: "RUB" },
        createdAt: providerCreatedAt,
        metadata: {
          order_id: invoice,
          user_id: user,
          operation_id: operation,
          purpose: "combined_early_bird",
          price_kind: String(snapshot.priceKind),
          pricing_policy: String(snapshot.pricingPolicy),
        },
      }),
    } as never,
    { findIntent: async () => standard as never },
  );
  const proof = await verifier.verify(operation, "payment_123");
  const ownerWriter = new PostgresEarlyBirdVerifiedBindingRepository(
    db.db,
    verifier,
    "wave_binding_test_login",
  );
  await expect(ownerWriter.bind(proof)).rejects.toThrow(
    "early_bird_binding_principal_unsafe",
  );
  await db.db.execute(
    sql`create role wave_binding_test_login login password 'synthetic-only-password' noinherit nosuperuser nocreatedb nocreaterole nobypassrls`,
  );
  await db.db.execute(
    sql`grant ii_tonya_wave_verifier to wave_binding_test_login`,
  );
  await db.db.execute(
    sql`grant usage on schema early_bird_private to wave_binding_test_login`,
  );
  await db.db.execute(
    sql`grant execute on function early_bird_private.bind_verified(uuid,uuid,text,text,jsonb) to wave_binding_test_login`,
  );
  await db.db.execute(sql`alter role ii_tonya_wave_verifier login`);
  const testConnection = new URL(db.db.$client.options.connectionString!);
  testConnection.username = "wave_binding_test_login";
  testConnection.password = SYNTHETIC_FIXTURE_VALUE_1;
  const pool = new Pool({ connectionString: testConnection.toString() });
  try {
    const restricted = drizzle(pool) as never;
    const writer = new PostgresEarlyBirdVerifiedBindingRepository(
      restricted,
      verifier,
      "wave_binding_test_login",
    );
    await expect(writer.bind({ ...proof })).rejects.toThrow(
      "early_bird_candidate_proof_required",
    );
    await expect(writer.bind(proof)).rejects.toThrow(
      "early_bird_binding_principal_unsafe",
    );
  } finally {
    await pool.end();
  }
  expect(
    (
      await db.db.execute(
        sql`select provider_object_id from early_bird_verified_bindings where intent_id=${operation}::uuid`,
      )
    ).rows,
  ).toHaveLength(0);
}, 120_000);
