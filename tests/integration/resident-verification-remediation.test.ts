import { createRequire } from "node:module";
import { createHash, randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { beforeAll, afterAll, expect, it } from "vitest";
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
  // Negative witness only, inside this disposable test database.
  if (process.env.II_TONYA_TEST_REAPPLY_MUTATION === "30days")
    await database.db.execute(
      sql`create or replace function resident_reapply_deadline(decided_at timestamptz) returns timestamptz language sql immutable strict as $$ select decided_at+interval '30 days' $$`,
    );
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
    token = randomUUID(),
    session = `sha256:${createHash("sha256").update(token).digest("hex")}`;
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
  return {
    ...f,
    form,
    applicationId: app.id,
    session,
    token,
    review,
    messages,
  };
}

it("R1 terminal unresolved delivery remains discoverable after manager reload", async () => {
  const f = await submitted();
  const p = await f.review.preview(f.session, {
    applicationId: f.applicationId,
    expectedRevision: 2,
    expectedGeneration: 1,
    key: "REJECT_NICHE_MISMATCH",
  });
  await f.review.confirm(f.session, f.applicationId, p.previewId, p.hash);
  const { PostgresExpertVerificationRepository } =
    await import("../../packages/db/src/repositories/expert-verification-repository.js");
  const manager = new PostgresExpertVerificationRepository(database.db, {
    providerMode: "test",
    messagingConsentPolicyVersion: "client-messaging-v1",
  });
  expect(await manager.listQueue(f.session)).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        applicationId: f.applicationId,
        status: "rejected",
      }),
    ]),
  );
  const second = await submitted();
  const firstPage = await manager.listQueue(f.session, 1);
  const nextPage = await manager.listQueue(
    f.session,
    1,
    firstPage[0]!.applicationId,
  );
  expect(firstPage.map((row) => row.applicationId)).toEqual([f.applicationId]);
  expect(nextPage.map((row) => row.applicationId)).toEqual([
    second.applicationId,
  ]);
});
it("R2 accepted large history remains bounded and fully pageable with request context", async () => {
  const f = await submitted();
  const p = await f.review.preview(f.session, {
    applicationId: f.applicationId,
    expectedRevision: 2,
    expectedGeneration: 1,
    key: "REQ_INFO_GENERIC",
    questions: ["Расскажите об опыте?"],
  });
  const event = await f.review.confirm(
    f.session,
    f.applicationId,
    p.previewId,
    p.hash,
  );
  for (let i = 0; i < 100; i++)
    await f.repo.mutate({
      ...f.command(),
      action: "followup",
      expectedRevision: 3 + i,
      requestId: event.eventId,
      questionNumber: 1,
      answer: `${i}:` + "я".repeat(2900),
    });
  const { PostgresExpertVerificationRepository } =
    await import("../../packages/db/src/repositories/expert-verification-repository.js");
  const manager = new PostgresExpertVerificationRepository(database.db, {
    providerMode: "test",
    messagingConsentPolicyVersion: "client-messaging-v1",
  });
  const first = await manager.applicationDetail(f.session, f.applicationId);
  expect(
    JSON.stringify({ kind: "ok", item: first }).length,
  ).toBeLessThanOrEqual(262144);
  const Fastify = createRequire(
    new URL("../../apps/api/package.json", import.meta.url),
  )(
    "fastify",
  ) as typeof import("../../apps/api/node_modules/fastify/fastify.js").default;
  const { loadEnv } = await import("../../packages/config/src/env.js");
  const { createExpertVerificationComposition } =
    await import("../../apps/api/src/expert-verification-composition.js");
  const { expertVerificationRoutes } =
    await import("../../apps/api/src/routes/expert-verification.js");
  const config = loadEnv({
    DATABASE_URL: "postgresql://synthetic:synthetic@localhost/fixture",
    ALLOW_INSECURE_LOCAL_DATABASE: "true",
    EXPERT_VERIFICATION_ENABLED: "true",
    EXPERT_VERIFICATION_PAYMENT_MODE: "test",
    EXPERT_VERIFICATION_MESSAGING_CONSENT_POLICY_VERSION: "client-messaging-v1",
  });
  const app = Fastify({ logger: false });
  await app.register(expertVerificationRoutes, {
    enabled: true,
    service: createExpertVerificationComposition(database.db, config)!.service,
  });
  try {
    const firstResponse = await app.inject({
      method: "GET",
      url: `/v1/admin/expert-verification/${f.applicationId}`,
      headers: { authorization: `Bearer ${f.token}` },
    });
    expect(firstResponse.statusCode, firstResponse.body).toBe(200);
    expect(firstResponse.body.length).toBeLessThanOrEqual(262144);
    const next = firstResponse.json().item.questionnaire.history.nextCursor;
    expect(next).toBeTruthy();
    const second = await app.inject({
      method: "GET",
      url: `/v1/admin/expert-verification/${f.applicationId}?historyCursor=${encodeURIComponent(next)}`,
      headers: { authorization: `Bearer ${f.token}` },
    });
    expect(second.statusCode, second.body).toBe(200);
    expect(
      second.json().item.questionnaire.supplements.answers[0].revision,
    ).toBe(5);
  } finally {
    await app.close();
  }

  let cursor: string | undefined;
  const seen: number[] = [];
  for (let page = 0; page < 101; page++) {
    const value = (await manager.applicationDetail(
      f.session,
      f.applicationId,
      cursor,
    )) as unknown as {
      questionnaire: {
        supplements: {
          answers: {
            revision: number;
            requestId: string;
            questionNumber: number;
            questions: string[];
          }[];
        };
        history: { nextCursor: string | null };
      };
    };
    expect(JSON.stringify(value).length).toBeLessThanOrEqual(262144);
    for (const a of value.questionnaire.supplements.answers) {
      expect(a.requestId).toBe(event.eventId);
      expect(a.questionNumber).toBe(1);
      expect(a.questions).toEqual(["Расскажите об опыте?"]);
      seen.push(a.revision);
    }
    if (!value.questionnaire.history.nextCursor) break;
    cursor = value.questionnaire.history.nextCursor;
  }
  expect(seen).toEqual(Array.from({ length: 100 }, (_, i) => i + 4));
}, 30000);
it("R3 blocked overdue identity cannot poison valid manager and worker work", async () => {
  const blocked = await submitted(),
    valid = await submitted();
  for (const f of [blocked, valid]) {
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
    await database.db.execute(
      sql`update resident_information_requests set deadline=clock_timestamp()-interval '1 minute' where id=${e.eventId}::uuid`,
    );
  }
  await database.db.execute(
    sql`update channel_identities set status='blocked' where user_id=${blocked.scope.userId}::uuid`,
  );
  await expect(valid.review.expireRequests(1, valid.session)).resolves.toBe(1);
  expect(
    (await valid.repo.mutate({ ...valid.command(), action: "start" })).status,
  ).toBe("UNDER_REVIEW");
  await expect(valid.review.listDueMaterialJobs(20)).resolves.toBeInstanceOf(
    Array,
  );
  const { loadEnv } = await import("../../packages/config/src/env.js");
  const { createExpertVerificationComposition } =
    await import("../../apps/api/src/expert-verification-composition.js");
  const { createResidentReviewNotificationLifecycle } =
    await import("../../apps/worker/src/resident-review-notification-composition.js");
  const config = loadEnv({
    DATABASE_URL: "postgresql://synthetic:synthetic@localhost/fixture",
    ALLOW_INSECURE_LOCAL_DATABASE: "true",
    EXPERT_APPLICANT_ENABLED: "true",
    EXPERT_PROMO_TELEGRAM_BOT_ID: valid.scope.botId,
    EXPERT_PROMO_TELEGRAM_BOT_KEY: valid.scope.botKey,
    EXPERT_PROMO_TELEGRAM_BOT_TOKEN: `${valid.scope.botId}:${"A".repeat(35)}`,
    EXPERT_PROMO_TELEGRAM_WEBHOOK_SECRET:
      "synthetic_remediation_secret_1234567890",
    EXPERT_PROMO_MESSAGING_CONSENT_POLICY_VERSION: "client-messaging-v1",
    EXPERT_VERIFICATION_ENABLED: "true",
    EXPERT_VERIFICATION_PAYMENT_MODE: "test",
    EXPERT_VERIFICATION_MESSAGING_CONSENT_POLICY_VERSION: "client-messaging-v1",
    RESIDENT_REVIEW_NOTIFICATIONS_ENABLED: "true",
  });
  expect(
    (
      await createExpertVerificationComposition(
        database.db,
        config,
      )!.service.detail(valid.session, valid.applicationId)
    ).kind,
  ).toBe("ok");
  const current = await valid.repo.mutate({
    ...valid.command(),
    action: "start",
  });
  const p = await valid.review.preview(valid.session, {
    applicationId: valid.applicationId,
    expectedRevision: current.revision,
    expectedGeneration: current.checkGeneration!,
    key: "REJECT_NICHE_MISMATCH",
  });
  const e = await valid.review.confirm(
    valid.session,
    valid.applicationId,
    p.previewId,
    p.hash,
  );
  const worker = createResidentReviewNotificationLifecycle(
    config,
    database.db,
    {
      async send(i) {
        return { botId: i.botId, chatId: i.chatId, messageId: "222" };
      },
    },
  )!;
  await worker.runOnce();
  worker.stopAccepting();
  expect(
    (
      await database.db.execute(
        sql`select status from resident_review_messages where event_id=${e.eventId}::uuid`,
      )
    ).rows[0]?.status,
  ).toBe("delivered");
});
it("R5 production calendar helper and eligibility cover month end, leap year and exact boundary", async () => {
  for (const [decision, deadline] of [
    ["2027-01-31T10:00:00Z", "2027-02-28T10:00:00Z"],
    ["2028-01-31T10:00:00Z", "2028-02-29T10:00:00Z"],
    ["2028-02-29T10:00:00Z", "2028-03-29T10:00:00Z"],
  ]) {
    const r = (
      await database.db.execute(
        sql`select resident_reapply_deadline(${decision}::timestamptz) deadline,resident_reapply_eligible(resident_reapply_deadline(${decision}::timestamptz),${deadline}::timestamptz-interval '1 microsecond') early,resident_reapply_eligible(resident_reapply_deadline(${decision}::timestamptz),${deadline}::timestamptz) exact`,
      )
    ).rows[0]!;
    expect(new Date(String(r.deadline)).toISOString()).toBe(
      new Date(deadline!).toISOString(),
    );
    expect(r.early).toBe(false);
    expect(r.exact).toBe(true);
  }
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
  const actual = (
    await database.db.execute(
      sql`select created_at,reapply_at,reapply_at=resident_reapply_deadline(created_at) genuine from resident_review_events where id=${e.eventId}::uuid`,
    )
  ).rows[0]!;
  expect(actual.genuine).toBe(true);
  const created = new Date(String(actual.created_at)),
    expected = new Date(created);
  expected.setUTCDate(1);
  expected.setUTCMonth(created.getUTCMonth() + 1);
  const last = new Date(
    Date.UTC(expected.getUTCFullYear(), expected.getUTCMonth() + 1, 0),
  ).getUTCDate();
  expected.setUTCDate(Math.min(created.getUTCDate(), last));
  expect(new Date(String(actual.reapply_at)).toISOString()).toBe(
    expected.toISOString(),
  );
  const definitions = (
    await database.db.execute(
      sql`select proname,pg_get_functiondef(oid) definition from pg_proc where proname in('resident_review_event_source','resident_verification_write_guard','resident_financial_attempt_source')`,
    )
  ).rows;
  for (const d of definitions)
    expect(String(d.definition)).toContain(
      d.proname === "resident_review_event_source"
        ? "resident_reapply_deadline"
        : "resident_reapply_eligible",
    );
});
it("R6 normal private ingress completes the current request and reapplies without rewriting history; R1 historical ambiguity remains closeable", async () => {
  const f = await submitted();
  const Fastify = createRequire(
    new URL("../../apps/api/package.json", import.meta.url),
  )(
    "fastify",
  ) as typeof import("../../apps/api/node_modules/fastify/fastify.js").default;
  const { loadEnv } = await import("../../packages/config/src/env.js");
  const { createExpertApplicantComposition } =
    await import("../../apps/api/src/expert-applicant-composition.js");
  const { expertApplicantTelegramRoutes } =
    await import("../../apps/api/src/routes/expert-applicant-telegram.js");
  const config = loadEnv({
    DATABASE_URL: "postgresql://synthetic:synthetic@localhost/fixture",
    ALLOW_INSECURE_LOCAL_DATABASE: "true",
    EXPERT_APPLICANT_ENABLED: "true",
    EXPERT_VERIFICATION_FORM_ENABLED: "true",
    EXPERT_SEPARATED_SALES_ENABLED: "true",
    EXPERT_PROMO_TELEGRAM_BOT_ID: f.scope.botId,
    EXPERT_PROMO_TELEGRAM_BOT_KEY: f.scope.botKey,
    EXPERT_PROMO_TELEGRAM_WEBHOOK_SECRET:
      "synthetic_remediation_secret_1234567890",
    EXPERT_PROMO_MESSAGING_CONSENT_POLICY_VERSION: "client-messaging-v1",
  });
  const app = Fastify({ logger: false });
  await app.register(expertApplicantTelegramRoutes, {
    enabled: true,
    capability: createExpertApplicantComposition(database.db, config)!,
  });
  let update = 8000;
  const send = async (text: string) => {
    const r = await app.inject({
      method: "POST",
      url: `/v1/webhooks/telegram/expert-promo/${f.scope.botKey}`,
      headers: {
        "x-telegram-bot-api-secret-token":
          config.expertApplicant!.webhookSecret,
      },
      payload: {
        update_id: update++,
        message: {
          from: { id: Number(f.scope.telegramUserId) },
          chat: { id: Number(f.scope.chatId), type: "private" },
          text,
        },
      },
    });
    expect(r.statusCode, r.body).toBe(200);
    return r.json();
  };
  try {
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
    await send(`/answer ${e.eventId} 1 Пять лет`);
    await send(`/answers_done ${randomUUID()}`);
    expect(
      (await f.repo.mutate({ ...f.command(), action: "start" })).status,
    ).toBe("INFO_REQUESTED");
    await send(`/answers_done ${e.eventId}`);
    const current = await f.repo.mutate({ ...f.command(), action: "start" });
    expect(current.status).toBe("UNDER_REVIEW");
    expect(current.checkGeneration).toBe(2);
    const refusal = await f.review.preview(f.session, {
      applicationId: f.applicationId,
      expectedRevision: current.revision,
      expectedGeneration: 2,
      key: "REJECT_INSUFFICIENT_PROOF",
    });
    const rejected = await f.review.confirm(
      f.session,
      f.applicationId,
      refusal.previewId,
      refusal.hash,
    );
    const { PostgresResidentReviewRepository } =
      await import("../../packages/db/src/repositories/resident-review-repository.js");
    const uncertain = new PostgresResidentReviewRepository(database.db, {
      providerMode: "test",
      messagingConsentPolicyVersion: "client-messaging-v1",
      notifier: {
        async send() {
          throw Error("ambiguous_test_outcome");
        },
      },
    });
    await uncertain.deliverMaterials(rejected.eventId, {
      signal: new AbortController().signal,
    });
    const before = (
      await database.db.execute(
        sql`select id,base_offer_shown_at from expert_sales_bases where user_id=${f.scope.userId}::uuid`,
      )
    ).rows;
    await send("/reapply");
    expect((await f.repo.mutate({ ...f.command(), action: "start" })).id).toBe(
      f.form.id,
    );
    await database.db.transaction(async (tx) => {
      await tx.execute(
        sql`alter table resident_review_events disable trigger resident_review_events_immutable`,
      );
      await tx.execute(
        sql`update resident_review_events set created_at=clock_timestamp()-interval '2 months',reapply_at=resident_reapply_deadline(clock_timestamp()-interval '2 months') where id=${rejected.eventId}::uuid`,
      );
      await tx.execute(
        sql`alter table resident_review_events enable trigger resident_review_events_immutable`,
      );
    });
    await send("/reapply");
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
    const { PostgresExpertVerificationRepository } =
      await import("../../packages/db/src/repositories/expert-verification-repository.js");
    const manager = new PostgresExpertVerificationRepository(database.db, {
      providerMode: "test",
      messagingConsentPolicyVersion: "client-messaging-v1",
    });
    expect(await manager.listQueue(f.session)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ applicationId: f.applicationId }),
      ]),
    );
    await expect(
      f.review.closeUnknown(f.session, f.applicationId, rejected.eventId),
    ).resolves.toMatchObject({ status: "closed_without_resend" });
    expect(
      (
        await database.db.execute(
          sql`select status from resident_review_messages where event_id=${rejected.eventId}::uuid`,
        )
      ).rows[0]?.status,
    ).toBe("cancelled");
  } finally {
    await app.close();
  }
});
