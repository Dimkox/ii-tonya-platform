import { saveExpertOfferProfileInTransaction } from "./expert-offer-v2.js";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { PostgresExpertCampaignQuoteRepository } from "./expert-campaign-quote-repository.js";
import { PostgresConsentEvidenceRepository } from "./consent-evidence-repository.js";
import type { DrizzleDb } from "../client.js";
import {
  captureClientConsentAuthority,
  lockClientConsentSubject,
} from "./client-consent-authority.js";

type Executor = Pick<DrizzleDb, "execute">;
export interface ExpertPromoScope {
  botKey: string;
  botId: string;
  telegramUserId: string;
  chatId: string;
}
export interface ExpertPromoCommand extends ExpertPromoScope {
  requestKey: string;
  requestDigest: string;
}
export interface ExpertPromoRegistration {
  userId: string;
  refCode: string;
  referralCount: number;
  bonusPoints: 0 | 100;
  bonusStatus: "none" | "frozen" | "superseded";
  guideStatus:
    "none" | "waiting_content" | "pending" | "delivered" | "cancelled";
  replay: boolean;
}
const fail = (code: string): never => {
  throw new Error(code);
};
const digest = (value: string) =>
  createHash("sha256").update(value).digest("hex");
const valid = (s: ExpertPromoScope) =>
  /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(s.botKey) &&
  /^[1-9]\d{0,19}$/u.test(s.botId) &&
  /^[1-9]\d{0,19}$/u.test(s.telegramUserId) &&
  s.chatId === s.telegramUserId;
function command(input: ExpertPromoCommand) {
  // Capture values before awaiting. No caller-owned mutable object enters a transaction.
  const copy = {
    botKey: input.botKey,
    botId: input.botId,
    telegramUserId: input.telegramUserId,
    chatId: input.chatId,
    requestKey: input.requestKey,
    requestDigest: input.requestDigest,
  };
  if (!valid(copy)) fail("promo_identity_unavailable");
  if (
    typeof copy.requestKey !== "string" ||
    !/^[\x21-\x7E]{1,200}$/u.test(copy.requestKey) ||
    !/^[0-9a-f]{64}$/u.test(copy.requestDigest)
  )
    fail("promo_invalid_request");
  return copy;
}

export class PostgresExpertPromoRepository {
  constructor(
    private readonly db: DrizzleDb,
    private readonly consent: {
      messagingConsentPolicyVersion: string;
      verificationFormEnabled?: boolean;
    },
  ) {}
  private async identity(
    tx: Executor,
    scope: ExpertPromoScope,
  ): Promise<string | null> {
    if (!valid(scope)) return null;
    const rows = (
      await tx.execute<{ userId: string }>(
        sql`select ci.user_id as "userId" from channel_identities ci join users u on u.id=ci.user_id and u.active=true where ci.provider='telegram' and ci.bot_key=${scope.botKey} and ci.external_id=${scope.telegramUserId} and ci.external_chat_id=${scope.chatId} and ci.status='active' order by ci.id limit 2`,
      )
    ).rows;
    if (rows.length !== 1) return null;
    const userId = rows[0]!.userId;
    await lockClientConsentSubject(tx, userId);
    const authority = await captureClientConsentAuthority(tx, {
      subjectId: userId,
      botKey: scope.botKey,
      chatId: scope.chatId,
      externalUserId: scope.telegramUserId,
      messagingPolicyVersion: this.consent.messagingConsentPolicyVersion,
    });
    if (authority && this.consent.verificationFormEnabled) {
      await tx.execute(
        sql`insert into residents_applications(user_id,bot_id,bot_key,channel_identity_id,telegram_user_id,chat_id) select ${userId}::uuid,${scope.botId},${scope.botKey},(select id from channel_identities where user_id=${userId}::uuid and provider='telegram' and bot_key=${scope.botKey} and external_id=${scope.telegramUserId} and external_chat_id=${scope.chatId} and status='active'),${scope.telegramUserId},${scope.chatId} where not exists(select 1 from expert_campaign_quotes where user_id=${userId}::uuid) and not exists(select 1 from experts e join expert_residency_orders o on o.expert_id=e.id where e.user_id=${userId}::uuid and o.status='settled') on conflict(user_id) do nothing`,
      );
    }
    return authority ? userId : null;
  }
  async resolve(scope: ExpertPromoScope): Promise<{ userId: string } | null> {
    const copy = { ...scope };
    return this.db.transaction(async (tx) => {
      await tx.execute(sql`set local statement_timeout='2000ms'`);
      await tx.execute(sql`set local lock_timeout='1000ms'`);
      const userId = await this.identity(tx, copy);
      return userId ? { userId } : null;
    });
  }
  private async replay(
    tx: Executor,
    input: ExpertPromoCommand,
    userId: string,
    operation:
      | "register"
      | "application"
      | "quote"
      | "enroll"
      | "consent"
      | "tariffs"
      | "profile",
  ) {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${`promo-request:${input.botId}:${input.requestKey}`},0))`,
    );
    const row = (
      await tx.execute<{
        userId: string;
        requestDigest: string;
        operation: string;
      }>(
        sql`select user_id as "userId",request_digest as "requestDigest",operation from expert_promo_requests where bot_id=${input.botId} and request_key=${input.requestKey}`,
      )
    ).rows[0];
    if (
      row &&
      (row.userId !== userId ||
        row.requestDigest !== input.requestDigest ||
        row.operation !== operation)
    )
      fail("promo_idempotency_conflict");
    return !!row;
  }
  private async saveRequest(
    tx: Executor,
    input: ExpertPromoCommand,
    userId: string,
    operation: string,
  ) {
    await tx.execute(
      sql`insert into expert_promo_requests(bot_id,request_key,user_id,request_digest,operation) values(${input.botId},${input.requestKey},${userId}::uuid,${input.requestDigest},${operation})`,
    );
  }
  private async status(
    tx: Executor,
    userId: string,
    replay: boolean,
  ): Promise<ExpertPromoRegistration> {
    const row = (
      await tx.execute<{
        refCode: string;
        referralCount: number;
        hasBonus: boolean;
        superseded: boolean;
        guideStatus: ExpertPromoRegistration["guideStatus"];
      }>(
        sql`select c.ref_code as "refCode",(select count(*)::int from expert_promo_registrations r join users u on u.id=r.user_id and u.active=true where r.referrer_user_id=c.user_id) as "referralCount", exists(select 1 from expert_promo_bonus_indications b where b.user_id=c.user_id) as "hasBonus", (exists(select 1 from expert_referral_reward_grants g join experts e on e.id=g.expert_id where e.user_id=c.user_id and g.amount_minor=100000) OR exists(select 1 from expert_referral_reward_maturities m join experts e on e.id=m.inviter_expert_id where e.user_id=c.user_id)) as superseded, coalesce((select status from expert_promo_guide_work w where w.user_id=c.user_id),'none') as "guideStatus" from expert_promo_codes c where c.user_id=${userId}::uuid`,
      )
    ).rows[0];
    if (!row) return fail("promo_registration_unavailable");
    return {
      userId,
      refCode: row.refCode,
      referralCount: row.referralCount,
      bonusPoints: row.hasBonus && !row.superseded ? 100 : 0,
      bonusStatus: row.hasBonus
        ? row.superseded
          ? "superseded"
          : "frozen"
        : "none",
      guideStatus: row.guideStatus,
      replay,
    };
  }
  async register(
    raw: ExpertPromoCommand & { refCode?: string },
  ): Promise<ExpertPromoRegistration> {
    const input = command(raw);
    let refCode = raw.refCode;
    if (
      refCode !== undefined &&
      (typeof refCode !== "string" || !/^promo_[0-9a-f]{32}$/u.test(refCode))
    )
      fail("promo_invalid_request");
    const identityDigest = digest(`telegram:${input.telegramUserId}`);
    return this.db.transaction(async (tx) => {
      await tx.execute(sql`set local statement_timeout='2000ms'`);
      await tx.execute(sql`set local lock_timeout='1000ms'`);
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${`promo-request:${input.botId}:${input.requestKey}`},0))`,
      );
      const userId = await this.identity(tx, input);
      if (!userId) return fail("promo_identity_unavailable");
      // One identity lock across all bot IDs; protects immutable identity/owner binding.
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${`promo-identity:${identityDigest}`},0))`,
      );
      const replay = await this.replay(tx, input, userId, "register");
      if (replay) return this.status(tx, userId, true);
      const enrollment = (
        await tx.execute<{ refCode: string | null }>(
          sql`select ref_code as "refCode" from expert_promo_enrollments where user_id=${userId}::uuid and status='granted'`,
        )
      ).rows[0];
      const registered = (
        await tx.execute<{ userId: string; referrerId: string | null }>(
          sql`select user_id as "userId",referrer_user_id as "referrerId" from expert_promo_registrations where identity_digest=${identityDigest} or user_id=${userId}::uuid`,
        )
      ).rows;
      if (
        registered.length > 1 ||
        (registered[0] && registered[0].userId !== userId)
      )
        fail("promo_identity_conflict");
      // The pending entry candidate is consumed only by the first registration.
      // Later plain /start must still work after the inviter/code is erased.
      if (!registered.length && enrollment?.refCode) {
        if (refCode && refCode !== enrollment.refCode)
          fail("promo_attribution_locked");
        refCode = enrollment.refCode;
      }
      let referrerId: string | null = null;
      if (refCode) {
        const owner = (
          await tx.execute<{ userId: string }>(
            sql`select c.user_id as "userId" from expert_promo_codes c join users u on u.id=c.user_id and u.active=true where c.ref_code=${refCode} for share of c,u`,
          )
        ).rows[0];
        if (!owner) fail("promo_code_unavailable");
        referrerId = owner!.userId;
        if (referrerId === userId) fail("promo_self_referral");
        if (registered[0] && registered[0].referrerId !== referrerId)
          fail("promo_attribution_locked");
      }
      if (!registered.length) {
        await tx.execute(
          sql`insert into expert_promo_registrations(identity_digest,user_id,referrer_user_id) values(${identityDigest},${userId}::uuid,${referrerId}::uuid)`,
        );
      }
      await tx.execute(
        sql`insert into expert_promo_codes(user_id,ref_code) values(${userId}::uuid,${`promo_${randomBytes(16).toString("hex")}`}) on conflict(user_id) do nothing`,
      );
      if (referrerId) {
        // Owner serialization is separate from consent locks, avoiding cross-referral
        // lock-order cycles. READ COMMITTED sees the winner after this wait.
        await tx.execute(
          sql`select pg_advisory_xact_lock(hashtextextended(${`promo-referrer:${referrerId}`},0))`,
        );
        const count = (
          await tx.execute<{ count: number }>(
            sql`select count(*)::int count from expert_promo_registrations r join users u on u.id=r.user_id and u.active=true where r.referrer_user_id=${referrerId}::uuid`,
          )
        ).rows[0]!.count;
        if (count >= 2) {
          const created = (
            await tx.execute<{ userId: string }>(
              sql`insert into expert_promo_guide_work(user_id,content_slot) values(${referrerId}::uuid,'TODO: Wait for PDF') on conflict do nothing returning user_id as "userId"`,
            )
          ).rows[0];
          if (created) {
            const eventId = randomUUID();
            await tx.execute(
              sql`insert into expert_promo_ready_logs(id,event) values(${eventId}::uuid,'Ready to send')`,
            );
            await tx.execute(
              sql`update expert_promo_guide_work set ready_log_event_id=${eventId}::uuid where user_id=${referrerId}::uuid`,
            );
          }
          await tx.execute(
            sql`insert into expert_promo_bonus_indications(user_id) values(${referrerId}::uuid) on conflict do nothing`,
          );
        }
      }
      await this.saveRequest(tx, input, userId, "register");
      return this.status(tx, userId, false);
    });
  }
  async listTariffs(raw: ExpertPromoCommand) {
    const input = command(raw);
    return this.db.transaction(async (tx) => {
      await tx.execute(sql`set local statement_timeout='2000ms'`);
      await tx.execute(sql`set local lock_timeout='1000ms'`);
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${`promo-request:${input.botId}:${input.requestKey}`},0))`,
      );
      const userId = await this.identity(tx, input);
      if (!userId) return fail("promo_identity_unavailable");
      if (
        !(
          await tx.execute<{ ok: boolean }>(
            sql`select resident_verification_price_allowed(${userId}::uuid) as ok`,
          )
        ).rows[0]?.ok
      )
        fail("resident_verification_required");
      const replay = await this.replay(tx, input, userId, "tariffs");
      const tariffs = (
        await tx.execute<{ id: string; displayName: string }>(
          sql`select id,display_name as "displayName" from expert_residency_tariff_versions where commercial_policy_version='expert_residency_v2' and currency='RUB' and duration_seconds=2592000 and active_from<=clock_timestamp() and active_to>clock_timestamp() order by id limit 20`,
        )
      ).rows;
      if (!replay) await this.saveRequest(tx, input, userId, "tariffs");
      return { tariffs, replay };
    });
  }

  async saveProfile(
    raw: ExpertPromoCommand & {
      cityCode: string;
      millionCity: boolean;
      serviceFormat: "online_only" | "offline" | "hybrid";
      ticketMinor: string;
      participantKind: "expert" | "space";
    },
  ) {
    const input = command(raw);
    const qualifications = {
      cityCode: raw.cityCode,
      millionCity: raw.millionCity,
      serviceFormat: raw.serviceFormat,
      ticketMinor: raw.ticketMinor,
      participantKind: raw.participantKind,
    };
    return this.db.transaction(async (tx) => {
      const userId = await this.identity(tx, input);
      if (!userId) return fail("promo_identity_unavailable");
      if (
        !(
          await tx.execute<{ ok: boolean }>(
            sql`select resident_verification_price_allowed(${userId}::uuid) as ok`,
          )
        ).rows[0]?.ok
      )
        fail("resident_verification_required");
      const replay = await this.replay(tx, input, userId, "profile");
      const profile = await saveExpertOfferProfileInTransaction(tx, {
        ...qualifications,
        userId,
        idempotencyKey: `promo:${input.botId}:${input.requestKey}`,
      });
      if (!replay) await this.saveRequest(tx, input, userId, "profile");
      return { ...profile, replay };
    });
  }

  async createQuote(
    raw: ExpertPromoCommand & { tariffVersionId: string; termMonths: 1 | 3 },
  ) {
    const input = command(raw);
    const tariffVersionId = raw.tariffVersionId;
    const termMonths = raw.termMonths;
    return this.db.transaction(async (tx) => {
      await tx.execute(sql`set local statement_timeout='2000ms'`);
      await tx.execute(sql`set local lock_timeout='1000ms'`);
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${`promo-request:${input.botId}:${input.requestKey}`},0))`,
      );
      const userId = await this.identity(tx, input);
      if (!userId) return fail("promo_identity_unavailable");
      if (
        !(
          await tx.execute<{ ok: boolean }>(
            sql`select resident_verification_price_allowed(${userId}::uuid) as ok`,
          )
        ).rows[0]?.ok
      )
        fail("resident_verification_required");
      const replay = await this.replay(tx, input, userId, "quote");
      const quote = await new PostgresExpertCampaignQuoteRepository(
        this.db,
      ).createCurrentQuoteInTransaction(tx, {
        userId,
        tariffVersionId,
        termMonths,
        idempotencyKey: `promo:${input.botId}:${input.requestKey}`,
      });
      if (!replay) await this.saveRequest(tx, input, userId, "quote");
      return { ...quote, replay };
    });
  }

  async beginEnrollment(raw: ExpertPromoCommand & { refCode?: string }) {
    const input = command(raw);
    const refCode = raw.refCode;
    if (refCode !== undefined && !/^promo_[0-9a-f]{32}$/u.test(refCode))
      fail("promo_invalid_request");
    return this.db.transaction(async (tx) => {
      await tx.execute(sql`set local statement_timeout='2000ms'`);
      await tx.execute(sql`set local lock_timeout='1000ms'`);
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${`promo-request:${input.botId}:${input.requestKey}`},0))`,
      );
      const receipt = (
        await tx.execute<{
          userId: string | null;
          requestDigest: string | null;
          operation: string;
        }>(
          sql`select user_id as "userId",request_digest as "requestDigest",operation from expert_promo_requests where bot_id=${input.botId} and request_key=${input.requestKey}`,
        )
      ).rows[0];
      if (receipt && receipt.userId === null)
        return { kind: "consent_pending" as const };
      if (receipt && receipt.operation === "enroll") {
        const bound = (
          await tx.execute<{ userId: string }>(
            sql`select user_id as "userId" from channel_identities where provider='telegram' and bot_key=${input.botKey} and external_id=${input.telegramUserId} and external_chat_id=${input.chatId} and status in ('unresolved','active','blocked') order by id limit 2`,
          )
        ).rows;
        if (
          receipt.requestDigest !== input.requestDigest ||
          bound.length !== 1 ||
          bound[0]!.userId !== receipt.userId
        )
          fail("promo_idempotency_conflict");
        return { kind: "consent_pending" as const };
      }
      if (await this.identity(tx, input)) return { kind: "ready" as const };
      await tx.execute(sql`lock table consent_document_versions in share mode`);
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${`promo-enroll:${input.telegramUserId}`},0))`,
      );
      const mapped = (
        await tx.execute<{
          id: string;
          userId: string;
          botKey: string;
          chatId: string;
          status: string;
          active: boolean;
        }>(
          sql`select ci.id,ci.user_id as "userId",ci.bot_key as "botKey",ci.external_chat_id as "chatId",ci.status,u.active from channel_identities ci join users u on u.id=ci.user_id where ci.provider='telegram' and ci.external_id=${input.telegramUserId} order by ci.id for share of ci,u`,
        )
      ).rows;
      let existing = mapped[0];
      if (
        mapped.length > 1 ||
        (existing &&
          (existing.botKey !== input.botKey ||
            existing.chatId !== input.chatId ||
            existing.status !== "unresolved" ||
            !existing.active))
      )
        fail("promo_identity_unavailable");
      const document = (
        await tx.execute<{ id: string; title: string; body: string }>(
          sql`select id,title,body from consent_document_versions where document_key='consent.client_messaging' and status='approved' and effective_at<=clock_timestamp() order by version desc limit 1`,
        )
      ).rows[0];
      if (!existing) {
        const user = (
          await tx.execute<{ id: string }>(
            sql`insert into users default values returning id`,
          )
        ).rows[0]!;
        const mapping = (
          await tx.execute<{ id: string }>(
            sql`insert into channel_identities(user_id,provider,external_id,bot_key,external_chat_id,status) values(${user.id}::uuid,'telegram',${input.telegramUserId},${input.botKey},${input.chatId},'unresolved') returning id`,
          )
        ).rows[0]!;
        existing = {
          id: mapping.id,
          userId: user.id,
          botKey: input.botKey,
          chatId: input.chatId,
          status: "unresolved",
          active: true,
        };
        await tx.execute(
          sql`insert into expert_promo_enrollments(user_id,channel_identity_id,bot_id,ref_code) values(${user.id}::uuid,${mapping.id}::uuid,${input.botId},${refCode ?? null})`,
        );
      }
      const enrollment = (
        await tx.execute<{
          status: string;
          valid: boolean;
          botId: string;
          refCode: string | null;
        }>(
          sql`select status,expires_at>clock_timestamp() as valid,bot_id as "botId",ref_code as "refCode" from expert_promo_enrollments where user_id=${existing.userId}::uuid for update`,
        )
      ).rows[0];
      if (
        !enrollment ||
        enrollment.status !== "pending" ||
        enrollment.botId !== input.botId
      )
        fail("promo_identity_unavailable");
      if (refCode !== undefined && refCode !== enrollment!.refCode)
        fail("promo_attribution_locked");
      if (!enrollment!.valid)
        await tx.execute(
          sql`update expert_promo_enrollments set created_at=now(),expires_at=now()+interval '24 hours' where user_id=${existing.userId}::uuid`,
        );
      if (await this.replay(tx, input, existing.userId, "enroll"))
        return { kind: "consent_pending" as const };
      if (!document || document.title.length + document.body.length > 3400) {
        await this.saveRequest(tx, input, existing.userId, "enroll");
        return { kind: "waiting_content" as const };
      }
      const evidence = new PostgresConsentEvidenceRepository(this.db, {
        consentMutationCapability: { enabled: true },
        requiredPolicyVersions: {
          client_messaging: this.consent.messagingConsentPolicyVersion,
        },
      });
      await tx.execute(
        sql`update consent_presentations set invalidated_at=clock_timestamp() where user_id=${existing.userId}::uuid and purpose='client_messaging' and consumed_at is null and invalidated_at is null`,
      );
      const presentation = await evidence.issuePresentationInTransaction(tx, {
        userId: existing.userId,
        purpose: "client_messaging",
        channel: "telegram",
        documentKey: "consent.client_messaging",
      });
      await tx.execute(
        sql`update expert_promo_enrollments set presentation_id=${presentation.presentationId}::uuid,policy_version=${presentation.policyVersion} where user_id=${existing.userId}::uuid`,
      );
      await this.saveRequest(tx, input, existing.userId, "enroll");
      return {
        kind: "consent_required" as const,
        token: presentation.token,
        policyVersion: presentation.policyVersion,
        document: presentation.document,
      };
    });
  }

  async completeEnrollment(
    raw: ExpertPromoCommand & { token: string; decision: "granted" | "denied" },
  ) {
    const input = command(raw);
    const token = raw.token;
    const decision = raw.decision;
    if (
      typeof token !== "string" ||
      !/^[A-Za-z0-9_-]{43}$/u.test(token) ||
      (decision !== "granted" && decision !== "denied")
    )
      fail("promo_invalid_request");
    return this.db.transaction(
      async (tx) => {
        await tx.execute(sql`set local statement_timeout='2000ms'`);
        await tx.execute(sql`set local lock_timeout='1000ms'`);
        await tx.execute(
          sql`lock table consent_document_versions in share mode`,
        );
        const rows = (
          await tx.execute<{
            userId: string;
            identityId: string;
            policyVersion: string;
            status: string;
            tokenDigest: string;
            valid: boolean;
            mappingStatus: string;
          }>(
            sql`select en.user_id as "userId",ci.id as "identityId",en.policy_version as "policyVersion",en.status,ci.status as "mappingStatus",p.token_digest as "tokenDigest",en.expires_at>clock_timestamp() as valid from expert_promo_enrollments en join channel_identities ci on ci.id=en.channel_identity_id join users u on u.id=ci.user_id and u.active=true join consent_presentations p on p.id=en.presentation_id where ci.provider='telegram' and ci.bot_key=${input.botKey} and ci.external_id=${input.telegramUserId} and ci.external_chat_id=${input.chatId} and en.bot_id=${input.botId} and ci.status in ('unresolved','active','blocked')`,
          )
        ).rows;
        const row = rows[0];
        if (
          rows.length !== 1 ||
          !row ||
          row.tokenDigest !== `sha256:${digest(token)}`
        )
          return fail("promo_identity_unavailable");
        await lockClientConsentSubject(tx, row.userId);
        const replay = await this.replay(tx, input, row.userId, "consent");
        if (replay) {
          if (row.status !== decision) fail("promo_idempotency_conflict");
          return { kind: decision, replay: true };
        }
        if (
          row.status !== "pending" ||
          row.mappingStatus !== "unresolved" ||
          !row.valid
        )
          fail("promo_consent_unavailable");
        const evidence = new PostgresConsentEvidenceRepository(this.db, {
          consentMutationCapability: { enabled: true },
          requiredPolicyVersions: {
            client_messaging: this.consent.messagingConsentPolicyVersion,
          },
        });
        await evidence.recordDecisionInTransaction(tx, {
          token,
          userId: row.userId,
          purpose: "client_messaging",
          decision,
          policyVersion: row.policyVersion,
          correlationId: `promo-consent:${digest(`${input.botId}:${input.requestKey}`)}`,
        });
        // Only the exact unresolved enrollment mapping is promoted after original evidence.
        await tx.execute(
          sql`update channel_identities set status=${decision === "granted" ? "active" : "blocked"} where id=${row.identityId}::uuid and status='unresolved'`,
        );
        await tx.execute(
          sql`update expert_promo_enrollments set status=${decision} where user_id=${row.userId}::uuid`,
        );
        if (decision === "granted" && this.consent.verificationFormEnabled) {
          if (!(await this.identity(tx, input)))
            fail("promo_identity_unavailable");
        }
        await this.saveRequest(tx, input, row.userId, "consent");
        return { kind: decision, replay: false };
      },
      { isolationLevel: "serializable" },
    );
  }

  async createApplication(raw: ExpertPromoCommand & { quoteId: string }) {
    const input = command(raw);
    const quoteId = raw.quoteId;
    if (
      typeof quoteId !== "string" ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u.test(
        quoteId,
      )
    )
      fail("promo_invalid_request");
    return this.db.transaction(async (tx) => {
      await tx.execute(sql`set local statement_timeout='2000ms'`);
      await tx.execute(sql`set local lock_timeout='1000ms'`);
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${`promo-request:${input.botId}:${input.requestKey}`},0))`,
      );
      const userId = await this.identity(tx, input);
      if (!userId) return fail("promo_identity_unavailable");
      if (
        !(
          await tx.execute<{ ok: boolean }>(
            sql`select resident_verification_price_allowed(${userId}::uuid) as ok`,
          )
        ).rows[0]?.ok
      )
        fail("resident_verification_required");
      const replay = await this.replay(tx, input, userId, "application");
      const prior = (
        await tx.execute<{ id: string; quoteId: string; status: string }>(
          sql`select id,campaign_quote_id as "quoteId",verification_status as status from expert_onboarding_applications where user_id=${userId}::uuid for update`,
        )
      ).rows[0];
      if (prior) {
        if (prior.quoteId !== quoteId || prior.status !== "pending")
          fail("promo_application_locked");
        if (!replay) await this.saveRequest(tx, input, userId, "application");
        return {
          applicationId: prior.id,
          userId,
          quoteId,
          status: prior.status as "pending",
          replay,
        };
      }
      if (replay) return fail("promo_application_unavailable");
      const quote = (
        await tx.execute<{ id: string }>(
          sql`select id from expert_campaign_quotes where id=${quoteId}::uuid and user_id=${userId}::uuid and term_months in (1,3) for share`,
        )
      ).rows[0];
      if (!quote) fail("promo_quote_unavailable");
      const fresh = (
        await tx.execute<{ valid: boolean }>(
          sql`select quoted_at<=clock_timestamp() and expires_at>clock_timestamp() as valid from expert_campaign_quotes where id=${quoteId}::uuid`,
        )
      ).rows[0];
      if (!fresh?.valid) fail("promo_quote_unavailable");
      const application = (
        await tx.execute<{ id: string }>(
          sql`insert into expert_onboarding_applications(user_id,campaign_quote_id) values(${userId}::uuid,${quoteId}::uuid) returning id`,
        )
      ).rows[0]!;
      await tx.execute(
        sql`insert into expert_promo_manager_work(application_id,user_id) values(${application.id}::uuid,${userId}::uuid)`,
      );
      await this.saveRequest(tx, input, userId, "application");
      return {
        applicationId: application.id,
        userId,
        quoteId,
        status: "pending" as const,
        replay: false,
      };
    });
  }
}
