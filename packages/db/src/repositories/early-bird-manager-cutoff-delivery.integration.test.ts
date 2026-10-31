import { createHash, randomUUID } from "node:crypto";
import { ownerPricingApproval } from "../testkit/owner-pricing-approval.js";
import { bridgeEarlyBirdForm } from "./early-bird-form-bridge.js";
import {
  PostgresResidentReviewRepository,
  type ResidentReviewTransport,
} from "./resident-review-repository.js";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { sql } from "drizzle-orm";
import {
  startExpertReferralTestDatabase,
  type ExpertReferralTestDatabase,
} from "../testkit/expert-referral.js";

let db: ExpertReferralTestDatabase;
beforeAll(async () => {
  db = await startExpertReferralTestDatabase();
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
}, 120_000);
afterAll(async () => {
  await db?.stop();
}, 120_000);
it("delivers only an audited post-launch replacement after cutoff, preserving the prelaunch original", async () => {
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
  const approval = await ownerPricingApproval(db, {
    action: "grant",
    target: user,
    adminId: admin.adminId,
    sessionIdHash: admin.sessionIdHash,
  });
  const grant = randomUUID();
  await db.db.execute(
    sql`insert into owner_test_pricing_grants(id,user_id,granted_by,grant_session_hash,grant_approval_id) values(${grant}::uuid,${user}::uuid,${admin.adminId}::uuid,${admin.sessionIdHash},${approval}::uuid)`,
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
  const send = vi.fn<ResidentReviewTransport["send"]>(async () => ({
    botId: "1",
    chatId: "123456",
    messageId: "1",
  }));
  const review = new PostgresResidentReviewRepository(db.db, {
    providerMode: "test",
    messagingConsentPolicyVersion: "client-messaging-v1",
    earlyBirdReview: true,
    notifier: { send },
  });
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
  const original = (
    await db.db.execute<{ text: string; hash: string }>(
      sql`select final_text as text,final_hash as hash from resident_review_messages where event_id=${confirmed.eventId}::uuid`,
    )
  ).rows[0]!;
  expect(original.text).toContain("Старт для клиентов — 11 января 2027 года.");
  expect(original.hash).toBe(preview.hash);
  await db.db.execute(
    sql`create or replace function early_bird_current_time() returns timestamptz language sql volatile as $$ select '2027-01-11T00:00:00+03:00'::timestamptz $$`,
  );
  expect(
    await review.deliverMaterials(confirmed.eventId, {
      signal: new AbortController().signal,
    }),
  ).toEqual({ kind: "delivered" });
  const replacement =
    "Здравствуйте!\n\nАнкета одобрена. Категория: Базовая. Платформа открыта для клиентов. Актуальные условия участия доступны в /my_tariff.";
  expect(send).toHaveBeenCalledOnce();
  expect(send).toHaveBeenCalledWith({
    botId: "1",
    botKey: "fixture-bot",
    chatId: "123456",
    text: replacement,
    signal: expect.any(AbortSignal),
  });
  expect(send.mock.calls[0]![0].text).not.toContain("Старт для клиентов");
  expect(
    (
      await db.db.execute(
        sql`select user_id as "userId",original_hash as "originalHash",replacement_text as text,replacement_hash as hash from early_bird_message_replacements where event_id=${confirmed.eventId}::uuid`,
      )
    ).rows,
  ).toEqual([
    {
      userId: user,
      originalHash: original.hash,
      text: replacement,
      hash: createHash("sha256").update(replacement).digest("hex"),
    },
  ]);
  expect(
    (
      await db.db.execute(
        sql`select final_text as text,final_hash as hash,status,receipt,attempts from resident_review_messages where event_id=${confirmed.eventId}::uuid`,
      )
    ).rows,
  ).toEqual([{ ...original, status: "delivered", receipt: "1", attempts: 1 }]);
}, 120_000);
