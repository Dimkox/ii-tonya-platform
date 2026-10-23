import { createHash, randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  startExpertReferralTestDatabase,
  type ExpertReferralTestDatabase,
} from "../../packages/db/src/testkit/expert-referral.js";
import { PostgresExpertPromoRepository } from "../../packages/db/src/repositories/expert-promo-repository.js";
import { seedClientConsent } from "../../packages/db/src/testkit/client-consent.js";
let database: ExpertReferralTestDatabase;
let repo: PostgresExpertPromoRepository;
let sequence = 810000;
const digest = (text: string) =>
  createHash("sha256").update(text).digest("hex");
async function identity(
  botKey = "promo-fixture",
  external?: string,
  user?: string,
) {
  const userId = user ?? (await database.createUser());
  const telegramUserId = external ?? String(++sequence);
  await database.db.execute(
    sql`insert into channel_identities(user_id,provider,external_id,bot_key,external_chat_id,status) values(${userId}::uuid,'telegram',${telegramUserId},${botKey},${telegramUserId},'active')`,
  );
  if (!user) await seedClientConsent(database.db, userId, "client_messaging");
  return {
    userId,
    botKey,
    botId: "717171",
    telegramUserId,
    chatId: telegramUserId,
  };
}
function command<T extends object>(scope: T, refCode?: string) {
  const requestKey = randomUUID();
  return {
    ...scope,
    requestKey,
    requestDigest: digest(requestKey),
    ...(refCode ? { refCode } : {}),
  };
}
describe("Phase1 applicant promo PostgreSQL authority", () => {
  beforeAll(async () => {
    database = await startExpertReferralTestDatabase();
    repo = new PostgresExpertPromoRepository(database.db, {
      messagingConsentPolicyVersion: "client-messaging-v1",
    });
  }, 120000);
  afterAll(async () => {
    await database?.stop();
  }, 120000);
  it("registers one reusable owner code and replays exact bot/update requests", async () => {
    const owner = await identity();
    const input = command(owner);
    const first = await repo.register(input);
    const replay = await repo.register(input);
    expect(first.refCode).toMatch(/^promo_[0-9a-f]{32}$/u);
    expect(replay).toMatchObject({ refCode: first.refCode, replay: true });
    expect(await repo.register(command(owner))).toMatchObject({
      refCode: first.refCode,
      referralCount: 0,
      bonusPoints: 0,
      guideStatus: "none",
    });
    await expect(
      repo.register({ ...input, requestDigest: digest("changed") }),
    ).rejects.toThrow("promo_idempotency_conflict");
  });
  it("qualifies two unique identities exactly once under concurrency without financial grants", async () => {
    const owner = await identity();
    const code = (await repo.register(command(owner))).refCode;
    const first = await identity();
    const second = await identity();
    await Promise.all([
      repo.register(command(first, code)),
      repo.register(command(second, code)),
    ]);
    const status = await repo.register(command(owner));
    expect(status).toMatchObject({
      referralCount: 2,
      bonusPoints: 100,
      bonusStatus: "frozen",
      guideStatus: "waiting_content",
    });
    expect(
      (
        await database.db.execute(
          sql`select (select count(*)::int from expert_promo_guide_work where user_id=${owner.userId}::uuid) guides,(select count(*)::int from expert_promo_bonus_indications where user_id=${owner.userId}::uuid) indications,(select count(*)::int from expert_referral_ledger_entries) ledger`,
        )
      ).rows[0],
    ).toEqual({ guides: 1, indications: 1, ledger: 0 });
    expect(
      (
        await database.db.execute(
          sql`select delivered_at from expert_promo_guide_work where user_id=${owner.userId}::uuid`,
        )
      ).rows[0]?.delivered_at,
    ).toBeNull();
  });
  it("counts one Telegram identity across bot scopes and refuses user rebinding", async () => {
    const owner = await identity();
    const code = (await repo.register(command(owner))).refCode;
    const invitee = await identity();
    await repo.register(command(invitee, code));
    const anotherBot = await identity(
      "promo-fixture-two",
      invitee.telegramUserId,
      invitee.userId,
    );
    await repo.register(command(anotherBot, code));
    expect(await repo.register(command(owner))).toMatchObject({
      referralCount: 1,
    });
    const wrongUser = await identity(
      "promo-fixture-three",
      invitee.telegramUserId,
    );
    await expect(repo.register(command(wrongUser, code))).rejects.toThrow(
      "promo_identity_conflict",
    );
  });
  it("refuses self attribution, reattribution, unknown code and non-private identity", async () => {
    const owner = await identity();
    const code = (await repo.register(command(owner))).refCode;
    await expect(repo.register(command(owner, code))).rejects.toThrow(
      "promo_self_referral",
    );
    const other = await identity();
    const otherCode = (await repo.register(command(other))).refCode;
    const invitee = await identity();
    await repo.register(command(invitee, code));
    await expect(repo.register(command(invitee, otherCode))).rejects.toThrow(
      "promo_attribution_locked",
    );
    await expect(
      repo.register(
        command(await identity(), "promo_ffffffffffffffffffffffffffffffff"),
      ),
    ).rejects.toThrow("promo_code_unavailable");
    await expect(
      repo.register(command({ ...owner, chatId: "-999" })),
    ).rejects.toThrow("promo_identity_unavailable");
  });
  it("does not permit a late first attribution after un-referred registration", async () => {
    const owner = await identity();
    const code = (await repo.register(command(owner))).refCode;
    const invitee = await identity();
    await repo.register(command(invitee));
    await expect(repo.register(command(invitee, code))).rejects.toThrow(
      "promo_attribution_locked",
    );
  });
  it("requires original current consent and active owner", async () => {
    const owner = await identity();
    await database.db.execute(
      sql`update users set active=false where id=${owner.userId}::uuid`,
    );
    await expect(repo.register(command(owner))).rejects.toThrow(
      "promo_identity_unavailable",
    );
    const denied = await identity();
    await database.db.execute(
      sql`update consent_states set decision='revoked' where user_id=${denied.userId}::uuid`,
    );
    expect(await repo.resolve(denied)).toBeNull();
  });
  it("rejects unknown and foreign application quotes without creating manager work", async () => {
    const owner = await identity();
    await repo.register(command(owner));
    await expect(
      repo.createApplication({ ...command(owner), quoteId: randomUUID() }),
    ).rejects.toThrow("promo_quote_unavailable");
    expect(
      (
        await database.db.execute(
          sql`select count(*)::int n from expert_promo_manager_work where user_id=${owner.userId}::uuid`,
        )
      ).rows[0]?.n,
    ).toBe(0);
  });
  it("enrolls unknown private identities only through scoped original consent and retains first attribution", async () => {
    const owner = await identity();
    const code = (await repo.register(command(owner))).refCode;
    const second = await identity();
    const secondCode = (await repo.register(command(second))).refCode;
    const unknown = {
      botKey: "promo-new",
      botId: "717171",
      telegramUserId: String(++sequence),
      chatId: String(sequence),
    };
    const start = command(unknown, code);
    const presented = await repo.beginEnrollment(start);
    expect(presented.kind).toBe("consent_required");
    if (presented.kind !== "consent_required")
      throw new Error("fixture_document_missing");
    expect(await repo.beginEnrollment(start)).toEqual({
      kind: "consent_pending",
    });
    const unrelatedExternal = String(++sequence);
    await expect(
      repo.beginEnrollment({
        ...start,
        telegramUserId: unrelatedExternal,
        chatId: unrelatedExternal,
      }),
    ).rejects.toThrow("promo_idempotency_conflict");
    await expect(
      repo.beginEnrollment(command(unknown, secondCode)),
    ).rejects.toThrow("promo_attribution_locked");
    expect(await repo.register(command(owner))).toMatchObject({
      referralCount: 0,
    });
    await expect(repo.register(command(unknown))).rejects.toThrow(
      "promo_identity_unavailable",
    );
    await expect(
      repo.completeEnrollment({
        ...command({ ...unknown, botId: "999999" }),
        token: presented.token,
        decision: "granted",
      }),
    ).rejects.toThrow("promo_identity_unavailable");
    const consent = {
      ...command(unknown),
      token: presented.token,
      decision: "granted" as const,
    };
    expect(await repo.completeEnrollment(consent)).toEqual({
      kind: "granted",
      replay: false,
    });
    expect(await repo.completeEnrollment(consent)).toEqual({
      kind: "granted",
      replay: true,
    });
    expect(await repo.beginEnrollment(command(unknown))).toEqual({
      kind: "ready",
    });
    const registration = await repo.register(command(unknown));
    expect(registration.refCode).toMatch(/^promo_[0-9a-f]{32}$/u);
    expect(await repo.register(command(owner))).toMatchObject({
      referralCount: 1,
    });
    expect(await repo.register(command(second))).toMatchObject({
      referralCount: 0,
    });
  });
  it("does not revive blocked mappings or issue consent without approved content", async () => {
    const blocked = await identity();
    await database.db.execute(
      sql`update channel_identities set status='blocked' where user_id=${blocked.userId}::uuid`,
    );
    await expect(repo.beginEnrollment(command(blocked))).rejects.toThrow(
      "promo_identity_unavailable",
    );
    const empty = await startExpertReferralTestDatabase();
    const emptyRepo = new PostgresExpertPromoRepository(empty.db, {
      messagingConsentPolicyVersion: "client-messaging-v1",
    });
    const unknown = {
      botKey: "promo-wait",
      botId: "717171",
      telegramUserId: String(++sequence),
      chatId: String(sequence),
    };
    try {
      expect(await emptyRepo.beginEnrollment(command(unknown))).toEqual({
        kind: "waiting_content",
      });
      expect(
        (
          await empty.db.execute(
            sql`select count(*)::int n from channel_identities where external_id=${unknown.telegramUserId}`,
          )
        ).rows[0]?.n,
      ).toBe(1);
      expect(
        (
          await empty.db.execute(
            sql`select count(*)::int n from consent_presentations`,
          )
        ).rows[0]?.n,
      ).toBe(0);
    } finally {
      await empty.stop();
    }
  });
  it("reuses immutable campaign quotes and atomically enqueues masked manager work", async () => {
    const owner = await identity();
    await repo.register(command(owner));
    const tariff = await database.createResidencyTariff({
      tariffKey: "PRO",
      displayName: "PRO",
      priceMinor: 999000,
      durationSeconds: 2592000,
    });
    expect((await repo.listTariffs(command(owner))).tariffs).toContainEqual({
      id: tariff,
      displayName: "Про",
    });
    const input = {
      ...command(owner),
      tariffVersionId: tariff,
      termMonths: 3 as const,
    };
    const quote = await repo.createQuote(input);
    expect(quote).toMatchObject({
      userId: owner.userId,
      termMonths: 3,
      replay: false,
    });
    expect(await repo.createQuote(input)).toMatchObject({
      id: quote.id,
      replay: true,
    });
    await expect(
      repo.register({ ...input, requestDigest: digest("crossoperation") }),
    ).rejects.toThrow("promo_idempotency_conflict");
    const other = await identity();
    await repo.register(command(other));
    await expect(
      repo.createApplication({ ...command(other), quoteId: quote.id }),
    ).rejects.toThrow("promo_quote_unavailable");
    // A historical, already expired quote is authored as synthetic data through
    // every unchanged SQL source/arithmetic/FK guard; no trigger or time control.
    const expiredOwner = await identity();
    const expiredQuoteId = randomUUID();
    await database.db.transaction(async (tx) => {
      await tx.execute(
        sql`insert into expert_campaign_anchors(user_id,rule_version,calculation_timestamp) select ${expiredOwner.userId}::uuid,rule_version,calculation_timestamp-interval '1 hour' from expert_campaign_quotes where id=${quote.id}::uuid`,
      );
      await tx.execute(
        sql`insert into expert_campaign_quotes select (jsonb_populate_record(null::expert_campaign_quotes,to_jsonb(q)||jsonb_build_object('id',${expiredQuoteId}::uuid,'user_id',${expiredOwner.userId}::uuid,'idempotency_key',${randomUUID()}::text,'calculation_timestamp',q.calculation_timestamp-interval '1 hour','quoted_at',q.quoted_at-interval '1 hour','expires_at',q.expires_at-interval '1 hour'))).* from expert_campaign_quotes q where q.id=${quote.id}::uuid`,
      );
    });
    expect(
      (
        await database.db.execute(
          sql`select expires_at<clock_timestamp() expired from expert_campaign_quotes where id=${expiredQuoteId}::uuid`,
        )
      ).rows[0]?.expired,
    ).toBe(true);
    await expect(
      repo.createApplication({
        ...command(expiredOwner),
        quoteId: expiredQuoteId,
      }),
    ).rejects.toThrow("promo_quote_unavailable");
    const apply = { ...command(owner), quoteId: quote.id };
    const [first, duplicate] = await Promise.all([
      repo.createApplication(apply),
      repo.createApplication(apply),
    ]);
    expect(first.applicationId).toBe(duplicate.applicationId);
    expect([first.replay, duplicate.replay].sort()).toEqual([false, true]);
    expect(
      (
        await database.db.execute(
          sql`select application_id,user_id,status,content_slot from expert_promo_manager_work where user_id=${owner.userId}::uuid`,
        )
      ).rows,
    ).toEqual([
      {
        application_id: first.applicationId,
        user_id: owner.userId,
        status: "pending",
        content_slot: "TODO: Wait for Content Spec",
      },
    ]);
    expect(
      (
        await database.db.execute(
          sql`select count(*)::int n from experts where user_id=${owner.userId}::uuid`,
        )
      ).rows[0]?.n,
    ).toBe(0);
  });
  it("erases direct promo identity and queued work while preserving once-bound UUID tombstones", async () => {
    const owner = await identity();
    const originalStart = command(owner);
    const code = (await repo.register(originalStart)).refCode;
    const invitee = await identity();
    await repo.register(command(invitee, code));
    const second = await identity();
    await repo.register(command(second, code));
    const { PostgresPrivacyRepository } =
      await import("../../packages/db/src/repositories/privacy-repository.js");
    const privacy = new PostgresPrivacyRepository(database.db, {
      privacyMutationCapability: {
        enabled: true,
        captureManifests: async () =>
          ["object_store", "selarti", "planerka", "make_projection"].map(
            (processor) => ({
              processor: processor as
                "object_store" | "selarti" | "planerka" | "make_projection",
              ciphertext: `ciphertext:${processor}`,
              keyReference: `fixture:${processor}`,
              algorithm: "test-envelope-v1",
              version: "1",
              subjectDeletionKeyHash: `sha256:${processor}`,
            }),
          ),
        verifyEnvelope: () => true,
      },
    });
    await privacy.startErasureAtomically({
      targetUserId: owner.userId,
      correlationId: `promo-erase:${owner.userId}`,
      idempotencyKey: `promo-erase:${owner.userId}`,
      pseudonym: "hmac:test-promo-erasure",
    });
    expect(
      (
        await database.db.execute(
          sql`select identity_digest,erased_at is not null erased from expert_promo_registrations where user_id=${owner.userId}::uuid`,
        )
      ).rows[0],
    ).toEqual({ identity_digest: null, erased: true });
    expect(
      (
        await database.db.execute(
          sql`select count(*)::int n from expert_promo_guide_work where user_id=${owner.userId}::uuid`,
        )
      ).rows[0]?.n,
    ).toBe(0);
    expect(
      (
        await database.db.execute(
          sql`select referrer_user_id from expert_promo_registrations where user_id=${invitee.userId}::uuid`,
        )
      ).rows[0]?.referrer_user_id,
    ).toBe(owner.userId);
    expect(await repo.beginEnrollment(originalStart)).toEqual({
      kind: "consent_pending",
    });
    expect(
      (
        await database.db.execute(
          sql`select count(*)::int n from channel_identities where external_id=${owner.telegramUserId}`,
        )
      ).rows[0]?.n,
    ).toBe(0);
    const replacement = await identity();
    const newCode = (await repo.register(command(replacement))).refCode;
    await expect(repo.register(command(invitee, newCode))).rejects.toThrow(
      "promo_attribution_locked",
    );
    await expect(repo.register(command(owner))).rejects.toThrow(
      "promo_identity_unavailable",
    );
  });
  it("acknowledges a denied consent replay without reopening its blocked mapping", async () => {
    const unknown = {
      botKey: "promo-denied",
      botId: "717171",
      telegramUserId: String(++sequence),
      chatId: String(sequence),
    };
    const presented = await repo.beginEnrollment(command(unknown));
    if (presented.kind !== "consent_required")
      throw new Error("fixture_document_missing");
    const deny = {
      ...command(unknown),
      token: presented.token,
      decision: "denied" as const,
    };
    expect(await repo.completeEnrollment(deny)).toEqual({
      kind: "denied",
      replay: false,
    });
    expect(await repo.completeEnrollment(deny)).toEqual({
      kind: "denied",
      replay: true,
    });
    await expect(repo.register(command(unknown))).rejects.toThrow(
      "promo_identity_unavailable",
    );
  });
  it("retains the first candidate while legal content is absent and refreshes an expired pending window", async () => {
    const empty = await startExpertReferralTestDatabase();
    const emptyRepo = new PostgresExpertPromoRepository(empty.db, {
      messagingConsentPolicyVersion: "client-messaging-v1",
    });
    try {
      const owner = await empty.createUser();
      const other = await empty.createUser();
      const code = `promo_${"b".repeat(32)}`;
      const otherCode = `promo_${"c".repeat(32)}`;
      await empty.db.execute(
        sql`insert into expert_promo_codes(user_id,ref_code) values(${owner}::uuid,${code}),(${other}::uuid,${otherCode})`,
      );
      const unknown = {
        botKey: "promo-content-later",
        botId: "717171",
        telegramUserId: String(++sequence),
        chatId: String(sequence),
      };
      const first = command(unknown, code);
      expect(await emptyRepo.beginEnrollment(first)).toEqual({
        kind: "waiting_content",
      });
      const { PostgresConsentEvidenceRepository } =
        await import("../../packages/db/src/repositories/consent-evidence-repository.js");
      await new PostgresConsentEvidenceRepository(empty.db, {
        consentMutationCapability: { enabled: true },
      }).approveDocumentVersion({
        documentKey: "consent.client_messaging",
        title: "Synthetic approved notice",
        body: "Synthetic approved notice fixture",
        approvedBy: "test-fixture",
      });
      expect(await emptyRepo.beginEnrollment(first)).toEqual({
        kind: "consent_pending",
      });
      await expect(
        emptyRepo.beginEnrollment(command(unknown, otherCode)),
      ).rejects.toThrow("promo_attribution_locked");
      await empty.db.execute(
        sql`update expert_promo_enrollments en set created_at=now()-interval '2 days',expires_at=now()-interval '1 day' from channel_identities ci where ci.id=en.channel_identity_id and ci.external_id=${unknown.telegramUserId}`,
      );
      const presentation = await emptyRepo.beginEnrollment(command(unknown));
      if (presentation.kind !== "consent_required")
        throw new Error("fixture_document_missing");
      await emptyRepo.completeEnrollment({
        ...command(unknown),
        token: presentation.token,
        decision: "granted",
      });
      await emptyRepo.register(command(unknown));
      expect(
        (
          await empty.db.execute(
            sql`select referrer_user_id from expert_promo_registrations where identity_digest=${digest(`telegram:${unknown.telegramUserId}`)}`,
          )
        ).rows[0]?.referrer_user_id,
      ).toBe(owner);
      expect(
        (
          await empty.db.execute(
            sql`select count(*)::int n from expert_promo_registrations where referrer_user_id=${other}::uuid`,
          )
        ).rows[0]?.n,
      ).toBe(0);
    } finally {
      await empty.stop();
    }
  });
  it("does not resurrect work when the inviter becomes inactive while registration waits", async () => {
    const owner = await identity();
    const code = (await repo.register(command(owner))).refCode;
    await repo.register(command(await identity(), code));
    const second = await identity();
    const blocker = await database.db.$client.connect();
    try {
      await blocker.query("begin");
      await blocker.query("update users set active=false where id=$1", [
        owner.userId,
      ]);
      const pending = repo.register(command(second, code));
      // A real database row lock forces the eligibility read to wait, then recheck.
      for (let i = 0; i < 100; i++) {
        const waiting = await database.db.$client.query(
          "select count(*)::int n from pg_stat_activity where datname=current_database() and wait_event_type='Lock' and query like 'select c.user_id%'",
        );
        if (waiting.rows[0]?.n > 0) break;
        await new Promise((resolve) => setTimeout(resolve, 2));
      }
      await blocker.query("commit");
      await expect(pending).rejects.toThrow("promo_code_unavailable");
      expect(
        (
          await database.db.execute(
            sql`select count(*)::int n from expert_promo_guide_work where user_id=${owner.userId}::uuid`,
          )
        ).rows[0]?.n,
      ).toBe(0);
      expect(
        (
          await database.db.execute(
            sql`select count(*)::int n from expert_promo_bonus_indications where user_id=${owner.userId}::uuid`,
          )
        ).rows[0]?.n,
      ).toBe(0);
    } finally {
      await blocker.query("rollback");
      blocker.release();
    }
  });
  it("database constraints reject forged guide success and owner rebinding", async () => {
    const owner = await identity();
    await repo.register(command(owner));
    await expect(
      database.db.execute(
        sql`insert into expert_promo_guide_work(user_id,status) values(${owner.userId}::uuid,'delivered')`,
      ),
    ).rejects.toThrow();
    await expect(
      database.db.execute(
        sql`update expert_promo_codes set ref_code=${`promo_${"a".repeat(32)}`} where user_id=${owner.userId}::uuid`,
      ),
    ).rejects.toThrow();
    await expect(
      database.db.execute(
        sql`update expert_promo_registrations set referrer_user_id=${(await identity()).userId}::uuid where user_id=${owner.userId}::uuid`,
      ),
    ).rejects.toThrow();
  });
});
