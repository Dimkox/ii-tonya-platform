import { sql } from "drizzle-orm";
import { CardMainPaymentError } from "./expert-card-main-command.js";
import {
  lockCardActivationGate,
  type ExpertCardTransaction,
} from "./expert-card-repository.js";
import type {
  MainCheckoutAdmission,
  MainCardAcceptance,
} from "./expert-card-main-gates.js";
import { lockClientConsentSubject } from "./client-consent-authority.js";

const uuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
export function scheduledMainInput(scheduleId: unknown, quoteId: unknown) {
  if (
    typeof scheduleId !== "string" ||
    scheduleId.length !== 36 ||
    !uuid.test(scheduleId) ||
    typeof quoteId !== "string" ||
    quoteId.length !== 36 ||
    !uuid.test(quoteId)
  )
    throw new CardMainPaymentError("card_main_invalid_request");
  return {
    scheduleId: scheduleId.toLowerCase(),
    quoteId: quoteId.toLowerCase(),
  };
}
export type ScheduledMainAdmission = MainCheckoutAdmission & {
  scheduleId: string;
};

/** Re-authorize from immutable owner schedule evidence. No synthetic Telegram
 * request or new explicit acceptance is created by this path. */
export async function beginScheduledMainCheckout(
  tx: ExpertCardTransaction,
  input: { scheduleId: string; quoteId: string },
  policy: {
    providerMode: "test" | "live";
    messagingConsentPolicyVersion: string;
  },
): Promise<ScheduledMainAdmission> {
  const fail = (): never => {
    throw new CardMainPaymentError("card_main_schedule_not_ready");
  };
  const subject = (
    await tx.execute<{ userId: string }>(
      sql`select user_id as "userId" from expert_offer_schedules where id=${input.scheduleId}::uuid`,
    )
  ).rows[0];
  if (!subject) return fail();
  await lockClientConsentSubject(tx, subject.userId);
  const schedule = (
    await tx.execute<{
      userId: string;
      applicationId: string;
      expertId: string;
      reviewId: string;
      revision: number;
      publicDigest: string;
      consentVersion: string;
    }>(sql`select s.user_id as "userId",s.application_id as "applicationId",a.expert_id as "expertId",a.review_id as "reviewId",a.revision,a.public_digest as "publicDigest",s.consent_version as "consentVersion"
    from expert_offer_schedules s join expert_card_main_acceptances a on a.id=s.original_acceptance_id and a.user_id=s.user_id and a.application_id=s.application_id and a.acceptance_source='explicit'
    join expert_campaign_quotes q on q.id=${input.quoteId}::uuid and q.user_id=s.user_id and q.term_months=s.term_months and q.tariff_version_id=s.tariff_version_id and q.profile_revision=s.profile_revision and expert_campaign_current_profile_valid(s.user_id,q.id)
    join users u on u.id=s.user_id and u.active
    where s.id=${input.scheduleId}::uuid and s.user_id=${subject.userId}::uuid and s.consent_version=${policy.messagingConsentPolicyVersion}
    and not exists(select 1 from expert_offer_schedules newer where newer.user_id=s.user_id and (newer.created_at,newer.id)>(s.created_at,s.id))
    and not exists(select 1 from expert_residency_orders o where o.expert_id=a.expert_id and o.status in('settled','refunded','charged_back'))
    and not exists(select 1 from expert_residency_lifecycle l where l.user_id=s.user_id and l.status in('paused','archived'))
    for update of s`)
  ).rows[0];
  if (!schedule) return fail();
  const gate = await lockCardActivationGate(tx, {
    applicationId: schedule.applicationId,
    userId: schedule.userId,
    reviewId: schedule.reviewId,
  });
  if (
    !gate ||
    gate.revision !== schedule.revision ||
    gate.publicDigest !== schedule.publicDigest ||
    gate.messagingConsentPolicyVersion !== schedule.consentVersion
  )
    return fail();
  const prior = (
    await tx.execute<MainCardAcceptance>(
      sql`select id,application_id as "applicationId",application_audit_id as "applicationAuditId",user_id as "userId",expert_id as "expertId",quote_id as "quoteId",review_id as "reviewId",review_audit_id as "reviewAuditId",revision,public_digest as "publicDigest" from expert_card_main_acceptances where user_id=${schedule.userId}::uuid and quote_id=${input.quoteId}::uuid and offer_schedule_id=${input.scheduleId}::uuid and acceptance_source='schedule' for update`,
    )
  ).rows[0];
  let acceptance = prior;
  if (!acceptance) {
    acceptance = (
      await tx.execute<MainCardAcceptance>(sql`insert into expert_card_main_acceptances(application_id,application_audit_id,user_id,expert_id,quote_id,review_id,review_audit_id,revision,public_digest,acceptance_source,offer_schedule_id)
      values(${gate.applicationId}::uuid,${gate.applicationId}::uuid,${schedule.userId}::uuid,${schedule.expertId}::uuid,${input.quoteId}::uuid,${gate.reviewId}::uuid,${gate.reviewId}::uuid,${gate.revision},${gate.publicDigest},'schedule',${input.scheduleId}::uuid)
      returning id,application_id as "applicationId",application_audit_id as "applicationAuditId",user_id as "userId",expert_id as "expertId",quote_id as "quoteId",review_id as "reviewId",review_audit_id as "reviewAuditId",revision,public_digest as "publicDigest"`)
    ).rows[0];
  }
  if (!acceptance) return fail();
  const existing = (
    await tx.execute<{ id: string }>(
      sql`select m.order_id as id from expert_card_main_orders m where m.acceptance_id=${acceptance.id}::uuid and m.user_id=${schedule.userId}::uuid`,
    )
  ).rows[0];
  return {
    scheduleId: input.scheduleId,
    request: Object.freeze({
      userId: schedule.userId,
      replay: !!existing,
      ...(existing ? { resultId: existing.id } : {}),
    }),
    acceptance,
    gate,
    providerMode: policy.providerMode,
    renewal: null,
  };
}
