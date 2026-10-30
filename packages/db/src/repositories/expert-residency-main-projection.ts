import { recordResidentFirstActivation } from "./resident-lifecycle-completion-repository.js";
import { sql } from "drizzle-orm";
import { lockClientConsentSubject } from "./client-consent-authority.js";
import {
  lockCardActivationGate,
  type ExpertCardTransaction,
} from "./expert-card-repository.js";
/** Restore only an existing, canonical settled main-card entitlement. This is
 * projection repair, never payment verification, interval creation or reward mint. */
export async function restoreSettledMainCardProjection(
  tx: ExpertCardTransaction,
  raw: { userId: string; expertId: string },
): Promise<boolean> {
  const id =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
  if (
    !raw ||
    typeof raw.userId !== "string" ||
    !id.test(raw.userId) ||
    typeof raw.expertId !== "string" ||
    !id.test(raw.expertId)
  )
    return false;
  const input = Object.freeze({ ...raw });
  await lockClientConsentSubject(tx, input.userId);
  const lifecycle = (
    await tx.execute<{ status: string }>(
      sql`select status from expert_residency_lifecycle where user_id=${input.userId}::uuid and expert_id=${input.expertId}::uuid for update`,
    )
  ).rows[0];
  if (!lifecycle || lifecycle.status === "paused") return false;
  // Refunds must not remove a middle prepaid interval after chain evaluation.
  // NOWAIT avoids reversing the canonical order→expert lock edge.
  await tx.execute(
    sql`select id from expert_residency_orders where expert_id=${input.expertId}::uuid and status='settled' order by id for share nowait`,
  );
  const coverage = (
    await tx.execute<{ sourceOrderId: string; endsAt: string | Date }>(
      sql`select source_order_id as "sourceOrderId",ends_at as "endsAt" from expert_residency_current_coverage(${input.expertId}::uuid)`,
    )
  ).rows[0];
  if (!coverage) return false;
  const source = (
    await tx.execute<{
      orderId: string;
      applicationId: string;
      reviewId: string;
      revision: number;
      publicDigest: string;
      endsAt: string | Date;
    }>(
      sql`select o.id as "orderId",m.application_id as "applicationId",m.review_id as "reviewId",m.revision,m.public_digest as "publicDigest",o.residency_ends_at as "endsAt" from expert_card_main_orders m join expert_residency_orders o on o.id=m.order_id and o.expert_id=m.expert_id join experts e on e.id=m.expert_id and e.user_id=m.user_id join users u on u.id=e.user_id and u.active=true where m.user_id=${input.userId}::uuid and m.expert_id=${input.expertId}::uuid and m.purpose='main_residency' and m.application_id is not null and m.review_id is not null and o.status='settled' and (exists(select 1 from expert_main_activation_admissions admitted where admitted.order_id=o.id and admitted.user_id=m.user_id and admitted.expert_id=m.expert_id and admitted.quote_id=m.quote_id and admitted.review_audit_id=m.review_audit_id and admitted.public_digest=m.public_digest)) and o.id=${coverage.sourceOrderId}::uuid and o.residency_ends_at=${coverage.endsAt}::timestamptz limit 1 for update of o nowait`,
    )
  ).rows[0];
  if (!source || source.orderId !== coverage.sourceOrderId) return false;
  const currentReview = (
    await tx.execute<{ reviewId: string }>(
      sql`select v.review_id as "reviewId" from resident_card_versions v join expert_card_drafts d on d.id=v.draft_id where d.user_id=${input.userId}::uuid order by v.revision desc limit 1`,
    )
  ).rows[0]?.reviewId;
  const gate = await lockCardActivationGate(tx, {
    applicationId: source.applicationId,
    userId: input.userId,
    reviewId: currentReview ?? source.reviewId,
  });
  if (
    !gate ||
    (!currentReview &&
      (gate.revision !== source.revision ||
        gate.publicDigest !== source.publicDigest))
  )
    return false;
  const expert = (
    await tx.execute<{ id: string }>(
      sql`select id from experts where id=${input.expertId}::uuid and user_id=${input.userId}::uuid for update nowait`,
    )
  ).rows[0];
  if (!expert) return false;
  await tx.execute(
    sql`select id from expert_referral_abuse_holds where expert_id=${input.expertId}::uuid and status='open' for share`,
  );
  const valid = (
    await tx.execute<{ valid: boolean }>(
      sql`select exists(select 1 from expert_residency_current_coverage(${input.expertId}::uuid) c where c.source_order_id=${source.orderId}::uuid and c.ends_at=${source.endsAt}::timestamptz) and exists(select 1 from expert_residency_lifecycle where user_id=${input.userId}::uuid and expert_id=${input.expertId}::uuid and status<>'paused') and not exists(select 1 from expert_referral_abuse_holds where expert_id=${input.expertId}::uuid and status='open') as valid`,
    )
  ).rows[0]?.valid;
  if (valid !== true) return false;
  await tx.execute(
    sql`update experts set active=true,verified=true,public_display_name=${gate.publicPayload.displayName},updated_at=clock_timestamp() where id=${input.expertId}::uuid and user_id=${input.userId}::uuid`,
  );
  const existingPublication =
    (
      await tx.execute(
        sql`select 1 from experts_published where expert_id=${input.expertId}::uuid and user_id=${input.userId}::uuid`,
      )
    ).rows.length === 1;
  if (existingPublication) {
    await tx.execute(
      sql`update experts_published set draft_id=${gate.draftId}::uuid,review_id=${gate.reviewId}::uuid,revision=${gate.revision},public_payload=${JSON.stringify(gate.publicPayload)}::jsonb,public_digest=${gate.publicDigest},paid_order_id=${source.orderId}::uuid,wave_intent_id=null,next_billing_date=${source.endsAt}::timestamptz,active=true,updated_at=clock_timestamp() where expert_id=${input.expertId}::uuid and user_id=${input.userId}::uuid`,
    );
  } else {
    await tx.execute(
      sql`insert into experts_published(expert_id,user_id,application_audit_id,draft_id,review_id,revision,public_payload,public_digest,paid_order_id,next_billing_date,active) values(${input.expertId}::uuid,${input.userId}::uuid,${gate.applicationId}::uuid,${gate.draftId}::uuid,${gate.reviewId}::uuid,${gate.revision},${JSON.stringify(gate.publicPayload)}::jsonb,${gate.publicDigest},${source.orderId}::uuid,${source.endsAt}::timestamptz,true) on conflict(expert_id) do update set draft_id=excluded.draft_id,review_id=excluded.review_id,revision=excluded.revision,public_payload=excluded.public_payload,public_digest=excluded.public_digest,paid_order_id=excluded.paid_order_id,wave_intent_id=null,next_billing_date=excluded.next_billing_date,active=true,updated_at=clock_timestamp()`,
    );
  }
  await tx.execute(
    sql`update expert_residency_lifecycle set status='active' where user_id=${input.userId}::uuid and expert_id=${input.expertId}::uuid and status<>'paused'`,
  );
  await recordResidentFirstActivation(tx, {
    ...input,
    orderId: source.orderId,
  });
  return true;
}
