import { sql } from "drizzle-orm";
import {
  assertVerifiedExpertResidencyPaymentEvent,
  type VerifiedExpertResidencyPaymentEvent,
} from "@ii-tonya/integrations";
import type { DrizzleDb } from "../client.js";
import { withSerializableRetry } from "./message-repository.js";

export class ExpertResidencySettlementError extends Error {
  constructor(public readonly code: string) {
    super(code);
    this.name = "ExpertResidencySettlementError";
  }
}
export interface ExpertResidencySettlementResult {
  readonly kind: "settled";
  readonly orderId: string;
  readonly paymentId: string;
  readonly firstSettlement: boolean;
  readonly rewardGranted: boolean;
  readonly residencyStartsAt: string;
  readonly residencyEndsAt: string;
}
type OrderRow = {
  id: string;
  expertId: string;
  cashMinor: bigint | string;
  currency: string;
  durationSeconds: number;
  paymentDeadline: Date | string;
  status: string;
  settledAt: Date | string | null;
  residencyStartsAt: Date | string | null;
  residencyEndsAt: Date | string | null;
  providerPaymentId: string | null;
};
const iso = (v: Date | string) =>
  v instanceof Date ? v.toISOString() : new Date(v).toISOString();

export class PostgresExpertResidencyProviderInboxRepository {
  constructor(private readonly db: DrizzleDb) {}
  async settle(
    input: VerifiedExpertResidencyPaymentEvent,
  ): Promise<ExpertResidencySettlementResult> {
    assertVerifiedExpertResidencyPaymentEvent(input);
    return withSerializableRetry(() =>
      this.db.transaction(async (tx) => {
        const digest = input.payloadDigest.slice("sha256:".length);
        const existing = await tx.execute<{
          payloadDigest: string;
          status: string;
        }>(
          sql`select payload_digest as "payloadDigest",status from expert_residency_provider_event_inbox where provider=${input.provider} and external_event_id=${input.eventId} for update`,
        );
        if (existing.rows[0] && existing.rows[0].payloadDigest !== digest)
          throw new ExpertResidencySettlementError(
            "EXPERT_RESIDENCY_PROVIDER_EVENT_CONFLICT",
          );
        const orderResult = await tx.execute<OrderRow>(
          sql`select id,expert_id as "expertId",cash_minor as "cashMinor",currency,duration_seconds as "durationSeconds",payment_deadline as "paymentDeadline",status,settled_at as "settledAt",residency_starts_at as "residencyStartsAt",residency_ends_at as "residencyEndsAt",provider_payment_id as "providerPaymentId" from expert_residency_orders where id=${input.orderId}::uuid for update`,
        );
        const order = orderResult.rows[0];
        if (!order)
          throw new ExpertResidencySettlementError(
            "EXPERT_RESIDENCY_ORDER_NOT_FOUND",
          );
        if (existing.rows[0]?.status === "processed")
          return this.prior(tx, order, input.paymentId);
        if (order.status !== "payment_pending")
          throw new ExpertResidencySettlementError(
            "EXPERT_RESIDENCY_ORDER_NOT_PENDING",
          );
        if (
          BigInt(order.cashMinor) !== BigInt(input.amountMinor) ||
          order.currency !== input.currency
        )
          throw new ExpertResidencySettlementError(
            "EXPERT_RESIDENCY_PAYMENT_MISMATCH",
          );
        const clock = await tx.execute<{ now: Date | string }>(
          sql`select transaction_timestamp() as now`,
        );
        const now = new Date(clock.rows[0]!.now);
        if (now >= new Date(order.paymentDeadline))
          throw new ExpertResidencySettlementError(
            "EXPERT_RESIDENCY_PAYMENT_EXPIRED",
          );
        const expert = await tx.execute<{
          active: boolean;
          verified: boolean;
          userId: string;
        }>(
          sql`select active,verified,user_id as "userId" from experts where id=${order.expertId}::uuid for update`,
        );
        if (!expert.rows[0]?.active || !expert.rows[0]?.verified)
          throw new ExpertResidencySettlementError(
            "EXPERT_RESIDENCY_EXPERT_NOT_ELIGIBLE",
          );
        await tx.execute(
          sql`insert into expert_residency_provider_event_inbox (provider,external_event_id,payload_digest,event_kind,authenticated,verification_id,verifier_key_version,verified_at,status) values (${input.provider},${input.eventId},${digest},${input.kind},true,${input.verificationId},${input.verifierKeyVersion},${new Date(input.verifiedAt)},'processing') on conflict (provider,external_event_id) do nothing`,
        );
        const attempted = await tx.execute<{ id: string }>(
          sql`insert into expert_residency_payment_attempts (order_id,provider,provider_request_id,expected_amount_minor,currency,status,idempotency_key,resolved_at) values (${order.id}::uuid,${input.provider},${input.paymentId},${input.amountMinor},${input.currency},'settled',${`settlement:${input.provider}:${input.paymentId}`},${now}) on conflict (provider,provider_request_id) do nothing returning id`,
        );
        const attempt = attempted.rows[0]
          ? attempted
          : await tx.execute<{ id: string }>(
              sql`select id from expert_residency_payment_attempts where provider=${input.provider} and provider_request_id=${input.paymentId} and order_id=${order.id}::uuid and expected_amount_minor=${input.amountMinor} and currency=${input.currency} for update`,
            );
        if (!attempt.rows[0])
          throw new ExpertResidencySettlementError(
            "EXPERT_RESIDENCY_PAYMENT_ATTEMPT_CONFLICT",
          );
        const current = await tx.execute<{ endAt: Date | string | null }>(
          sql`select max(residency_ends_at) as "endAt" from expert_residency_orders where expert_id=${order.expertId}::uuid and status='settled'`,
        );
        const start =
          current.rows[0]?.endAt && new Date(current.rows[0].endAt) > now
            ? new Date(current.rows[0].endAt)
            : now;
        const end = new Date(start.getTime() + order.durationSeconds * 1000);
        await tx.execute(
          sql`update expert_residency_orders set status='settled',provider_payment_id=${input.paymentId},settled_at=${now},residency_starts_at=${start},residency_ends_at=${end},updated_at=${now} where id=${order.id}::uuid`,
        );
        const referral = await tx.execute<{
          id: string;
          inviterExpertId: string;
        }>(
          sql`select r.id,r.inviter_expert_id as "inviterExpertId" from expert_referrals r left join expert_referral_abuse_holds h on h.expert_id=r.invitee_expert_id and h.status='open' where r.invitee_expert_id=${order.expertId}::uuid and h.id is null for update of r`,
        );
        const control = await tx.execute<{ enabled: boolean }>(
          sql`select reward_grants_enabled as enabled from expert_referral_feature_controls where control_key='expert_referrals' for update`,
        );
        const eligibility = referral.rows[0]
          ? control.rows[0]?.enabled
            ? "eligible"
            : "pending_feature_hold"
          : "permanently_ineligible";
        const marker = await tx.execute<{ id: string }>(
          sql`insert into expert_first_residency_settlements (expert_id,qualifying_order_id,qualifying_payment_attempt_id,referral_id,eligibility,reason_code,settlement_expert_active,settlement_expert_verified,settlement_abuse_cleared,settled_at) values (${order.expertId}::uuid,${order.id}::uuid,${attempt.rows[0]!.id}::uuid,${referral.rows[0]?.id ?? null}::uuid,${eligibility},${eligibility === "eligible" ? "eligible_referral" : eligibility},true,true,true,${now}) on conflict (expert_id) do nothing returning id`,
        );
        let rewardGranted = false;
        if (marker.rows[0] && eligibility === "eligible" && referral.rows[0]) {
          const grant = await tx.execute<{ id: string }>(
            sql`insert into expert_referral_reward_grants (expert_id,referral_id,first_settlement_id,qualifying_order_id,qualifying_payment_attempt_id,amount_minor,granted_at,expires_at,idempotency_key) values (${referral.rows[0].inviterExpertId}::uuid,${referral.rows[0].id}::uuid,${marker.rows[0].id}::uuid,${order.id}::uuid,${attempt.rows[0]!.id}::uuid,100000,${now},${new Date(now.getTime() + 365 * 86400000)},${`reward:${marker.rows[0].id}`}) returning id`,
          );
          const ledger = await tx.execute<{ id: string }>(
            sql`insert into expert_referral_ledger_entries (expert_id,entry_kind,amount_minor,source_type,source_id,idempotency_key) values (${referral.rows[0].inviterExpertId}::uuid,'reward_grant',100000,'reward_grant',${grant.rows[0]!.id}::uuid,${`reward-ledger:${marker.rows[0].id}`}) returning id`,
          );
          await tx.execute(
            sql`insert into expert_referral_ledger_allocations (ledger_entry_id,reward_grant_id,expert_id,amount_minor) values (${ledger.rows[0]!.id}::uuid,${grant.rows[0]!.id}::uuid,${referral.rows[0].inviterExpertId}::uuid,100000)`,
          );
          rewardGranted = true;
        }
        await tx.execute(
          sql`update expert_residency_provider_event_inbox set status='processed',result_code='settled',processed_at=${now},updated_at=${now} where provider=${input.provider} and external_event_id=${input.eventId}`,
        );
        await tx.execute(
          sql`insert into audit_events (actor_type,actor_id,authenticated_session_id_hash,action,object_type,object_id,decision,reason_code,correlation_id,occurred_at,metadata_hash) values ('provider',${expert.rows[0].userId}::uuid,${`provider-verification:${input.verificationId}`},'expert_residency.settle','expert_residency_order',${order.id}::uuid,'allowed','verified_settlement',${input.eventId},${now},${digest})`,
        );
        await tx.execute(
          sql`insert into integration_outbox (idempotency_key,topic,payload,correlation_id,reconciliation_key,payload_hash) values (${`expert-residency-settled:${order.id}`},'expert.residency.settled',${JSON.stringify({ orderId: order.id, expertId: order.expertId })}::jsonb,${input.eventId},${`expert-residency:${order.id}`},${digest}) on conflict (idempotency_key) do nothing`,
        );
        return {
          kind: "settled",
          orderId: order.id,
          paymentId: input.paymentId,
          firstSettlement: Boolean(marker.rows[0]),
          rewardGranted,
          residencyStartsAt: start.toISOString(),
          residencyEndsAt: end.toISOString(),
        };
      }),
    );
  }
  private async prior(
    tx: Pick<DrizzleDb, "execute">,
    order: OrderRow,
    paymentId: string,
  ): Promise<ExpertResidencySettlementResult> {
    if (
      !order.residencyStartsAt ||
      !order.residencyEndsAt ||
      order.status !== "settled" ||
      order.providerPaymentId !== paymentId
    )
      throw new ExpertResidencySettlementError(
        "EXPERT_RESIDENCY_REPLAY_STATE_CONFLICT",
      );
    const marker = await tx.execute<{ id: string }>(
      sql`select id from expert_first_residency_settlements where qualifying_order_id=${order.id}::uuid`,
    );
    const reward = marker.rows[0]
      ? await tx.execute<{ id: string }>(
          sql`select id from expert_referral_reward_grants where first_settlement_id=${marker.rows[0].id}::uuid`,
        )
      : { rows: [] };
    return {
      kind: "settled",
      orderId: order.id,
      paymentId,
      firstSettlement: Boolean(marker.rows[0]),
      rewardGranted: Boolean(reward.rows[0]),
      residencyStartsAt: iso(order.residencyStartsAt),
      residencyEndsAt: iso(order.residencyEndsAt),
    };
  }
}
