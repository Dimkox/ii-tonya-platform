import { randomUUID } from "node:crypto";
import {
  residentPolicy,
  type ResidentPolicy,
} from "../../packages/domain/src/resident-verification-form.js";
import { sql } from "drizzle-orm";
import { beforeAll, afterAll, describe, expect, it } from "vitest";
import {
  startExpertReferralTestDatabase,
  type ExpertReferralTestDatabase,
} from "../../packages/db/src/testkit/expert-referral.js";
import { seedClientConsent } from "../../packages/db/src/testkit/client-consent.js";
import { PostgresResidentVerificationRepository } from "../../packages/db/src/repositories/resident-verification-repository.js";
let database: ExpertReferralTestDatabase;
let repo: PostgresResidentVerificationRepository;
const command = <T extends object>(scope: T) => ({
  ...scope,
  requestKey: randomUUID(),
  requestDigest: "a".repeat(64),
});
// These cases exercise the preserved V1 form contract after V2 became the default.
// Seed a historical initial row explicitly; never weaken current admission or triggers.
async function owner(
  consent = true,
  legacyPolicy: ResidentPolicy | false = residentPolicy,
) {
  const userId = await database.createUser();
  const telegramUserId = String(Math.floor(Math.random() * 1e12) + 1);
  await database.db.execute(
    sql`insert into channel_identities(user_id,provider,external_id,external_chat_id,bot_key,status) values(${userId}::uuid,'telegram',${telegramUserId},${telegramUserId},'resident-promo','active')`,
  );
  if (consent) await seedClientConsent(database.db, userId, "client_messaging");
  if (consent && legacyPolicy) {
    await database.db.execute(sql`
      insert into residents_applications(
        user_id,bot_id,bot_key,channel_identity_id,telegram_user_id,chat_id,
        form_version,policy_version,education_requirement
      ) select ${userId}::uuid,'717171','resident-promo',id,${telegramUserId},${telegramUserId},
        1,${legacyPolicy.version},${legacyPolicy.education}
      from channel_identities where user_id=${userId}::uuid and bot_key='resident-promo'
    `);
  }
  return {
    userId,
    botId: "717171",
    botKey: "resident-promo",
    telegramUserId,
    chatId: telegramUserId,
  };
}
const complete = {
  primaryRole: "OTHER",
  roles: ["OTHER"],
  category: "BASIC",
  tax: "INDIVIDUAL",
  city: "Москва",
  socialLinks: ["https://example.com/me"],
  motivation: "Участие",
  path: "Практика",
  cases: "Опыт",
};
beforeAll(async () => {
  database = await startExpertReferralTestDatabase();
  repo = new PostgresResidentVerificationRepository(database.db, {
    botId: "717171",
    botKey: "resident-promo",
    messagingConsentPolicyVersion: "client-messaging-v1",
  });
}, 120000);
afterAll(async () => {
  await database?.stop();
}, 120000);
describe("resident verification PostgreSQL authority", () => {
  it("saves partial drafts with scoped replay and revision conflict", async () => {
    const scope = await owner();
    const start = command(scope);
    const first = await repo.mutate({ ...start, action: "start" });
    expect(first.revision).toBe(0);
    expect(await repo.mutate({ ...start, action: "start" })).toMatchObject({
      revision: 0,
      replay: true,
    });
    const patched = await repo.mutate({
      ...command(scope),
      action: "patch",
      expectedRevision: 0,
      patch: { roles: ["CENTER"], primaryRole: "CENTER" },
    });
    expect(patched.draft.roles).toEqual(["CENTER"]);
    await expect(
      repo.mutate({
        ...command(scope),
        action: "patch",
        expectedRevision: 0,
        patch: { city: "Казань" },
      }),
    ).rejects.toThrow("resident_revision_conflict");
    await expect(
      repo.mutate({ ...start, requestDigest: "b".repeat(64), action: "start" }),
    ).rejects.toThrow("resident_idempotency_conflict");
    await expect(
      repo.mutate({ ...command(scope), botId: "999", action: "start" }),
    ).rejects.toThrow("resident_identity_unavailable");
  });
  it("denies absent consent and cross-owner callback application IDs", async () => {
    await expect(
      repo.mutate({ ...command(await owner(false)), action: "start" }),
    ).rejects.toThrow("resident_identity_unavailable");
    const a = await repo.mutate({ ...command(await owner()), action: "start" });
    await expect(
      repo.mutate({
        ...command(await owner()),
        action: "patch",
        applicationId: a.id,
        expectedRevision: 0,
        patch: { city: "Москва" },
      }),
    ).rejects.toThrow("resident_application_unavailable");
  });
  it("submits one frozen revision, pending checks, no prices and no outcome authority", async () => {
    const scope = await owner();
    const a = await repo.mutate({ ...command(scope), action: "start" });
    await expect(
      repo.mutate({ ...command(scope), action: "submit", expectedRevision: 0 }),
    ).rejects.toThrow("resident_incomplete");
    await repo.mutate({
      ...command(scope),
      action: "patch",
      expectedRevision: 0,
      patch: complete,
    });
    const request = {
      ...command(scope),
      action: "submit" as const,
      expectedRevision: 1,
    };
    const result = await repo.mutate(request);
    expect(result).toMatchObject({
      status: "UNDER_REVIEW",
      progress: "AUTO_CHECK",
      revision: 2,
    });
    expect(await repo.mutate(request)).toMatchObject({
      revision: 2,
      replay: true,
    });
    expect(
      (
        await database.db.execute(
          sql`select status,education_result,social_result from resident_verification_check_work where application_id=${a.id}::uuid`,
        )
      ).rows,
    ).toEqual([
      {
        status: "pending",
        education_result: "unknown",
        social_result: "pending",
      },
    ]);
    await expect(
      database.db.execute(
        sql`update residents_applications set status='APPROVED_BASIC' where id=${a.id}::uuid`,
      ),
    ).rejects.toThrow();
    await expect(
      database.db.execute(
        sql`update residents_applications set draft='{}'::jsonb where id=${a.id}::uuid`,
      ),
    ).rejects.toThrow();
    expect(
      (
        await database.db.execute(
          sql`select count(*)::int n from expert_campaign_anchors where user_id=${scope.userId}::uuid`,
        )
      ).rows[0]?.n,
    ).toBe(0);
  });
  it("rejects SQL-invalid drafts and incomplete direct SQL submission", async () => {
    const a = await repo.mutate({ ...command(await owner()), action: "start" });
    for (const draft of [
      { roles: ["EXPERT", "EXPERT"] },
      { tax: null },
      { city: "x".repeat(121) },
      { status: "APPROVED_BASIC" },
    ])
      await expect(
        database.db.execute(
          sql`update residents_applications set draft=${JSON.stringify(draft)}::jsonb,revision=revision+1 where id=${a.id}::uuid`,
        ),
      ).rejects.toThrow();
    await expect(
      database.db.execute(
        sql`update residents_applications set status='UNDER_REVIEW',progress='AUTO_CHECK',submitted_draft=draft,submitted_at=clock_timestamp(),revision=revision+1 where id=${a.id}::uuid`,
      ),
    ).rejects.toThrow();
  });
});

describe("resident intake privacy and pricing boundaries", () => {
  it("fences direct pricing with the flag off after intake and retains cohort after consent revocation", async () => {
    const { PostgresExpertPromoRepository } =
      await import("../../packages/db/src/repositories/expert-promo-repository.js");
    const scope = await owner();
    await repo.mutate({ ...command(scope), action: "start" });
    expect(
      (
        await database.db.execute(
          sql`select current_verification_stage from users where id=${scope.userId}::uuid`,
        )
      ).rows[0]?.current_verification_stage,
    ).toBe("FORM_FILLING");
    const disabled = new PostgresExpertPromoRepository(database.db, {
      messagingConsentPolicyVersion: "client-messaging-v1",
      verificationFormEnabled: false,
    });
    await expect(disabled.listTariffs(command(scope))).rejects.toThrow(
      "resident_verification_required",
    );
    await expect(
      disabled.createQuote({
        ...command(scope),
        tariffVersionId: randomUUID(),
        termMonths: 1,
      }),
    ).rejects.toThrow("resident_verification_required");
    await expect(
      disabled.createApplication({ ...command(scope), quoteId: randomUUID() }),
    ).rejects.toThrow("resident_verification_required");
    const { PostgresPrivacyRepository } =
      await import("../../packages/db/src/repositories/privacy-repository.js");
    const privacy = new PostgresPrivacyRepository(database.db, {
      privacyMutationCapability: { enabled: true },
    });
    await privacy.withdrawConsentAtomically({
      targetUserId: scope.userId,
      purpose: "client_messaging",
      policyVersion: "client-messaging-v1",
      correlationId: `resident-revoke:${scope.userId}`,
    });
    expect(
      (
        await database.db.execute(
          sql`select count(*)::int n from residents_applications where user_id=${scope.userId}::uuid`,
        )
      ).rows[0]?.n,
    ).toBe(0);
    expect(
      (
        await database.db.execute(
          sql`select resident_verification_price_allowed(${scope.userId}::uuid) ok`,
        )
      ).rows[0]?.ok,
    ).toBe(false);
    await expect(
      repo.mutate({ ...command(scope), action: "start" }),
    ).rejects.toThrow("resident_identity_unavailable");
  });
  it("actual erasure deletes drafts, media, updates and work while tombstoning replay", async () => {
    const scope = await owner();
    const start = { ...command(scope), action: "start" as const };
    await repo.mutate(start);
    await repo.mutate({
      ...command(scope),
      action: "patch",
      expectedRevision: 0,
      patch: {
        ...complete,
        education: [
          {
            kind: "document",
            fileId: "private-sensitive",
            mimeType: "application/pdf",
            size: 100,
          },
        ],
      },
    });
    await repo.mutate({
      ...command(scope),
      action: "submit",
      expectedRevision: 1,
    });
    expect(
      (
        await database.db.execute(
          sql`select current_verification_stage from users where id=${scope.userId}::uuid`,
        )
      ).rows[0]?.current_verification_stage,
    ).toBe("AUTO_CHECK");
    await repo.mutate({
      ...command(scope),
      action: "followup",
      expectedRevision: 2,
      answer: "Личное дополнение",
      documents: [
        {
          kind: "document",
          fileId: "private_erasure_supplement",
          mimeType: null,
          size: null,
          caption: "Частное дополнение",
        },
      ],
    });
    const { PostgresPrivacyRepository } =
      await import("../../packages/db/src/repositories/privacy-repository.js");
    const privacy = new PostgresPrivacyRepository(database.db, {
      privacyMutationCapability: {
        enabled: true,
        captureManifests: async () =>
          (
            ["object_store", "selarti", "planerka", "make_projection"] as const
          ).map((processor) => ({
            processor,
            ciphertext: `synthetic:${processor}`,
            keyReference: `synthetic-key:${processor}`,
            algorithm: "test-envelope-v1",
            version: "1",
            subjectDeletionKeyHash: `sha256:synthetic-${processor}`,
          })),
        verifyEnvelope: () => true,
      },
    });
    await privacy.startErasureAtomically({
      targetUserId: scope.userId,
      correlationId: `resident-erase:${scope.userId}`,
      idempotencyKey: randomUUID(),
      pseudonym: "hmac:resident-test",
    });
    expect(
      (
        await database.db.execute(
          sql`select (select count(*)::int from residents_applications where user_id=${scope.userId}::uuid) apps,(select count(*)::int from resident_verification_application_updates where user_id=${scope.userId}::uuid) updates,(select count(*)::int from resident_verification_check_work where user_id=${scope.userId}::uuid) work,(select count(*)::int from resident_verification_requests where user_id=${scope.userId}::uuid or (result is not null and erased_at is not null)) pii`,
        )
      ).rows[0],
    ).toEqual({ apps: 0, updates: 0, work: 0, pii: 0 });
    expect(
      (
        await database.db.execute(
          sql`select current_verification_stage from users where id=${scope.userId}::uuid`,
        )
      ).rows[0]?.current_verification_stage,
    ).toBe("NONE");
    await expect(repo.mutate(start)).rejects.toThrow(
      "resident_identity_unavailable",
    );
  });
  it("applies server-versioned required education in the real service and SQL submission guard", async () => {
    const { createResidentVerificationService } =
      await import("../../packages/application/src/resident-verification-service.js");
    const policy = {
      version: "required_fixture_v1",
      education: "required" as const,
    };
    const required = new PostgresResidentVerificationRepository(database.db, {
      botId: "717171",
      botKey: "resident-promo",
      messagingConsentPolicyVersion: "client-messaging-v1",
      fieldPolicy: policy,
    });
    const scope = await owner(true, policy);
    const a = await required.mutate({ ...command(scope), action: "start" });
    await required.mutate({
      ...command(scope),
      action: "patch",
      expectedRevision: 0,
      patch: {
        ...complete,
        primaryRole: "EXPERT",
        roles: ["EXPERT"],
        specialization: "Практика",
        averageCheckMinor: "100000",
      },
    });
    await expect(
      required.mutate({
        ...command(scope),
        action: "submit",
        expectedRevision: 1,
      }),
    ).rejects.toThrow("resident_incomplete");
    await expect(
      database.db.execute(
        sql`update residents_applications set status='UNDER_REVIEW',progress='AUTO_CHECK',submitted_draft=draft,submitted_at=clock_timestamp(),revision=revision+1 where id=${a.id}::uuid`,
      ),
    ).rejects.toThrow();
    const service = createResidentVerificationService({
      enabled: true,
      repository: required,
      policy,
    });
    const response = await service.handle({
      ...scope,
      updateId: 555,
      text: "",
      media: {
        kind: "document",
        fileId: "private-education",
        mimeType: "application/pdf",
        size: 123,
      },
    });
    expect(response?.status).toBe("handled");
    expect(
      await required.mutate({
        ...command(scope),
        action: "submit",
        expectedRevision: 2,
      }),
    ).toMatchObject({ status: "UNDER_REVIEW" });
  });
});

let formUpdateSequence = 6000;
describe("real form with durable repository for every role", () => {
  it.each([
    "EXPERT",
    "CENTER",
    "ORGANIZER",
    "EDU_PROJECT",
    "ESOTERIC",
    "OTHER",
  ])("completes %s without invoice or resident activation", async (role) => {
    const { createResidentVerificationService } =
      await import("../../packages/application/src/resident-verification-service.js");
    const scope = await owner();
    const service = createResidentVerificationService({
      enabled: true,
      repository: repo,
    });

    const send = (text: string, extra: object = {}) =>
      service.handle({
        ...scope,
        updateId: formUpdateSequence++,
        text,
        ...extra,
      });
    await send("/verification");
    let s = await repo.mutate({ ...command(scope), action: "start" });
    const click = async (action: string) => {
      s = await repo.mutate({ ...command(scope), action: "start" });
      return send("", { callbackData: `rv:${s.id}:${s.revision}:${action}` });
    };
    await click(`r:${role}`);
    const primary = await click("next");
    expect(JSON.stringify(primary)).toContain(`p:${role}`);
    await click(`p:${role}`);
    await click("c:BOTH");
    await click("t:INDIVIDUAL");
    await send("Москва");
    await send("https://example.com/resident");
    await send("Хочу участвовать");
    if (role === "EXPERT") {
      await send("Практика");
      await send("15000,01");
    }
    if (role === "CENTER") {
      await send("", {
        media: {
          kind: "document",
          fileId: "private-property",
          mimeType: null,
          size: null,
          caption: "Частный документ",
        },
      });
      await send("20");
      await click("a:none");
      await click("next");
    }
    if (role === "ESOTERIC" || role === "OTHER") {
      await send("Профессиональный путь");
      await send("Кейсы из практики");
    }
    const submitted = await click("submit");
    expect(submitted?.status).toBe("handled");
    expect(JSON.stringify(submitted)).toContain("не подтверждены");
    const state = (
      await database.db.execute(
        sql`select status,role_type,target_category,tax_status,location_city,social_links_json,motivation_text,system_check_result,manager_notes from residents_applications where user_id=${scope.userId}::uuid`,
      )
    ).rows[0];
    expect(state).toMatchObject({
      status: "UNDER_REVIEW",
      role_type: role,
      target_category: "BOTH",
      tax_status: "INDIVIDUAL",
      location_city: "Москва",
      social_links_json: { "example.com": ["https://example.com/resident"] },
      motivation_text: "Хочу участвовать",
      system_check_result: {
        education: "unknown",
        social: "pending",
        upload: "pending_upload",
      },
      manager_notes: null,
    });
    expect(
      (
        await database.db.execute(
          sql`select (select count(*)::int from expert_onboarding_invoices where user_id=${scope.userId}::uuid) invoices,(select count(*)::int from expert_campaign_quotes where user_id=${scope.userId}::uuid) quotes,(select count(*)::int from experts where user_id=${scope.userId}::uuid) experts`,
        )
      ).rows[0],
    ).toEqual({ invoices: 0, quotes: 0, experts: 0 });
  });
  it("serializes concurrent submission to a single check work record", async () => {
    const scope = await owner();
    await repo.mutate({ ...command(scope), action: "start" });
    await repo.mutate({
      ...command(scope),
      action: "patch",
      expectedRevision: 0,
      patch: complete,
    });
    const outcomes = await Promise.allSettled([
      repo.mutate({ ...command(scope), action: "submit", expectedRevision: 1 }),
      repo.mutate({ ...command(scope), action: "submit", expectedRevision: 1 }),
    ]);
    expect(outcomes.filter((v) => v.status === "fulfilled")).toHaveLength(1);
    expect(
      (
        await database.db.execute(
          sql`select count(*)::int n from resident_verification_check_work where user_id=${scope.userId}::uuid`,
        )
      ).rows[0]?.n,
    ).toBe(1);
  });
});

it("classifies enabled registration atomically against a first quote and preserves already issued offers", async () => {
  const { PostgresExpertPromoRepository } =
    await import("../../packages/db/src/repositories/expert-promo-repository.js");
  const { PostgresExpertCampaignQuoteRepository } =
    await import("../../packages/db/src/repositories/expert-campaign-quote-repository.js");
  const tariff = await database.createResidencyTariff({
    tariffKey: "PRO",
    displayName: "PRO",
    priceMinor: 999000,
    durationSeconds: 2592000,
  });
  const quotes = new PostgresExpertCampaignQuoteRepository(database.db);
  const enabled = new PostgresExpertPromoRepository(database.db, {
    messagingConsentPolicyVersion: "client-messaging-v1",
    verificationFormEnabled: true,
  });
  const legacy = await owner(true, false);
  const original = await quotes.createQuote({
    userId: legacy.userId,
    tariffVersionId: tariff,
    termMonths: 1,
    idempotencyKey: randomUUID(),
  });
  await enabled.register(command(legacy));
  expect(
    (await enabled.listTariffs(command(legacy))).tariffs.length,
  ).toBeGreaterThan(0);
  await expect(
    repo.mutate({ ...command(legacy), action: "start" }),
  ).rejects.toThrow("resident_legacy_flow");
  expect(
    (
      await database.db.execute(
        sql`select to_char(calculation_timestamp at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as calculation_timestamp from expert_campaign_quotes where id=${original.id}::uuid`,
      )
    ).rows[0]?.calculation_timestamp,
  ).toEqual(original.calculationTimestamp);
  const fresh = await owner(true, false);
  await enabled.register(command(fresh));
  // The first transaction owns the shared subject barrier before the quote is launched.
  // Both repositories and the SQL admission trigger must preserve this ordering.
  await expect(
    quotes.createQuote({
      userId: fresh.userId,
      tariffVersionId: tariff,
      termMonths: 1,
      idempotencyKey: randomUUID(),
    }),
  ).rejects.toThrow();
  const concurrent = await owner(true, false);
  await Promise.allSettled([
    enabled.register(command(concurrent)),
    quotes.createQuote({
      userId: concurrent.userId,
      tariffVersionId: tariff,
      termMonths: 1,
      idempotencyKey: randomUUID(),
    }),
  ]);
  const state = (
    await database.db.execute(
      sql`select (select count(*)::int from residents_applications where user_id=${concurrent.userId}::uuid) apps,(select count(*)::int from expert_campaign_quotes where user_id=${concurrent.userId}::uuid) quotes`,
    )
  ).rows[0]!;
  expect(Number(state.apps) + Number(state.quotes)).toBe(1);
});

describe("remediation PostgreSQL regressions", () => {
  it("preserves explicit primary deletion and normalizes inline and text role changes with exact replay", async () => {
    const { createResidentVerificationService } =
      await import("../../packages/application/src/resident-verification-service.js");
    for (const mode of ["inline", "text"]) {
      const scope = await owner();
      await repo.mutate({ ...command(scope), action: "start" });
      await repo.mutate({
        ...command(scope),
        action: "patch",
        expectedRevision: 0,
        patch: {
          ...complete,
          roles: ["EXPERT"],
          primaryRole: "EXPERT",
          specialization: "Сохранить",
          averageCheckMinor: "1500000",
        },
      });
      const service = createResidentVerificationService({
        enabled: true,
        repository: repo,
      });
      let updateId = mode === "inline" ? 100000 : 101000;
      const click = async (op: string) => {
        const s = await repo.mutate({ ...command(scope), action: "start" });
        return service.handle({
          ...scope,
          updateId: updateId++,
          text: "",
          callbackData: `rv:${s.id}:${s.revision}:${op}`,
        });
      };
      if (mode === "inline") {
        await click("r:OTHER");
        await click("r:EXPERT");
        const q = await click("next");
        expect(JSON.stringify(q)).toContain("p:OTHER");
      } else {
        const request = {
          ...scope,
          updateId: updateId++,
          text: "/set roles OTHER",
        };
        const first = await service.handle(request);
        expect(JSON.stringify(first)).toContain("p:OTHER");
        expect(await service.handle(request)).toEqual(first);
      }
      const cleared = await repo.mutate({ ...command(scope), action: "start" });
      expect(cleared.draft).toMatchObject({
        roles: ["OTHER"],
        city: "Москва",
        specialization: "Сохранить",
      });
      expect(cleared.draft.primaryRole).toBeUndefined();
      await click("p:OTHER");
      expect(
        (await repo.mutate({ ...command(scope), action: "start" })).draft
          .primaryRole,
      ).toBe("OTHER");
    }
  });
  it("keeps policy-version and requirement mismatches read-only", async () => {
    const scope = await owner();
    const original = await repo.mutate({ ...command(scope), action: "start" });
    const baseline = (
      await database.db.execute(
        sql`select revision,draft,(select count(*)::int from resident_verification_application_updates where application_id=${original.id}::uuid) updates from residents_applications where id=${original.id}::uuid`,
      )
    ).rows[0];
    for (const policy of [
      { version: "changed_v2", education: "unknown_manual_review" as const },
      {
        version: "resident_education_unknown_v1",
        education: "required" as const,
      },
    ]) {
      const other = new PostgresResidentVerificationRepository(database.db, {
        botId: scope.botId,
        botKey: scope.botKey,
        messagingConsentPolicyVersion: "client-messaging-v1",
        fieldPolicy: policy,
      });
      await expect(
        other.mutate({
          ...command(scope),
          action: "patch",
          expectedRevision: 0,
          patch: { city: "Уфа" },
        }),
      ).rejects.toThrow("resident_policy_conflict");
      expect(
        (
          await database.db.execute(
            sql`select revision,draft,(select count(*)::int from resident_verification_application_updates where application_id=${original.id}::uuid) updates from residents_applications where id=${original.id}::uuid`,
          )
        ).rows[0],
      ).toEqual(baseline);
    }
  });
  it("stores bounded post-submit text and file supplements while freezing submitted facts", async () => {
    const scope = await owner();
    await repo.mutate({ ...command(scope), action: "start" });
    await repo.mutate({
      ...command(scope),
      action: "patch",
      expectedRevision: 0,
      patch: complete,
    });
    const submitted = await repo.mutate({
      ...command(scope),
      action: "submit",
      expectedRevision: 1,
    });
    const { createResidentVerificationService } =
      await import("../../packages/application/src/resident-verification-service.js");
    const service = createResidentVerificationService({
      enabled: true,
      repository: repo,
    });
    expect(
      (await service.handle({ ...scope, updateId: 102000, text: "Дополнение" }))
        ?.status,
    ).toBe("handled");
    const document = {
      kind: "document" as const,
      fileId: "private_followup",
      mimeType: null,
      size: null,
      caption: "Частная подпись",
    };
    const request = {
      ...scope,
      updateId: 102001,
      text: "Частная подпись",
      media: document,
    };
    const reply = await service.handle(request);
    expect(reply?.status).toBe("handled");
    expect(await service.handle(request)).toEqual(reply);
    const stored = (
      await database.db.execute(
        sql`select revision,draft,submitted_draft from residents_applications where id=${submitted.id}::uuid`,
      )
    ).rows[0]!;
    expect(stored).toMatchObject({
      revision: 4,
      draft: complete,
      submitted_draft: complete,
    });
    const updates = (
      await database.db.execute(
        sql`select answers from resident_verification_application_updates where application_id=${submitted.id}::uuid and kind='followup' order by revision`,
      )
    ).rows;
    expect(updates).toEqual([
      { answers: { answer: "Дополнение" } },
      { answers: { answer: "Частная подпись", documents: [document] } },
    ]);
    expect(
      (await service.handle({ ...scope, updateId: 102002, text: " \n " }))
        ?.status,
    ).toBe("handled");
    expect(
      (await repo.mutate({ ...command(scope), action: "start" })).revision,
    ).toBe(4);
  });
  it("rejects shared prohibited URL/text/caption cases in SQL and accepts normalized uppercase HTTPS", async () => {
    const scope = await owner();
    const a = await repo.mutate({ ...command(scope), action: "start" });
    for (const draft of [
      { socialLinks: ["https://name:secret@example.com/me"] },
      { socialLinks: ["https://example.com/white space"] },
      { socialLinks: ["https://example.com\\evil"] },
      { city: "Москва\u0001" },
      { motivation: "a\u0085b" },
      {
        education: [
          {
            kind: "document",
            fileId: "private",
            mimeType: null,
            size: null,
            caption: "a\u0001b",
          },
        ],
      },
    ])
      await expect(
        database.db.execute(
          sql`update residents_applications set draft=${JSON.stringify(draft)}::jsonb,revision=revision+1 where id=${a.id}::uuid`,
        ),
      ).rejects.toThrow();
    const saved = await repo.mutate({
      ...command(scope),
      action: "patch",
      expectedRevision: 0,
      patch: { socialLinks: ["HTTPS://Example.COM/Profile"] },
    });
    expect(saved.draft.socialLinks).toEqual(["https://example.com/Profile"]);
    expect(
      (
        await database.db.execute(
          sql`select social_links_json from residents_applications where id=${a.id}::uuid`,
        )
      ).rows[0]?.social_links_json,
    ).toEqual({ "example.com": ["https://example.com/Profile"] });
  });
  it("bounds cumulative caption bytes before SQL and preserves the previous draft", async () => {
    const scope = await owner();
    await repo.mutate({ ...command(scope), action: "start" });
    const docs = Array.from({ length: 10 }, (_, i) => ({
      kind: "document",
      fileId: `private_${i}`,
      mimeType: null,
      size: null,
      caption: "я".repeat(3000),
    }));
    const before = await repo.mutate({
      ...command(scope),
      action: "patch",
      expectedRevision: 0,
      patch: { education: docs },
    });
    await expect(
      repo.mutate({
        ...command(scope),
        action: "patch",
        expectedRevision: 1,
        patch: { propertyEvidence: docs },
      }),
    ).rejects.toThrow("resident_draft_too_large");
    expect(
      await repo.mutate({ ...command(scope), action: "start" }),
    ).toMatchObject({ revision: 1, draft: before.draft });
  });
});

it("remediation: document correction recovers after ten refs and the subject index covers erasure", async () => {
  const { createResidentVerificationService } =
    await import("../../packages/application/src/resident-verification-service.js");
  const scope = await owner();
  let id = 103000;
  await repo.mutate({ ...command(scope), action: "start" });
  let s = await repo.mutate({
    ...command(scope),
    action: "patch",
    expectedRevision: 0,
    patch: {
      roles: ["EXPERT"],
      primaryRole: "EXPERT",
      category: "BASIC",
      tax: "IP",
    },
  });
  const service = createResidentVerificationService({
    enabled: true,
    repository: repo,
  });
  const wrong = await service.handle({
    ...scope,
    updateId: id++,
    text: "",
    media: {
      kind: "document",
      fileId: "wrong_cursor",
      mimeType: null,
      size: null,
    },
  });
  expect(wrong?.status).toBe("handled");
  expect(
    (await repo.mutate({ ...command(scope), action: "start" })).revision,
  ).toBe(1);
  const click = async (op: string) => {
    s = await repo.mutate({ ...command(scope), action: "start" });
    return service.handle({
      ...scope,
      updateId: id++,
      text: "",
      callbackData: `rv:${s.id}:${s.revision}:${op}`,
    });
  };
  await click("e:d");
  s = await repo.mutate({ ...command(scope), action: "start" });
  await repo.mutate({
    ...command(scope),
    action: "patch",
    expectedRevision: s.revision,
    field: "education",
    patch: {
      education: Array.from({ length: 10 }, (_, i) => ({
        kind: "document",
        fileId: `old_${i}`,
        mimeType: null,
        size: null,
      })),
    },
  });
  await click("rm:d_9");
  expect(
    (await repo.mutate({ ...command(scope), action: "start" })).draft.education,
  ).toHaveLength(9);
  await service.handle({
    ...scope,
    updateId: id++,
    text: "",
    media: {
      kind: "document",
      fileId: "replacement",
      mimeType: null,
      size: null,
      caption: "Новый документ",
    },
  });
  expect(
    (await repo.mutate({ ...command(scope), action: "start" })).draft.education,
  ).toHaveLength(10);
  await click("replace:d");
  expect(
    (await repo.mutate({ ...command(scope), action: "start" })).draft.education,
  ).toEqual([]);
  await service.handle({
    ...scope,
    updateId: id++,
    text: "",
    media: { kind: "document", fileId: "last", mimeType: null, size: null },
  });
  await click("clear:d");
  await click("back");
  const resumed = await repo.mutate({ ...command(scope), action: "start" });
  expect(resumed.currentField).toBeNull();
  expect(resumed.draft.education).toEqual([]);
  const index = (
    await database.db.execute(
      sql`select indexdef from pg_indexes where schemaname='public' and indexname='resident_verification_requests_subject_idx'`,
    )
  ).rows[0]?.indexdef;
  expect(index).toContain("(user_id)");
  expect(index).toContain("WHERE (user_id IS NOT NULL)");
});
