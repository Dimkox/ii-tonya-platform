import { restoreSettledMainCardProjection } from "./expert-residency-main-projection.js";
import { acceptMainCardQuote } from "./expert-card-main-acceptance.js";
import { lockClientConsentSubject } from "./client-consent-authority.js";
import {
  lockRenewalBillForCheckout,
  finishRenewalBillOrder,
  lockResidencyLifecycle,
} from "./expert-residency-lifecycle-repository.js";
import { sql } from "drizzle-orm";
import {
  assertVerifiedExpertResidencyPaymentEvent,
  type VerifiedExpertResidencyPaymentEvent,
} from "@ii-tonya/integrations";
import {
  beginCardRequest,
  finishCardRequest,
  lockCardActivationGate,
  type ExpertCardTransaction,
  type CardActivationGate,
} from "./expert-card-repository.js";
import {
  CardMainPaymentError,
  type MainCardScope,
  type MainCardCheckoutCommand,
} from "./expert-card-main-command.js";
const fail = (code: string): never => {
  throw new CardMainPaymentError(code);
};
export interface MainCardAcceptance extends Record<string, unknown> {
  id: string;
  applicationId: string;
  applicationAuditId: string;
  userId: string;
  expertId: string;
  quoteId: string;
  reviewId: string;
  reviewAuditId: string;
  revision: number;
  publicDigest: string;
}
export async function lockMainFrameGate(
  tx: ExpertCardTransaction,
  userId: string,
  scope: MainCardScope,
  revision: number,
): Promise<CardActivationGate> {
  const row = (
    await tx.execute<{ applicationId: string }>(
      sql`select application_id as "applicationId" from expert_card_drafts where user_id=${userId}::uuid and work_bot_id=${scope.botId} and work_bot_key=${scope.botKey} and work_chat_id=${scope.chatId}`,
    )
  ).rows[0];
  if (!row) return fail("card_main_forbidden");
  const gate = await lockCardActivationGate(tx, {
    applicationId: row.applicationId,
    userId,
  });
  if (!gate || gate.revision !== revision)
    return fail("card_main_gate_not_ready");
  return gate;
}
export async function beginMainCardCheckout(
  tx: ExpertCardTransaction,
  input: MainCardCheckoutCommand,
  policy: {
    providerMode: "test" | "live";
    messagingConsentPolicyVersion: string;
  },
) {
  const request = await beginCardRequest(tx, input, "main_checkout", {
    revision: input.revision,
    ...(input.renewalBillId ? { renewalBillId: input.renewalBillId } : {}),
    ...(input.renewalAcceptedQuoteId
      ? { renewalAcceptedQuoteId: input.renewalAcceptedQuoteId }
      : {}),
  });
  const gate = await lockMainFrameGate(
    tx,
    request.userId,
    input,
    input.revision,
  );
  if (
    gate.messagingConsentPolicyVersion !== policy.messagingConsentPolicyVersion
  )
    fail("card_main_forbidden");
  if (input.renewalAcceptedQuoteId && !request.replay)
    await acceptMainCardQuote(tx, {
      userId: request.userId,
      quoteId: input.renewalAcceptedQuoteId,
      renewalBillId: input.renewalBillId!,
      gate,
    });
  if (input.renewalBillId && request.replay) {
    const original = (
      await tx.execute<{ id: string }>(
        sql`select b.id from expert_residency_renewal_bills b join expert_residency_renewal_attempts a on a.bill_id=b.id where b.id=${input.renewalBillId}::uuid and b.user_id=${request.userId}::uuid and a.order_id=${request.resultId ?? null}::uuid`,
      )
    ).rows[0];
    if (!original) return fail("card_main_renewal_forbidden");
  }
  const renewal =
    input.renewalBillId && !request.replay
      ? await lockRenewalBillForCheckout(tx, {
          userId: request.userId,
          billId: input.renewalBillId,
        })
      : null;
  const acceptance = (
    await tx.execute<MainCardAcceptance>(
      sql`select id,application_id as "applicationId",application_audit_id as "applicationAuditId",user_id as "userId",expert_id as "expertId",quote_id as "quoteId",review_id as "reviewId",review_audit_id as "reviewAuditId",revision,public_digest as "publicDigest" from expert_card_main_acceptances a where user_id=${request.userId}::uuid and application_id=${gate.applicationId}::uuid and review_id=${gate.reviewId}::uuid and revision=${gate.revision} ${renewal ? sql`and id=${renewal.acceptanceId}::uuid and quote_id=${renewal.quoteId}::uuid and expert_id=${renewal.expertId}::uuid` : sql``} ${request.replay ? sql`and exists(select 1 from expert_card_main_orders m where m.acceptance_id=a.id and m.order_id=${request.resultId ?? null}::uuid and m.user_id=${request.userId}::uuid)` : sql``} order by created_at desc,id desc limit 1 for update`,
    )
  ).rows[0];
  if (!acceptance || acceptance.publicDigest !== gate.publicDigest)
    fail("card_main_acceptance_required");
  const facts =
    acceptance &&
    (
      await tx.execute<{ valid: boolean }>(
        sql`select expert_campaign_current_profile_valid(${request.userId}::uuid,${acceptance.quoteId}::uuid) as valid`,
      )
    ).rows[0];
  if (facts?.valid !== true) fail("card_main_current_profile_required");
  return {
    request,
    acceptance: acceptance!,
    gate,
    providerMode: policy.providerMode,
    renewal,
  };
}
export type MainCheckoutAdmission = Awaited<
  ReturnType<typeof beginMainCardCheckout>
>;
export async function assertMainCardPriorOrder(
  tx: ExpertCardTransaction,
  admission: MainCheckoutAdmission,
  orderId: string,
) {
  const prior = (
    await tx.execute<{ id: string }>(
      sql`select order_id as id from expert_card_main_orders where order_id=${orderId}::uuid and acceptance_id=${admission.acceptance.id}::uuid and user_id=${admission.request.userId}::uuid and purpose='main_residency' and provider_mode=${admission.providerMode}`,
    )
  ).rows[0];
  if (!prior) fail("card_main_order_binding_mismatch");
}
export async function recordMainCardOrder(
  tx: ExpertCardTransaction,
  admission: MainCheckoutAdmission,
  orderId: string,
) {
  const a = admission.acceptance;
  await tx.execute(
    sql`insert into expert_card_main_orders(order_id,acceptance_id,application_id,application_audit_id,user_id,expert_id,quote_id,review_id,review_audit_id,revision,public_digest,provider_mode) values(${orderId}::uuid,${a.id}::uuid,${a.applicationId}::uuid,${a.applicationAuditId}::uuid,${a.userId}::uuid,${a.expertId}::uuid,${a.quoteId}::uuid,${a.reviewId}::uuid,${a.reviewAuditId}::uuid,${a.revision},${a.publicDigest},${admission.providerMode})`,
  );
}
export async function finishMainCardCheckout(
  tx: ExpertCardTransaction,
  admission: MainCheckoutAdmission,
  orderId: string,
) {
  if (admission.renewal)
    await finishRenewalBillOrder(tx, admission.renewal, orderId);
  await finishCardRequest(tx, admission.request, orderId);
}
export interface MainCardAdmission {
  readonly orderId: string;
  readonly admitted: boolean;
  readonly expired?: boolean;
}
const admissions = new WeakMap<
  object,
  {
    tx: ExpertCardTransaction;
    gate: CardActivationGate;
    expertId: string;
    providerEventId: string;
  }
>();
/** Only called after canonical verification and payment/expiry checks. No generic
 * activation callback or caller-supplied predicate is accepted. */
export async function prepareMainCardSettlement(
  tx: ExpertCardTransaction,
  input: VerifiedExpertResidencyPaymentEvent,
  order: { id: string; expertId: string },
): Promise<MainCardAdmission | null> {
  assertVerifiedExpertResidencyPaymentEvent(input);
  if (input.orderId !== order.id || input.kind !== "settled")
    fail("card_main_payment_binding_mismatch");
  input = Object.freeze({ ...input });
  order = Object.freeze({ ...order });
  const subject = (
    await tx.execute<{ userId: string }>(
      sql`select user_id as "userId" from expert_card_main_orders where order_id=${order.id}::uuid and expert_id=${order.expertId}::uuid and purpose='main_residency'`,
    )
  ).rows[0];
  if (!subject) return null;
  await lockClientConsentSubject(tx, subject.userId);
  const binding = (
    await tx.execute<{
      userId: string;
      applicationId: string | null;
      reviewId: string | null;
      revision: number;
      publicDigest: string;
      mode: "test" | "live";
      quoteId: string;
    }>(
      sql`select quote_id as "quoteId",user_id as "userId",application_id as "applicationId",review_id as "reviewId",revision,public_digest as "publicDigest",provider_mode as mode from expert_card_main_orders where order_id=${order.id}::uuid and expert_id=${order.expertId}::uuid and purpose='main_residency' for update`,
    )
  ).rows[0];
  if (!binding || binding.userId !== subject.userId)
    return fail("card_main_payment_binding_mismatch");
  const canonical = (
    await tx.execute<{ id: string }>(
      sql`select id from expert_residency_provider_event_inbox where provider=${input.provider} and external_event_id=${input.eventId} and order_id=${order.id}::uuid and payment_id=${input.paymentId} and amount_minor=${input.amountMinor}::bigint and currency=${input.currency} and event_kind='settled' and authenticated=true and identity_version=1 and verification_id=${input.verificationId} and verifier_key_version=${input.verifierKeyVersion} and verified_at=${new Date(input.verifiedAt)} and status='processing' for update nowait`,
    )
  ).rows[0];
  if (!canonical) fail("card_main_payment_binding_mismatch");
  const operation = (
    await tx.execute<{ id: string }>(
      sql`select id from expert_residency_provider_operations where order_id=${order.id}::uuid and provider_object_id=${input.paymentId} and operation_kind='create_payment' and environment_mode=${binding.mode} and amount_minor=${input.amountMinor}::bigint and currency=${input.currency} and status in ('pending','unknown_outcome','succeeded') for share`,
    )
  ).rows[0];
  if (input.provider !== "yookassa" || !operation)
    fail("card_main_payment_binding_mismatch");
  const blocked = async () => {
    const expired = (
      await tx.execute<{ expired: boolean }>(
        sql`select clock_timestamp()>=payment_deadline as expired from expert_residency_orders where id=${order.id}::uuid`,
      )
    ).rows[0]?.expired;
    return Object.freeze({
      orderId: order.id,
      admitted: false,
      ...(expired !== false ? { expired: true } : {}),
    });
  };
  const currentFacts = (
    await tx.execute<{ valid: boolean }>(
      sql`select expert_campaign_current_profile_valid(${binding.userId}::uuid,${binding.quoteId}::uuid) as valid`,
    )
  ).rows[0];
  if (currentFacts?.valid !== true) return blocked();
  const lifecycle = await lockResidencyLifecycle(tx, binding.userId);
  if (lifecycle.paused) return blocked();
  if (!binding.applicationId || !binding.reviewId) return blocked();
  const gate = await lockCardActivationGate(tx, {
    applicationId: binding.applicationId,
    userId: binding.userId,
    reviewId: binding.reviewId,
  });
  if (
    !gate ||
    gate.revision !== binding.revision ||
    gate.publicDigest !== binding.publicDigest
  )
    return blocked();
  // Materialize the prospective promo source BEFORE sorted expert locks; the
  // unchanged canonical settlement read below will see this immutable binding.
  const candidate = (
    await tx.execute<{ userId: string; expertId: string }>(
      sql`select r.referrer_user_id as "userId",e.id as "expertId" from expert_promo_registrations r join experts e on e.user_id=r.referrer_user_id where r.user_id=${binding.userId}::uuid and r.erased_at is null`,
    )
  ).rows[0];
  const existing = (
    await tx.execute<{ id: string; inviterExpertId: string }>(
      sql`select id,inviter_expert_id as "inviterExpertId" from expert_referrals where invitee_expert_id=${order.expertId}::uuid`,
    )
  ).rows[0];
  const expertIds = [
    ...new Set([
      order.expertId,
      ...(existing
        ? [existing.inviterExpertId]
        : candidate
          ? [candidate.expertId]
          : []),
    ]),
  ].sort();
  await tx.execute(
    sql`select id from experts where id in (${sql.join(
      expertIds.map((id) => sql`${id}::uuid`),
      sql`,`,
    )}) order by id for update nowait`,
  );
  if (candidate && !existing) {
    await tx.execute(
      sql`select id from users where id in(${binding.userId}::uuid,${candidate.userId}::uuid) order by id for share`,
    );
    await tx.execute(
      sql`select id from channel_identities where user_id in(${binding.userId}::uuid,${candidate.userId}::uuid) and provider='telegram' and status='active' order by id for share`,
    );
  }
  const held = (
    await tx.execute<{ id: string }>(
      sql`select id from expert_referral_abuse_holds where expert_id=${order.expertId}::uuid and status='open' for update`,
    )
  ).rows[0];
  if (held) return blocked();
  const expired = (
    await tx.execute<{ expired: boolean }>(
      sql`select clock_timestamp()>=payment_deadline as expired from expert_residency_orders where id=${order.id}::uuid`,
    )
  ).rows[0]?.expired;
  if (expired !== false)
    return Object.freeze({ orderId: order.id, admitted: false, expired: true });

  await tx.execute(
    sql`select id from expert_residency_orders where expert_id=${order.expertId}::uuid and status='settled' order by id for share nowait`,
  );
  const currentAccess = (
    await tx.execute<{ valid: boolean }>(
      sql`select not exists(select 1 from expert_residency_orders where expert_id=${order.expertId}::uuid and status='settled' and residency_ends_at>clock_timestamp()) or exists(select 1 from expert_residency_current_coverage(${order.expertId}::uuid)) as valid`,
    )
  ).rows[0]?.valid;
  // Original calendar stacking can place this payment after a disconnected
  // prepaid future interval. Record that money/period without current access.
  if (currentAccess !== true) {
    await tx.execute(
      sql`update experts_published set active=false,updated_at=clock_timestamp() where expert_id=${order.expertId}::uuid`,
    );
    await tx.execute(
      sql`update experts set active=false,updated_at=clock_timestamp() where id=${order.expertId}::uuid`,
    );
    await tx.execute(
      sql`update expert_residency_lifecycle set status='payment_required' where user_id=${binding.userId}::uuid and status<>'paused'`,
    );
    const futureAdmission = await blocked();
    if (!futureAdmission.expired)
      admissions.set(futureAdmission, {
        tx,
        gate,
        expertId: order.expertId,
        providerEventId: canonical!.id,
      });
    return futureAdmission;
  }
  const enabled = (
    await tx.execute<{ id: string }>(
      sql`update experts set active=true,verified=true,public_display_name=${gate.publicPayload.displayName},updated_at=clock_timestamp() where id=${order.expertId}::uuid and user_id=${binding.userId}::uuid and exists(select 1 from users where id=${binding.userId}::uuid and active=true) returning id`,
    )
  ).rows[0];
  if (!enabled) return blocked();
  // Existing qualified-code ownership always wins. Never create a new referral
  // after an authoritative first-settlement snapshot, including an ineligible one.
  const first = (
    await tx.execute<{ id: string }>(
      sql`select id from expert_first_residency_settlements where expert_id=${order.expertId}::uuid`,
    )
  ).rows[0];
  if (
    candidate &&
    !existing &&
    !first &&
    candidate.expertId !== order.expertId &&
    candidate.userId !== binding.userId
  ) {
    const eligible = (
      await tx.execute<{ valid: boolean }>(
        sql`select exists(select 1 from experts e join users u on u.id=e.user_id and u.active=true where e.id=${candidate.expertId}::uuid and e.user_id=${candidate.userId}::uuid and e.active and e.verified) and not exists(select 1 from expert_referral_abuse_holds where expert_id in(${order.expertId}::uuid,${candidate.expertId}::uuid) and status='open') and (select count(distinct external_id)=1 from channel_identities where user_id=${binding.userId}::uuid and provider='telegram' and status='active' and external_chat_id=external_id) and (select count(distinct external_id)=1 from channel_identities where user_id=${candidate.userId}::uuid and provider='telegram' and status='active' and external_chat_id=external_id) and (select min(external_id) from channel_identities where user_id=${binding.userId}::uuid and provider='telegram' and status='active' and external_chat_id=external_id) is distinct from (select min(external_id) from channel_identities where user_id=${candidate.userId}::uuid and provider='telegram' and status='active' and external_chat_id=external_id) as valid`,
      )
    ).rows[0]?.valid;
    if (eligible === true) {
      const audit = (
        await tx.execute<{ id: string }>(
          sql`insert into expert_promo_qualification_audits(main_order_id,invitee_user_id,inviter_user_id,invitee_expert_id,inviter_expert_id,provider_event_id) select ${order.id}::uuid,${binding.userId}::uuid,${candidate.userId}::uuid,${order.expertId}::uuid,${candidate.expertId}::uuid,p.id from expert_residency_provider_event_inbox p where p.provider=${input.provider} and p.external_event_id=${input.eventId} returning id`,
        )
      ).rows[0];
      if (!audit) fail("card_main_payment_binding_mismatch");
      await tx.execute(
        sql`insert into expert_referrals(code_id,inviter_expert_id,invitee_expert_id,acquisition_source,promo_qualification_id) values(null,${candidate.expertId}::uuid,${order.expertId}::uuid,'promo_registration',${audit!.id}::uuid)`,
      );
    }
  }
  const admission = Object.freeze({ orderId: order.id, admitted: true });
  admissions.set(admission, {
    tx,
    gate,
    expertId: order.expertId,
    providerEventId: canonical!.id,
  });
  return admission;
}
export async function publishSettledMainCard(
  tx: ExpertCardTransaction,
  admission: MainCardAdmission | null,
) {
  if (!admission) return;
  const held = admissions.get(admission);
  if (!held) {
    if (!admission.admitted) return;
    return fail("card_main_forbidden");
  }
  if (held.tx !== tx) return fail("card_main_forbidden");
  // Admission is recorded once, in the verified settlement transaction. A later
  // profile change cannot mint this fact or revoke an already admitted period.
  await tx.execute(sql`insert into expert_main_activation_admissions(order_id,user_id,expert_id,quote_id,profile_revision,application_audit_id,review_audit_id,public_digest,provider_event_id)
    select m.order_id,m.user_id,m.expert_id,m.quote_id,q.profile_revision,m.application_audit_id,m.review_audit_id,m.public_digest,${held.providerEventId}::uuid
    from expert_card_main_orders m join expert_campaign_quotes q on q.id=m.quote_id where m.order_id=${admission.orderId}::uuid and m.user_id=${held.gate.userId}::uuid
    on conflict(order_id) do nothing`);
  if (!admission.admitted) return;
  await tx.execute(
    sql`insert into expert_residency_lifecycle(user_id,expert_id,status) values(${held.gate.userId}::uuid,${held.expertId}::uuid,'payment_required') on conflict(user_id) do nothing`,
  );
  const projected = await restoreSettledMainCardProjection(tx, {
    userId: held.gate.userId,
    expertId: held.expertId,
  });
  if (!projected) {
    // A verified payment remains settled even when its interval is disconnected
    // or current public-card eligibility changed. Never mint an access exception.
    await tx.execute(
      sql`update experts_published set active=false,updated_at=clock_timestamp() where expert_id=${held.expertId}::uuid`,
    );
    await tx.execute(
      sql`update experts set active=false,updated_at=clock_timestamp() where id=${held.expertId}::uuid`,
    );
    await tx.execute(
      sql`update expert_residency_lifecycle set status='payment_required' where user_id=${held.gate.userId}::uuid and status<>'paused'`,
    );
  }
}
export async function suspendReversedMainCard(
  tx: ExpertCardTransaction,
  orderId: string,
) {
  const main = (
    await tx.execute<{ expertId: string }>(
      sql`select expert_id as "expertId" from expert_card_main_orders where order_id=${orderId}::uuid`,
    )
  ).rows[0];
  if (!main) return;
  const live = (
    await tx.execute<{ valid: boolean }>(
      sql`select exists(select 1 from expert_residency_orders where expert_id=${main.expertId}::uuid and status='settled' and residency_starts_at<=clock_timestamp() and residency_ends_at>clock_timestamp()) as valid`,
    )
  ).rows[0]?.valid;
  if (live !== true) {
    await tx.execute(
      sql`update experts_published set active=false,updated_at=clock_timestamp() where expert_id=${main.expertId}::uuid`,
    );
    await tx.execute(
      sql`update experts set active=false,updated_at=clock_timestamp() where id=${main.expertId}::uuid`,
    );
  }
}
