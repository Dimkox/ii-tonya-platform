import { sql } from "drizzle-orm";
import { CardMainPaymentError } from "./expert-card-main-command.js";
import type {
  ExpertCardTransaction,
  CardActivationGate,
} from "./expert-card-repository.js";
const invalid = (code: string): never => {
  throw new CardMainPaymentError(code);
};
export async function lockRenewalBillForMutation(
  tx: ExpertCardTransaction,
  userId: string,
  billId: string,
) {
  const bill = (
    await tx.execute<{
      id: string;
      expertId: string;
      quoteId: string | null;
      acceptanceId: string | null;
      orderId: string | null;
    }>(
      sql`select b.id,b.expert_id as "expertId",b.quote_id as "quoteId",b.acceptance_id as "acceptanceId",a.order_id as "orderId" from expert_residency_renewal_bills b left join lateral(select order_id from expert_residency_renewal_attempts where bill_id=b.id order by sequence desc limit 1)a on true where b.id=${billId}::uuid and b.user_id=${userId}::uuid and b.owner_audit_id=${userId}::uuid and exists(select 1 from experts e where e.id=b.expert_id and e.user_id=b.user_id) for update of b`,
    )
  ).rows[0];
  if (!bill) invalid("card_main_renewal_forbidden");
  if (bill!.orderId) {
    const order = (
      await tx.execute<{ status: string; expired: boolean }>(
        sql`select status,payment_deadline<=clock_timestamp() as expired from expert_residency_orders where id=${bill!.orderId}::uuid and expert_id=${bill!.expertId}::uuid for update`,
      )
    ).rows[0];
    // An overdue but still pending/unknown attempt is recovered, never replaced.
    // Canonical expiry must release reservations before a fresh accepted attempt.
    if (order?.status !== "expired" || order.expired !== true)
      invalid("card_main_renewal_order_bound");
  }
  return bill!;
}

export async function acceptMainCardQuote(
  tx: ExpertCardTransaction,
  input: {
    userId: string;
    quoteId: string;
    renewalBillId?: string;
    gate: CardActivationGate;
  },
): Promise<{ id: string }> {
  if (input.renewalBillId) {
    await tx.execute(
      sql`select id from expert_residency_renewal_bills where id=${input.renewalBillId}::uuid and user_id=${input.userId}::uuid for update`,
    );
    const prior = (
      await tx.execute<{ id: string; orderId: string; status: string }>(
        sql`select a.id,o.id as "orderId",o.status from expert_residency_renewal_bills b join lateral(select acceptance_id,order_id,quote_id from expert_residency_renewal_attempts where bill_id=b.id order by sequence desc limit 1)t on true join expert_card_main_acceptances a on a.id=t.acceptance_id and a.id=b.acceptance_id and a.quote_id=b.quote_id and a.user_id=b.user_id join expert_residency_orders o on o.id=t.order_id and o.expert_id=b.expert_id where b.id=${input.renewalBillId}::uuid and b.user_id=${input.userId}::uuid and b.quote_id=${input.quoteId}::uuid and t.quote_id=b.quote_id and a.review_id=${input.gate.reviewId}::uuid and a.revision=${input.gate.revision} and a.public_digest=${input.gate.publicDigest} for update of o`,
      )
    ).rows[0];
    if (prior?.status === "payment_pending") {
      const valid = (
        await tx.execute<{ valid: boolean }>(
          sql`select payment_deadline>clock_timestamp() as valid from expert_residency_orders where id=${prior.orderId}::uuid and status='payment_pending'`,
        )
      ).rows[0]?.valid;
      if (valid === true) return { id: prior.id };
    }
  }
  const renewal = input.renewalBillId
    ? await lockRenewalBillForMutation(tx, input.userId, input.renewalBillId)
    : null;
  if (renewal && renewal.quoteId !== input.quoteId)
    invalid("card_main_renewal_quote_required");
  const quote = (
    await tx.execute<{ id: string }>(
      sql`select id from expert_campaign_quotes where id=${input.quoteId}::uuid and user_id=${input.userId}::uuid for share`,
    )
  ).rows[0];
  const valid =
    quote &&
    (
      await tx.execute<{ valid: boolean }>(
        sql`select quoted_at<=clock_timestamp() and expires_at>clock_timestamp() as valid from expert_campaign_quotes where id=${quote.id}::uuid`,
      )
    ).rows[0]?.valid;
  if (valid !== true) invalid("card_main_quote_expired_or_unavailable");
  // Creating a private inactive expert identity grants no API or paid access.
  await tx.execute(
    sql`insert into experts(user_id,active,verified) values(${input.userId}::uuid,false,false) on conflict(user_id) do nothing`,
  );
  const expert = (
    await tx.execute<{ id: string }>(
      sql`select id from experts where user_id=${input.userId}::uuid for update`,
    )
  ).rows[0];
  if (!expert) invalid("card_main_forbidden");
  const accepted =
    (
      await tx.execute<{ id: string }>(
        sql`insert into expert_card_main_acceptances(application_id,application_audit_id,user_id,expert_id,review_id,review_audit_id,revision,public_digest,quote_id,created_at) values(${input.gate.applicationId}::uuid,${input.gate.applicationId}::uuid,${input.userId}::uuid,${expert!.id}::uuid,${input.gate.reviewId}::uuid,${input.gate.reviewId}::uuid,${input.gate.revision},${input.gate.publicDigest},${input.quoteId}::uuid,clock_timestamp()) on conflict(user_id,review_audit_id,quote_id) do nothing returning id`,
      )
    ).rows[0] ??
    (
      await tx.execute<{ id: string }>(
        sql`select id from expert_card_main_acceptances where user_id=${input.userId}::uuid and review_audit_id=${input.gate.reviewId}::uuid and quote_id=${input.quoteId}::uuid`,
      )
    ).rows[0];
  if (!accepted) invalid("card_main_storage_unavailable");
  if (input.renewalBillId)
    await tx.execute(
      sql`update expert_residency_renewal_bills set acceptance_id=${accepted!.id}::uuid where id=${input.renewalBillId}::uuid and user_id=${input.userId}::uuid and quote_id=${input.quoteId}::uuid`,
    );

  return accepted!;
}
