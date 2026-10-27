import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { beforeAll, afterAll, describe, expect, it } from "vitest";
import {
  startExpertReferralTestDatabase,
  type ExpertReferralTestDatabase,
} from "../../packages/db/src/testkit/expert-referral.js";
import { seedClientConsent } from "../../packages/db/src/testkit/client-consent.js";
import { PostgresResidentVerificationRepository } from "../../packages/db/src/repositories/resident-verification-repository.js";
let database: ExpertReferralTestDatabase;
let sharedTariff: string | undefined;
beforeAll(async () => {
  database = await startExpertReferralTestDatabase();
}, 120000);
afterAll(async () => {
  await database?.stop();
}, 120000);
async function fixture() {
  const userId = await database.createUser(),
    telegramUserId = String(Math.floor(Math.random() * 1e12) + 1);
  await database.db.execute(
    sql`insert into channel_identities(user_id,provider,external_id,external_chat_id,bot_key,status) values(${userId}::uuid,'telegram',${telegramUserId},${telegramUserId},'resident-promo','active')`,
  );
  await seedClientConsent(database.db, userId, "client_messaging");
  const scope = {
    userId,
    botId: "717171",
    botKey: "resident-promo",
    telegramUserId,
    chatId: telegramUserId,
  };
  const repo = new PostgresResidentVerificationRepository(database.db, {
    botId: scope.botId,
    botKey: scope.botKey,
    messagingConsentPolicyVersion: "client-messaging-v1",
  });
  const command = () => ({
    ...scope,
    requestKey: randomUUID(),
    requestDigest: "a".repeat(64),
  });
  return { scope, repo, command };
}
describe("resident v2 durable identity", () => {
  it("creates v2 with optional education and immutable submitted source", async () => {
    const { repo, command } = await fixture();
    const form = await repo.mutate({ ...command(), action: "start" });
    expect(form.formVersion).toBe(2);
    const patch = {
      primaryRole: "EXPERT",
      roles: ["EXPERT"],
      category: "BOTH",
      tax: "INDIVIDUAL_NO_STATUS",
      city: "Онлайн",
      socialLinks: ["https://example.com/"],
      motivation: "Практика",
      specialization: "Метод",
      averageCheckMinor: "100",
      methods: "Практика",
      experienceYears: 0,
      cases: "Описание",
    };
    await repo.mutate({
      ...command(),
      action: "patch",
      expectedRevision: 0,
      patch,
    });
    const submitted = await repo.mutate({
      ...command(),
      action: "submit",
      expectedRevision: 1,
    });
    expect(submitted.status).toBe("UNDER_REVIEW");
    await expect(
      database.db.execute(
        sql`update residents_applications set revision=revision+1,submitted_draft='{}' where id=${form.id}::uuid`,
      ),
    ).rejects.toThrow();
    await expect(
      database.db.execute(
        sql`update residents_applications set revision=revision+1,status='APPROVED_BASIC' where id=${form.id}::uuid`,
      ),
    ).rejects.toThrow();
  });
  it("keeps pending v1 and old INDIVIDUAL under original rules", async () => {
    const { scope, repo, command } = await fixture();
    await database.db.execute(
      sql`insert into residents_applications(user_id,bot_id,bot_key,channel_identity_id,telegram_user_id,chat_id,form_version,policy_version,education_requirement) select ${scope.userId}::uuid,${scope.botId},${scope.botKey},id,${scope.telegramUserId},${scope.chatId},1,'resident_education_unknown_v1','unknown_manual_review' from channel_identities where user_id=${scope.userId}::uuid`,
    );
    const form = await repo.mutate({ ...command(), action: "start" });
    expect(form.formVersion).toBe(1);
    expect(
      (
        await repo.mutate({
          ...command(),
          action: "patch",
          expectedRevision: 0,
          patch: { tax: "INDIVIDUAL" },
        })
      ).draft.tax,
    ).toBe("INDIVIDUAL");
  });
});

async function submitted() {
  const f = await fixture();
  const { saveExpertOfferProfile } =
    await import("../../packages/db/src/repositories/expert-offer-v2.js");
  const { PostgresExpertSeparatedSalesRepository } =
    await import("../../packages/db/src/repositories/expert-separated-sales-repository.js");
  await saveExpertOfferProfile(database.db, {
    userId: f.scope.userId,
    cityCode: "kazan",
    millionCity: false,
    serviceFormat: "offline",
    ticketMinor: "300000",
    participantKind: "expert",
    idempotencyKey: randomUUID(),
  });
  const tariff = (sharedTariff ??= await database.createResidencyTariff({
    tariffKey: "PRO",
    displayName: "PRO",
    priceMinor: 999000,
    durationSeconds: 2592000,
  }));
  const sales = new PostgresExpertSeparatedSalesRepository(database.db, {
    botId: f.scope.botId,
    botKey: f.scope.botKey,
    messagingConsentPolicyVersion: "client-messaging-v1",
  });
  let sale = await sales.transition({
    ...f.command(),
    tariffVersionId: tariff,
  });
  for (const action of ["positive", "promo", "month"] as const)
    sale = await sales.transition({
      ...f.command(),
      baseId: sale!.id,
      revision: sale!.revision,
      action,
    });
  const initial = await f.repo.mutate({ ...f.command(), action: "start" });
  await f.repo.mutate({
    ...f.command(),
    action: "patch",
    expectedRevision: initial.revision,
    patch: {
      primaryRole: "OTHER",
      roles: ["OTHER"],
      category: "BOTH",
      tax: "INDIVIDUAL_NO_STATUS",
      city: "Онлайн",
      socialLinks: ["https://example.com/"],
      motivation: "Практика",
      path: "Путь",
      cases: "Описание",
    },
  });
  const form = await f.repo.mutate({
    ...f.command(),
    action: "submit",
    expectedRevision: 1,
  });
  const app = (
    await database.db.execute<{ id: string }>(
      sql`select application_id id from expert_sales_form_bridges where form_id=${form.id}::uuid`,
    )
  ).rows[0]!;
  const manager = await database.createUser(),
    session = `sha256:${"a".repeat(32)}${randomUUID().replaceAll("-", "")}`;
  await database.db.execute(
    sql`insert into admin_sessions(session_id_hash,admin_id,mfa_verified_at,expires_at) values(${session},${manager}::uuid,clock_timestamp(),clock_timestamp()+interval '1 hour')`,
  );
  await database.db.execute(
    sql`insert into admin_role_assignments(admin_id,role) values(${manager}::uuid,'support')`,
  );
  const { PostgresResidentReviewRepository } =
    await import("../../packages/db/src/repositories/resident-review-repository.js");
  const messages: { text: string }[] = [];
  const review = new PostgresResidentReviewRepository(database.db, {
    providerMode: "test",
    messagingConsentPolicyVersion: "client-messaging-v1",
    notifier: {
      async send(i) {
        messages.push({ text: i.text });
        return { botId: i.botId, chatId: i.chatId, messageId: "123" };
      },
    },
  });
  return { ...f, form, applicationId: app.id, session, review, messages };
}
it("confirms exact reviewed category, denies legacy bypass, creates one fixed fee and delivers exact hash", async () => {
  const f = await submitted();
  const { PostgresExpertVerificationRepository } =
    await import("../../packages/db/src/repositories/expert-verification-repository.js");
  const legacy = new PostgresExpertVerificationRepository(database.db, {
    providerMode: "test",
    messagingConsentPolicyVersion: "client-messaging-v1",
  });
  await expect(
    legacy.decide({
      sessionHash: f.session,
      applicationId: f.applicationId,
      decision: "approved",
      reasonCode: "verified",
      idempotencyKey: randomUUID(),
    }),
  ).rejects.toThrow();
  const p = await f.review.preview(f.session, {
    applicationId: f.applicationId,
    expectedRevision: 2,
    expectedGeneration: 1,
    key: "APPROVED_EXCLUSIVE",
  });
  const [a, b] = await Promise.all([
    f.review.confirm(f.session, f.applicationId, p.previewId, p.hash),
    f.review.confirm(f.session, f.applicationId, p.previewId, p.hash),
  ]);
  expect(a.eventId).toBe(b.eventId);
  expect(
    (
      await database.db.execute(
        sql`select amount_minor::text amount from expert_onboarding_invoices where application_id=${f.applicationId}::uuid`,
      )
    ).rows,
  ).toEqual([{ amount: "300000" }]);
  expect(
    (
      await database.db.execute(
        sql`select * from expert_sales_paid_locks where user_id=${f.scope.userId}::uuid`,
      )
    ).rows,
  ).toHaveLength(0);
  expect(
    (
      await database.db.execute(
        sql`select expert_sales_form_valid(${f.applicationId}::uuid,${f.scope.userId}::uuid) valid`,
      )
    ).rows[0]?.valid,
  ).toBe(true);
  const signal = new AbortController().signal;
  await Promise.all([
    f.review.deliverMaterials(a.eventId, { signal }),
    f.review.deliverMaterials(a.eventId, { signal }),
  ]);
  expect(f.messages).toEqual([{ text: p.text }]);
  const { createHash } = await import("node:crypto");
  expect(createHash("sha256").update(f.messages[0]!.text).digest("hex")).toBe(
    p.hash,
  );
});
it("requires genuine completed information before insufficient-proof refusal; fences stale previews", async () => {
  const f = await submitted();
  await expect(
    f.review.preview(f.session, {
      applicationId: f.applicationId,
      expectedRevision: 2,
      expectedGeneration: 1,
      key: "REJECT_INSUFFICIENT_PROOF",
    }),
  ).rejects.toThrow("resident_information_first");
  const stale = await f.review.preview(f.session, {
    applicationId: f.applicationId,
    expectedRevision: 2,
    expectedGeneration: 1,
    key: "APPROVED_BASIC",
  });
  const p = await f.review.preview(f.session, {
    applicationId: f.applicationId,
    expectedRevision: 2,
    expectedGeneration: 1,
    key: "REQ_INFO_GENERIC",
    questions: ["Опыт?"],
  });
  const e = await f.review.confirm(
    f.session,
    f.applicationId,
    p.previewId,
    p.hash,
  );
  const r = (
    await database.db.execute(
      sql`select extract(epoch from r.deadline-e.created_at)::integer seconds from resident_information_requests r join resident_review_events e on e.id=r.id where r.id=${e.eventId}::uuid`,
    )
  ).rows[0];
  expect(r?.seconds).toBe(172800);
  await expect(
    f.review.confirm(f.session, f.applicationId, stale.previewId, stale.hash),
  ).rejects.toThrow("resident_preview_stale");
  await expect(
    f.repo.mutate({
      ...f.command(),
      action: "followup",
      expectedRevision: 3,
      requestId: randomUUID(),
      answer: "Поздно",
    }),
  ).rejects.toThrow("resident_followup_unavailable");
  await f.repo.mutate({
    ...f.command(),
    action: "followup",
    expectedRevision: 3,
    requestId: e.eventId,
    questionNumber: 1,
    answer: "Опыт 5 лет",
  });
  const completed = await f.repo.mutate({
    ...f.command(),
    action: "complete",
    expectedRevision: 4,
    requestId: e.eventId,
  });
  expect(completed.status).toBe("UNDER_REVIEW");
  const refusal = await f.review.preview(f.session, {
    applicationId: f.applicationId,
    expectedRevision: 5,
    expectedGeneration: 2,
    key: "REJECT_INSUFFICIENT_PROOF",
  });
  const rejected = await f.review.confirm(
    f.session,
    f.applicationId,
    refusal.previewId,
    refusal.hash,
  );
  expect(rejected.action).toBe("REJECT_SOFT");
  expect(
    (
      await database.db.execute(
        sql`select submitted_revision from residents_applications where id=${f.form.id}::uuid`,
      )
    ).rows[0]?.submitted_revision,
  ).toBe(2);
  await expect(
    f.repo.mutate({ ...f.command(), action: "reapply", expectedRevision: 6 }),
  ).rejects.toThrow();
});
it("withdrawal deletes private previews/messages and late completion cannot resurrect delivery", async () => {
  const f = await submitted();
  const p = await f.review.preview(f.session, {
    applicationId: f.applicationId,
    expectedRevision: 2,
    expectedGeneration: 1,
    key: "REJECT_NICHE_MISMATCH",
  });
  const e = await f.review.confirm(
    f.session,
    f.applicationId,
    p.previewId,
    p.hash,
  );
  await database.db.execute(
    sql`select erase_resident_verification_subject(${f.scope.userId}::uuid)`,
  );
  await f.review.deliverMaterials(e.eventId, {
    signal: new AbortController().signal,
  });
  expect(f.messages).toHaveLength(0);
  expect(
    (
      await database.db.execute(
        sql`select * from resident_review_previews where id=${p.previewId}::uuid`,
      )
    ).rows,
  ).toHaveLength(0);
  expect(
    (
      await database.db.execute(
        sql`select final_hash from resident_review_events where id=${e.eventId}::uuid`,
      )
    ).rows[0]?.final_hash,
  ).toBe(p.hash);
  await expect(
    f.review.confirm(f.session, f.applicationId, p.previewId, p.hash),
  ).rejects.toThrow();
});
it("uses PostgreSQL calendar-month clamping at Jan31/leap year and exact boundary", async () => {
  expect(
    (
      await database.db.execute(
        sql`select ('2028-01-31T10:00:00Z'::timestamptz+interval '1 month')::text leap,('2027-01-31T10:00:00Z'::timestamptz+interval '1 month')::text ordinary,('2028-02-29T10:00:00Z'::timestamptz <= '2028-02-29T10:00:00Z'::timestamptz) exact`,
      )
    ).rows[0],
  ).toMatchObject({
    leap: "2028-02-29 10:00:00+00",
    ordinary: "2027-02-28 10:00:00+00",
    exact: true,
  });
});
it("quarantines ambiguous delivery and offers audited close without resend", async () => {
  const f = await submitted();
  const { PostgresResidentReviewRepository } =
    await import("../../packages/db/src/repositories/resident-review-repository.js");
  let sent = 0;
  const review = new PostgresResidentReviewRepository(database.db, {
    providerMode: "test",
    messagingConsentPolicyVersion: "client-messaging-v1",
    notifier: {
      async send() {
        sent++;
        throw Error("synthetic lost acknowledgement");
      },
    },
  });
  const p = await review.preview(f.session, {
    applicationId: f.applicationId,
    expectedRevision: 2,
    expectedGeneration: 1,
    key: "REJECT_NICHE_MISMATCH",
  });
  const e = await review.confirm(
    f.session,
    f.applicationId,
    p.previewId,
    p.hash,
  );
  expect(
    (
      await review.deliverMaterials(e.eventId, {
        signal: new AbortController().signal,
      })
    ).kind,
  ).toBe("unknown_outcome");
  await review.deliverMaterials(e.eventId, {
    signal: new AbortController().signal,
  });
  expect(sent).toBe(1);
  await review.closeUnknown(f.session, f.applicationId, e.eventId);
  expect(
    (
      await database.db.execute(
        sql`select action from resident_review_recoveries where event_id=${e.eventId}::uuid`,
      )
    ).rows[0]?.action,
  ).toBe("closed_without_resend");
});
it("times out48h to human review, refuses late answers and cancels obsolete question delivery", async () => {
  const f = await submitted();
  const p = await f.review.preview(f.session, {
    applicationId: f.applicationId,
    expectedRevision: 2,
    expectedGeneration: 1,
    key: "REQ_INFO_GENERIC",
    questions: ["Опыт?"],
  });
  const e = await f.review.confirm(
    f.session,
    f.applicationId,
    p.previewId,
    p.hash,
  );
  // Test-only elapsed-clock fixture: immutable provenance is independently guarded.
  await database.db.transaction(async (tx) => {
    await tx.execute(
      sql`alter table resident_review_events disable trigger resident_review_events_immutable`,
    );
    await tx.execute(
      sql`update resident_review_events set deadline=clock_timestamp()-interval '1 second' where id=${e.eventId}::uuid`,
    );
    await tx.execute(
      sql`alter table resident_review_events enable trigger resident_review_events_immutable`,
    );
    await tx.execute(
      sql`update resident_information_requests set deadline=clock_timestamp()-interval '1 second' where id=${e.eventId}::uuid`,
    );
  });
  await f.review.deliverMaterials(e.eventId, {
    signal: new AbortController().signal,
  });
  expect(f.messages).toHaveLength(0);
  // Existing authenticated manager view renews human review even with delivery off.
  const { createExpertVerificationComposition } =
    await import("../../apps/api/src/expert-verification-composition.js");
  const { loadEnv } = await import("../../packages/config/src/env.js");
  const config = loadEnv({
    DATABASE_URL: "postgresql://synthetic:synthetic@localhost/fixture",
    ALLOW_INSECURE_LOCAL_DATABASE: "true",
    EXPERT_VERIFICATION_ENABLED: "true",
    EXPERT_VERIFICATION_PAYMENT_MODE: "test",
    EXPERT_VERIFICATION_MESSAGING_CONSENT_POLICY_VERSION: "client-messaging-v1",
  });
  expect(
    (
      await createExpertVerificationComposition(
        database.db,
        config,
      )!.service.detail(f.session, f.applicationId)
    ).kind,
  ).toBe("ok");
  const current = await f.repo.mutate({ ...f.command(), action: "start" });
  expect(current.status).toBe("UNDER_REVIEW");
  expect(current.checkGeneration).toBe(2);
  await expect(
    f.repo.mutate({
      ...f.command(),
      action: "followup",
      expectedRevision: current.revision,
      requestId: e.eventId,
      questionNumber: 1,
      answer: "Поздно",
    }),
  ).rejects.toThrow();
  expect(
    (
      await database.db.execute(
        sql`select verification_status from expert_onboarding_applications where id=${f.applicationId}::uuid`,
      )
    ).rows[0]?.verification_status,
  ).toBe("pending");
});
it("one eligible reapplication wins concurrently without resetting base clock or old financial decision", async () => {
  const f = await submitted();
  const before = (
    await database.db.execute(
      sql`select id,base_offer_shown_at from expert_sales_bases where user_id=${f.scope.userId}::uuid`,
    )
  ).rows;
  const p = await f.review.preview(f.session, {
    applicationId: f.applicationId,
    expectedRevision: 2,
    expectedGeneration: 1,
    key: "REJECT_NICHE_MISMATCH",
  });
  const e = await f.review.confirm(
    f.session,
    f.applicationId,
    p.previewId,
    p.hash,
  );
  await database.db.transaction(async (tx) => {
    await tx.execute(
      sql`alter table resident_review_events disable trigger resident_review_events_immutable`,
    );
    await tx.execute(
      sql`update resident_review_events set created_at=clock_timestamp()-interval '1 month',reapply_at=clock_timestamp() where id=${e.eventId}::uuid`,
    );
    await tx.execute(
      sql`alter table resident_review_events enable trigger resident_review_events_immutable`,
    );
  });
  const results = await Promise.allSettled([
    f.repo.mutate({ ...f.command(), action: "reapply", expectedRevision: 3 }),
    f.repo.mutate({ ...f.command(), action: "reapply", expectedRevision: 3 }),
  ]);
  expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  const next = await f.repo.mutate({ ...f.command(), action: "start" });
  expect(next.id).not.toBe(f.form.id);
  expect(next.revision).toBe(0);
  expect(
    (
      await database.db.execute(
        sql`select id,base_offer_shown_at from expert_sales_bases where user_id=${f.scope.userId}::uuid`,
      )
    ).rows,
  ).toEqual(before);
  expect(
    (
      await database.db.execute(
        sql`select decision from expert_verification_decisions where application_audit_id=${f.applicationId}::uuid`,
      )
    ).rows[0]?.decision,
  ).toBe("rejected");
  await f.repo.mutate({
    ...f.command(),
    action: "patch",
    expectedRevision: 0,
    patch: f.form.draft,
  });
  await f.repo.mutate({
    ...f.command(),
    action: "submit",
    expectedRevision: 1,
  });
  expect(
    (
      await database.db.execute(
        sql`select application_id from expert_sales_form_bridges where user_id=${f.scope.userId}::uuid`,
      )
    ).rows,
  ).toHaveLength(2);
});
it("hard rejection never reopens and MFA revocation invalidates already-rendered preview", async () => {
  const f = await submitted();
  const p = await f.review.preview(f.session, {
    applicationId: f.applicationId,
    expectedRevision: 2,
    expectedGeneration: 1,
    key: "REJECT_LEGAL_VIOLATION",
  });
  await database.db.execute(
    sql`update admin_sessions set mfa_verified_at=clock_timestamp()-interval '16 minutes' where session_id_hash=${f.session}`,
  );
  await expect(
    f.review.confirm(f.session, f.applicationId, p.previewId, p.hash),
  ).rejects.toThrow("verification_forbidden");
  await database.db.execute(
    sql`update admin_sessions set mfa_verified_at=clock_timestamp() where session_id_hash=${f.session}`,
  );
  await f.review.confirm(f.session, f.applicationId, p.previewId, p.hash);
  await expect(
    f.repo.mutate({ ...f.command(), action: "reapply", expectedRevision: 3 }),
  ).rejects.toThrow();
});
it("rechecks actual original identity at first disclosure", async () => {
  const f = await submitted();
  const p = await f.review.preview(f.session, {
    applicationId: f.applicationId,
    expectedRevision: 2,
    expectedGeneration: 1,
    key: "REJECT_NICHE_MISMATCH",
  });
  const e = await f.review.confirm(
    f.session,
    f.applicationId,
    p.previewId,
    p.hash,
  );
  await database.db.execute(
    sql`update channel_identities set status='blocked' where user_id=${f.scope.userId}::uuid`,
  );
  await f.review.deliverMaterials(e.eventId, {
    signal: new AbortController().signal,
  });
  expect(f.messages).toHaveLength(0);
});
it("normal bounded worker composition sends exact approved notice and is off by default", async () => {
  const f = await submitted();
  const { loadEnv } = await import("../../packages/config/src/env.js");
  const { createResidentReviewNotificationLifecycle } =
    await import("../../apps/worker/src/resident-review-notification-composition.js");
  const base = {
    DATABASE_URL: "postgresql://synthetic:synthetic@localhost/fixture",
    ALLOW_INSECURE_LOCAL_DATABASE: "true",
  };
  expect(
    createResidentReviewNotificationLifecycle(loadEnv(base), database.db),
  ).toBeUndefined();
  const p = await f.review.preview(f.session, {
    applicationId: f.applicationId,
    expectedRevision: 2,
    expectedGeneration: 1,
    key: "APPROVED_BASIC",
  });
  const e = await f.review.confirm(
    f.session,
    f.applicationId,
    p.previewId,
    p.hash,
  );
  const config = loadEnv({
    ...base,
    EXPERT_APPLICANT_ENABLED: "true",
    EXPERT_PROMO_TELEGRAM_BOT_ID: f.scope.botId,
    EXPERT_PROMO_TELEGRAM_BOT_KEY: f.scope.botKey,
    EXPERT_PROMO_TELEGRAM_BOT_TOKEN: `${f.scope.botId}:${"A".repeat(35)}`,
    EXPERT_PROMO_TELEGRAM_WEBHOOK_SECRET: "synthetic_webhook_secret_1234567890",
    EXPERT_PROMO_MESSAGING_CONSENT_POLICY_VERSION: "client-messaging-v1",
    EXPERT_VERIFICATION_ENABLED: "true",
    EXPERT_VERIFICATION_PAYMENT_MODE: "test",
    EXPERT_VERIFICATION_MESSAGING_CONSENT_POLICY_VERSION: "client-messaging-v1",
    RESIDENT_REVIEW_NOTIFICATIONS_ENABLED: "true",
  });
  const messages: string[] = [];
  const worker = createResidentReviewNotificationLifecycle(
    config,
    database.db,
    {
      async send(input) {
        messages.push(input.text);
        return { botId: input.botId, chatId: input.chatId, messageId: "234" };
      },
    },
  )!;
  await worker.runOnce();
  expect(messages).toContain(p.text);
  expect(
    (
      await database.db.execute(
        sql`select status from resident_review_messages where event_id=${e.eventId}::uuid`,
      )
    ).rows[0]?.status,
  ).toBe("delivered");
  worker.stopAccepting();
  expect((await worker.runOnce()).reason).toBe("closing");
});
it("validates complete six-role union and bounded media in SQL as in the domain", async () => {
  const { residentRoles, residentPolicyV2, residentForm } =
    await import("../../packages/domain/src/resident-verification-form.js");
  const common = {
    category: "BASIC",
    tax: "INDIVIDUAL_NO_STATUS",
    city: "Онлайн",
    socialLinks: ["https://example.com/"],
    motivation: "Практика",
  };
  const doc = {
    kind: "document",
    fileId: "private_doc",
    mimeType: "application/pdf",
    size: 100,
  };
  const video = {
    kind: "video",
    fileId: "private_video",
    mimeType: "video/mp4",
    size: 20971520,
  };
  const fields = {
    specialization: "Практика",
    averageCheckMinor: "0",
    methods: "Метод",
    experienceYears: 100,
    cases: "Пример",
    premisesType: "Аренда",
    propertyEvidence: [doc],
    capacity: 100000,
    amenities: ["wifi"],
    tourMedia: [video],
    eventFormat: "Онлайн",
    programme: "Программа",
    speakers: "Команда",
    pastEvents: "Опыт",
    projectName: "Школа",
    teachingTeam: "Команда",
    graduateReviews: "Отзывы",
    path: "Путь",
  };
  for (const roles of [...residentRoles.map((r) => [r]), [...residentRoles]]) {
    const draft = { ...common, ...fields, roles, primaryRole: roles[0] };
    expect(
      residentForm(
        draft as Parameters<typeof residentForm>[0],
        residentPolicyV2,
        2,
      ).missing,
    ).toEqual([]);
    expect(
      (
        await database.db.execute(
          sql`select resident_verification_draft_v2_valid(${JSON.stringify(draft)}::jsonb,true) valid`,
        )
      ).rows[0]?.valid,
    ).toBe(true);
  }
  for (const invalid of [
    { ...video, mimeType: null },
    { ...video, size: null },
    { ...video, size: 20971521 },
    {
      ...doc,
      mimeType:
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      size: null,
    },
  ])
    expect(
      (
        await database.db.execute(
          sql`select resident_verification_draft_v2_valid(${JSON.stringify({ education: [invalid] })}::jsonb) valid`,
        )
      ).rows[0]?.valid,
    ).toBe(false);
});
it("actual consent withdrawal serializes with first disclosure and erases private delivery without resurrection", async () => {
  const f = await submitted();
  const { PostgresResidentReviewRepository } =
    await import("../../packages/db/src/repositories/resident-review-repository.js");
  const { PostgresPrivacyRepository } =
    await import("../../packages/db/src/repositories/privacy-repository.js");
  let release!: () => void;
  const hold = new Promise<void>((r) => (release = r));
  let entered!: () => void;
  const started = new Promise<void>((r) => (entered = r));
  const review = new PostgresResidentReviewRepository(database.db, {
    providerMode: "test",
    messagingConsentPolicyVersion: "client-messaging-v1",
    notifier: {
      async send(i) {
        entered();
        await hold;
        return { botId: i.botId, chatId: i.chatId, messageId: "987" };
      },
    },
  });
  const p = await review.preview(f.session, {
    applicationId: f.applicationId,
    expectedRevision: 2,
    expectedGeneration: 1,
    key: "REJECT_NICHE_MISMATCH",
  });
  const e = await review.confirm(
    f.session,
    f.applicationId,
    p.previewId,
    p.hash,
  );
  const sending = review.deliverMaterials(e.eventId, {
    signal: new AbortController().signal,
  });
  await started;
  const privacy = new PostgresPrivacyRepository(database.db, {
    privacyMutationCapability: { enabled: true },
  });
  const withdrawal = privacy.withdrawConsentAtomically({
    targetUserId: f.scope.userId,
    purpose: "client_messaging",
    policyVersion: "client-messaging-v1",
    correlationId: `review-withdraw:${f.scope.userId}`,
  });
  release();
  await sending;
  await withdrawal;
  expect(
    (
      await database.db.execute(
        sql`select event_id from resident_review_messages where event_id=${e.eventId}::uuid`,
      )
    ).rows,
  ).toHaveLength(0);
  expect(
    await review.deliverMaterials(e.eventId, {
      signal: new AbortController().signal,
    }),
  ).toEqual({ kind: "cancelled" });
  expect(
    (
      await database.db.execute(
        sql`select final_hash from resident_review_events where id=${e.eventId}::uuid`,
      )
    ).rows[0]?.final_hash,
  ).toBe(p.hash);
});
it("binds confirmation to its actual manager session, owner attempt and complete question set", async () => {
  const f = await submitted(),
    other = await submitted();
  const p = await f.review.preview(f.session, {
    applicationId: f.applicationId,
    expectedRevision: 2,
    expectedGeneration: 1,
    key: "REQ_INFO_GENERIC",
    questions: ["Опыт?", "Кейсы?"],
  });
  await expect(
    f.review.confirm(other.session, f.applicationId, p.previewId, p.hash),
  ).rejects.toThrow("resident_preview_stale");
  await expect(
    f.review.confirm(f.session, other.applicationId, p.previewId, p.hash),
  ).rejects.toThrow("resident_preview_stale");
  const e = await f.review.confirm(
    f.session,
    f.applicationId,
    p.previewId,
    p.hash,
  );
  await f.repo.mutate({
    ...f.command(),
    action: "followup",
    expectedRevision: 3,
    requestId: e.eventId,
    questionNumber: 1,
    answer: "Пять лет",
  });
  const { PostgresExpertVerificationRepository } =
    await import("../../packages/db/src/repositories/expert-verification-repository.js");
  const detail = await new PostgresExpertVerificationRepository(database.db, {
    providerMode: "test",
    messagingConsentPolicyVersion: "client-messaging-v1",
  }).applicationDetail(f.session, f.applicationId);
  expect(detail).toMatchObject({
    questionnaire: {
      supplements: {
        requests: [{ id: e.eventId, questions: ["Опыт?", "Кейсы?"] }],
        answers: [
          {
            requestId: e.eventId,
            questionNumber: 1,
            answers: { answer: "Пять лет" },
          },
        ],
      },
    },
  });
  await expect(
    f.repo.mutate({
      ...f.command(),
      action: "complete",
      expectedRevision: 4,
      requestId: e.eventId,
    }),
  ).rejects.toThrow("resident_followup_unavailable");
  await f.repo.mutate({
    ...f.command(),
    action: "followup",
    expectedRevision: 4,
    requestId: e.eventId,
    questionNumber: 2,
    answer: "Три кейса",
  });
  const renewed = await f.repo.mutate({
    ...f.command(),
    action: "complete",
    expectedRevision: 5,
    requestId: e.eventId,
  });
  expect(renewed.status).toBe("UNDER_REVIEW");
  await f.review.deliverMaterials(e.eventId, {
    signal: new AbortController().signal,
  });
  expect(f.messages).toHaveLength(0);
});
it("deferred notice preserves approved bytes while the actual bot view exposes the remaining DB window", async () => {
  const f = await submitted();
  const p = await f.review.preview(f.session, {
    applicationId: f.applicationId,
    expectedRevision: 2,
    expectedGeneration: 1,
    key: "REQ_INFO_GENERIC",
    questions: ["Опыт?"],
  });
  const e = await f.review.confirm(
    f.session,
    f.applicationId,
    p.previewId,
    p.hash,
  );
  // Advance only this test fixture's elapsed time; production always uses actual confirmation time.
  await database.db.transaction(async (tx) => {
    await tx.execute(
      sql`alter table resident_review_events disable trigger resident_review_events_immutable`,
    );
    await tx.execute(
      sql`update resident_review_events set created_at=created_at-interval '47 hours',deadline=deadline-interval '47 hours' where id=${e.eventId}::uuid`,
    );
    await tx.execute(
      sql`alter table resident_review_events enable trigger resident_review_events_immutable`,
    );
    await tx.execute(
      sql`update resident_information_requests set deadline=deadline-interval '47 hours' where id=${e.eventId}::uuid`,
    );
  });
  const snapshot = await f.repo.mutate({ ...f.command(), action: "start" });
  expect(snapshot.informationRequest?.remainingSeconds).toBeGreaterThan(3500);
  expect(snapshot.informationRequest?.remainingSeconds).toBeLessThanOrEqual(
    3600,
  );
  const { createResidentVerificationService } =
    await import("../../packages/application/src/resident-verification-service.js");
  const bot = createResidentVerificationService({
    enabled: true,
    salesFirst: true,
    repository: f.repo,
  });
  const view = await bot.handle({
    ...f.scope,
    updateId: 765432,
    text: "/verification",
  });
  expect(view?.text).toContain("Осталось 60 мин.");
  expect(view?.text).toContain(e.eventId);
  expect(view?.text).toContain(
    new Date(snapshot.informationRequest!.deadline).toLocaleString("ru-RU", {
      timeZone: "UTC",
    }),
  );
  await f.review.deliverMaterials(e.eventId, {
    signal: new AbortController().signal,
  });
  expect(f.messages).toEqual([{ text: p.text }]);
  expect(p.text).toContain("48 часов с момента создания запроса");
  expect(p.text).toContain("/verification");
});
