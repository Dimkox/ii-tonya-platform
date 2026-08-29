import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import {
  assertVerifiedExpertResidencyPaymentEvent,
  type VerifiedExpertResidencyPaymentEvent,
} from "@ii-tonya/integrations";
import type { DrizzleDb } from "../client.js";
import { withSerializableRetry } from "./message-repository.js";
import { grantExpertReferralReward } from "./expert-referral-reward-allocation.js";

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
  readonly eligibility:
    "eligible" | "pending_feature_hold" | "permanently_ineligible";
  readonly residencyStartsAt: string;
  readonly residencyEndsAt: string;
}
export interface ExpertResidencyReversalResult {
  readonly kind: "refunded" | "charged_back";
  readonly orderId: string;
  readonly paymentId: string;
  readonly cashRefundedMinor: bigint;
  readonly restoredCreditMinor: 0n;
  readonly rewardReversed: boolean;
  readonly debtMinor: bigint;
  readonly terminated: boolean;
}
function reversalResultPayload(
  result: ExpertResidencyReversalResult,
  eventId: string,
) {
  return {
    ...result,
    eventId,
    cashRefundedMinor: result.cashRefundedMinor.toString(),
    restoredCreditMinor: "0",
    debtMinor: result.debtMinor.toString(),
  };
}
function reversalResultFromPayload(
  value: unknown,
  expectedEventId: string,
): ExpertResidencyReversalResult | undefined {
  if (!value || typeof value !== "object") return undefined;
  const row = value as Record<string, unknown>;
  const keys = Object.keys(row).sort();
  const expectedKeys = [
    "cashRefundedMinor",
    "debtMinor",
    "eventId",
    "kind",
    "orderId",
    "paymentId",
    "restoredCreditMinor",
    "rewardReversed",
    "terminated",
  ];
  if (
    keys.length !== expectedKeys.length ||
    keys.some((key, index) => key !== expectedKeys[index]) ||
    (row.kind !== "refunded" && row.kind !== "charged_back") ||
    typeof row.orderId !== "string" ||
    row.eventId !== expectedEventId ||
    typeof row.paymentId !== "string" ||
    typeof row.cashRefundedMinor !== "string" ||
    !/^(?:0|[1-9][0-9]{0,11})$/u.test(row.cashRefundedMinor) ||
    row.restoredCreditMinor !== "0" ||
    typeof row.rewardReversed !== "boolean" ||
    typeof row.debtMinor !== "string" ||
    !/^(?:0|[1-9][0-9]{0,11})$/u.test(row.debtMinor) ||
    typeof row.terminated !== "boolean"
  )
    return undefined;
  return {
    kind: row.kind,
    orderId: row.orderId,
    paymentId: row.paymentId,
    cashRefundedMinor: BigInt(row.cashRefundedMinor),
    restoredCreditMinor: 0n,
    rewardReversed: row.rewardReversed,
    debtMinor: BigInt(row.debtMinor),
    terminated: row.terminated,
  };
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
  commercialPolicyVersion: string;
};
const iso = (v: Date | string) =>
  v instanceof Date ? v.toISOString() : new Date(v).toISOString();

export class PostgresExpertResidencyProviderInboxRepository {
  constructor(private readonly db: DrizzleDb) {}
  async settle(
    input: VerifiedExpertResidencyPaymentEvent,
  ): Promise<ExpertResidencySettlementResult> {
    assertVerifiedExpertResidencyPaymentEvent(input);
    if (input.kind !== "settled")
      throw new ExpertResidencySettlementError(
        "EXPERT_RESIDENCY_SETTLEMENT_EVENT_REQUIRED",
      );
    return withSerializableRetry(() =>
      this.db.transaction(async (tx) => {
        const digest = input.payloadDigest.slice("sha256:".length);
        await tx.execute(
          sql`insert into expert_residency_provider_event_inbox (provider,external_event_id,payload_digest,event_kind,identity_version,payment_id,order_id,amount_minor,currency,occurred_at,authenticated,verification_id,verifier_key_version,verified_at,status) values (${input.provider},${input.eventId},${digest},${input.kind},1,${input.paymentId},${input.orderId}::uuid,${input.amountMinor},${input.currency},${new Date(input.occurredAt)},true,${input.verificationId},${input.verifierKeyVersion},${new Date(input.verifiedAt)},'processing') on conflict (provider,external_event_id) do nothing`,
        );
        const existing = await tx.execute<{
          payloadDigest: string;
          status: string;
          identityVersion: number;
          paymentId: string | null;
          orderId: string | null;
          amountMinor: bigint | string | null;
          currency: string | null;
          eventKind: string;
          occurredAt: Date | string | null;
          verificationId: string | null;
          verifierKeyVersion: string | null;
          verifiedAt: Date | string | null;
        }>(
          sql`select payload_digest as "payloadDigest",status,identity_version as "identityVersion",payment_id as "paymentId",order_id as "orderId",amount_minor as "amountMinor",currency,event_kind as "eventKind",occurred_at as "occurredAt",verification_id as "verificationId",verifier_key_version as "verifierKeyVersion",verified_at as "verifiedAt" from expert_residency_provider_event_inbox where provider=${input.provider} and external_event_id=${input.eventId} for update`,
        );
        const priorEvent = existing.rows[0];
        if (
          priorEvent &&
          (priorEvent.identityVersion !== 1 ||
            priorEvent.amountMinor === null ||
            priorEvent.occurredAt === null ||
            priorEvent.verifiedAt === null ||
            priorEvent.payloadDigest !== digest ||
            priorEvent.paymentId !== input.paymentId ||
            priorEvent.orderId !== input.orderId ||
            BigInt(priorEvent.amountMinor) !== BigInt(input.amountMinor) ||
            priorEvent.currency !== input.currency ||
            priorEvent.eventKind !== input.kind ||
            iso(priorEvent.occurredAt) !== input.occurredAt ||
            priorEvent.verificationId !== input.verificationId ||
            priorEvent.verifierKeyVersion !== input.verifierKeyVersion ||
            iso(priorEvent.verifiedAt) !== input.verifiedAt)
        )
          throw new ExpertResidencySettlementError(
            "EXPERT_RESIDENCY_PROVIDER_EVENT_CONFLICT",
          );
        const orderResult = await tx.execute<OrderRow>(
          sql`select id,expert_id as "expertId",cash_minor as "cashMinor",currency,duration_seconds as "durationSeconds",payment_deadline as "paymentDeadline",status,settled_at as "settledAt",residency_starts_at as "residencyStartsAt",residency_ends_at as "residencyEndsAt",provider_payment_id as "providerPaymentId",commercial_policy_version as "commercialPolicyVersion" from expert_residency_orders where id=${input.orderId}::uuid for update`,
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
        const prospectiveReferral = await tx.execute<{
          inviterExpertId: string;
        }>(
          sql`select inviter_expert_id as "inviterExpertId" from expert_referrals where invitee_expert_id=${order.expertId}::uuid`,
        );
        const expert = await tx.execute<{
          active: boolean;
          verified: boolean;
          userId: string;
        }>(
          sql`select active,verified,user_id as "userId" from experts where id=${order.expertId}::uuid`,
        );
        if (!expert.rows[0])
          throw new ExpertResidencySettlementError(
            "EXPERT_RESIDENCY_EXPERT_NOT_FOUND",
          );
        const inviteeChannel = await tx.execute<{ id: string }>(
          sql`select id from channel_identities where user_id=${expert.rows[0].userId}::uuid order by id limit 1`,
        );
        const inviterIdentity = prospectiveReferral.rows[0]
          ? await tx.execute<{
              userId: string;
              channelIdentityId: string | null;
            }>(
              sql`select e.user_id as "userId",(select ci.id from channel_identities ci where ci.user_id=e.user_id order by ci.id limit 1) as "channelIdentityId" from experts e where e.id=${prospectiveReferral.rows[0].inviterExpertId}::uuid`,
            )
          : { rows: [] };
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
        const reservations = await tx.execute<{ id: string }>(
          sql`select id from expert_referral_ledger_entries where order_id=${order.id}::uuid and entry_kind='reservation' order by id for update`,
        );
        for (const reservation of reservations.rows) {
          const release = await tx.execute<{ id: string }>(
            sql`insert into expert_referral_ledger_entries (expert_id,entry_kind,amount_minor,order_id,original_entry_id,source_type,source_id,idempotency_key) select expert_id,'release',-amount_minor,order_id,id,'residency_settlement',${order.id}::uuid,${`settlement-release:${reservation.id}`} from expert_referral_ledger_entries where id=${reservation.id}::uuid on conflict (idempotency_key) do nothing returning id`,
          );
          if (release.rows[0])
            await tx.execute(
              sql`insert into expert_referral_ledger_allocations (ledger_entry_id,reward_grant_id,expert_id,amount_minor) select ${release.rows[0].id}::uuid,reward_grant_id,expert_id,-amount_minor from expert_referral_ledger_allocations where ledger_entry_id=${reservation.id}::uuid order by reward_grant_id`,
            );
          const spend = await tx.execute<{ id: string }>(
            sql`insert into expert_referral_ledger_entries (expert_id,entry_kind,amount_minor,order_id,original_entry_id,source_type,source_id,idempotency_key) select expert_id,'spend',amount_minor,order_id,id,'residency_settlement',${order.id}::uuid,${`settlement-spend:${reservation.id}`} from expert_referral_ledger_entries where id=${reservation.id}::uuid on conflict (idempotency_key) do nothing returning id`,
          );
          if (spend.rows[0])
            await tx.execute(
              sql`insert into expert_referral_ledger_allocations (ledger_entry_id,reward_grant_id,expert_id,amount_minor) select ${spend.rows[0].id}::uuid,reward_grant_id,expert_id,amount_minor from expert_referral_ledger_allocations where ledger_entry_id=${reservation.id}::uuid order by reward_grant_id`,
            );
        }
        const referral = await tx.execute<{
          id: string;
          inviterExpertId: string;
        }>(
          sql`select r.id,r.inviter_expert_id as "inviterExpertId" from expert_referrals r where r.invitee_expert_id=${order.expertId}::uuid for update`,
        );
        const hold = await tx.execute<{ id: string }>(
          sql`select id from expert_referral_abuse_holds where expert_id=${order.expertId}::uuid and status='open' for update`,
        );
        const control = await tx.execute<{ enabled: boolean; version: number }>(
          sql`select reward_grants_enabled as enabled,version from expert_referral_feature_controls where control_key='expert_referrals' for update`,
        );
        const abuseCleared = !hold.rows[0];
        const expertEligible = expert.rows[0].active && expert.rows[0].verified;
        const eligibility =
          referral.rows[0] && expertEligible && abuseCleared
            ? order.commercialPolicyVersion === "legacy_residency_v1" &&
              !control.rows[0]?.enabled
              ? "pending_feature_hold"
              : "eligible"
            : "permanently_ineligible";
        const marker = await tx.execute<{ id: string }>(
          sql`insert into expert_first_residency_settlements (expert_id,qualifying_order_id,qualifying_payment_attempt_id,referral_id,eligibility,reason_code,settlement_expert_active,settlement_expert_verified,settlement_abuse_cleared,settlement_control_version,settlement_invitee_user_id,settlement_invitee_channel_identity_id,settlement_inviter_expert_id,settlement_inviter_user_id,settlement_inviter_channel_identity_id,settled_at) values (${order.expertId}::uuid,${order.id}::uuid,${attempt.rows[0]!.id}::uuid,${referral.rows[0]?.id ?? null}::uuid,${eligibility},${!expertEligible ? "expert_ineligible" : !abuseCleared ? "ineligible_abuse_hold" : eligibility === "eligible" ? "eligible_referral" : "pending_feature_hold"},${expert.rows[0].active},${expert.rows[0].verified},${abuseCleared},${control.rows[0]?.version ?? 0},${expert.rows[0].userId}::uuid,${inviteeChannel.rows[0]?.id ?? null}::uuid,${prospectiveReferral.rows[0]?.inviterExpertId ?? null}::uuid,${inviterIdentity.rows[0]?.userId ?? null}::uuid,${inviterIdentity.rows[0]?.channelIdentityId ?? null}::uuid,${now}) on conflict (expert_id) do nothing returning id`,
        );
        let rewardGranted = false;
        if (
          marker.rows[0] &&
          referral.rows[0] &&
          expertEligible &&
          abuseCleared &&
          order.commercialPolicyVersion === "expert_residency_v2" &&
          eligibility === "eligible"
        ) {
          await tx.execute(sql`
            insert into expert_referral_reward_maturities (
              first_settlement_id, referral_id, qualifying_order_id,
              qualifying_payment_attempt_id, inviter_expert_id, invitee_expert_id,
              settled_at, matures_at, idempotency_key
            ) values (
              ${marker.rows[0].id}::uuid, ${referral.rows[0].id}::uuid,
              ${order.id}::uuid, ${attempt.rows[0]!.id}::uuid,
              ${referral.rows[0].inviterExpertId}::uuid, ${order.expertId}::uuid,
              transaction_timestamp(), transaction_timestamp() + interval '30 days',
              ${`expert-referral-maturity:v1:${marker.rows[0].id}`}
            ) on conflict (first_settlement_id) do nothing
          `);
        }
        if (
          marker.rows[0] &&
          referral.rows[0] &&
          expertEligible &&
          abuseCleared &&
          order.commercialPolicyVersion === "legacy_residency_v1" &&
          eligibility === "eligible"
        ) {
          const expertIds = [
            order.expertId,
            referral.rows[0].inviterExpertId,
          ].sort();
          await tx.execute(
            sql`select id from experts where id in (${sql.join(
              expertIds.map((id) => sql`${id}::uuid`),
              sql`,`,
            )}) order by id for update`,
          );
          const allocation = await grantExpertReferralReward(tx, {
            maturityId: null,
            inviterExpertId: referral.rows[0].inviterExpertId,
            referralId: referral.rows[0].id,
            firstSettlementId: marker.rows[0].id,
            orderId: order.id,
            paymentAttemptId: attempt.rows[0]!.id,
          });
          rewardGranted = allocation !== "already_granted";
        }
        const outboxPayload = JSON.stringify({
          orderId: order.id,
          expertId: order.expertId,
        });
        const outboxHash = createHash("sha256")
          .update(outboxPayload)
          .digest("hex");
        await tx.execute(
          sql`update expert_residency_provider_event_inbox set status='processed',result_code='settled',processed_at=${now},updated_at=${now} where provider=${input.provider} and external_event_id=${input.eventId}`,
        );
        await tx.execute(
          sql`insert into audit_events (actor_type,actor_id,authenticated_session_id_hash,action,object_type,object_id,decision,reason_code,correlation_id,occurred_at,metadata_hash) values ('provider',${expert.rows[0].userId}::uuid,${`provider-verification:${input.verificationId}`},'expert_residency.settle','expert_residency_order',${order.id}::uuid,'allowed','verified_settlement',${input.eventId},${now},${digest})`,
        );
        await tx.execute(
          sql`insert into integration_outbox (idempotency_key,topic,payload,correlation_id,reconciliation_key,payload_hash) values (${`expert-residency-settled:${order.id}`},'expert.residency.settled',${outboxPayload}::jsonb,${input.eventId},${`expert-residency:${order.id}`},${outboxHash}) on conflict (idempotency_key) do nothing`,
        );
        return {
          kind: "settled",
          orderId: order.id,
          paymentId: input.paymentId,
          firstSettlement: Boolean(marker.rows[0]),
          rewardGranted,
          eligibility,
          residencyStartsAt: start.toISOString(),
          residencyEndsAt: end.toISOString(),
        };
      }),
    );
  }
  async reverse(
    input: VerifiedExpertResidencyPaymentEvent,
  ): Promise<ExpertResidencyReversalResult> {
    assertVerifiedExpertResidencyPaymentEvent(input);
    if (input.kind === "settled")
      throw new ExpertResidencySettlementError(
        "EXPERT_RESIDENCY_REVERSAL_EVENT_REQUIRED",
      );
    const reversalKind = input.kind;
    return withSerializableRetry(() =>
      this.db.transaction(async (tx) => {
        const digest = input.payloadDigest.slice("sha256:".length);
        await tx.execute(
          sql`insert into expert_residency_provider_event_inbox (provider,external_event_id,payload_digest,event_kind,identity_version,payment_id,order_id,amount_minor,currency,occurred_at,authenticated,verification_id,verifier_key_version,verified_at,status) values (${input.provider},${input.eventId},${digest},${input.kind},1,${input.paymentId},${input.orderId}::uuid,${input.amountMinor},${input.currency},${new Date(input.occurredAt)},true,${input.verificationId},${input.verifierKeyVersion},${new Date(input.verifiedAt)},'processing') on conflict (provider,external_event_id) do nothing`,
        );
        const inbox = await tx.execute<{
          payloadDigest: string;
          eventKind: string;
          paymentId: string;
          orderId: string;
          amountMinor: bigint | string;
          currency: string;
          occurredAt: Date | string;
          verificationId: string;
          verifierKeyVersion: string;
          verifiedAt: Date | string;
          status: string;
          resultPayload: unknown;
        }>(
          sql`select payload_digest as "payloadDigest",event_kind as "eventKind",payment_id as "paymentId",order_id as "orderId",amount_minor as "amountMinor",currency,occurred_at as "occurredAt",verification_id as "verificationId",verifier_key_version as "verifierKeyVersion",verified_at as "verifiedAt",status,result_payload as "resultPayload" from expert_residency_provider_event_inbox where provider=${input.provider} and external_event_id=${input.eventId} for update`,
        );
        const claimed = inbox.rows[0];
        if (
          !claimed ||
          claimed.payloadDigest !== digest ||
          claimed.eventKind !== input.kind ||
          claimed.paymentId !== input.paymentId ||
          claimed.orderId !== input.orderId ||
          BigInt(claimed.amountMinor) !== BigInt(input.amountMinor) ||
          claimed.currency !== input.currency ||
          iso(claimed.occurredAt) !== input.occurredAt ||
          claimed.verificationId !== input.verificationId ||
          claimed.verifierKeyVersion !== input.verifierKeyVersion ||
          iso(claimed.verifiedAt) !== input.verifiedAt
        )
          throw new ExpertResidencySettlementError(
            "EXPERT_RESIDENCY_PROVIDER_EVENT_CONFLICT",
          );
        const orderResult = await tx.execute<OrderRow>(
          sql`select id,expert_id as "expertId",cash_minor as "cashMinor",currency,duration_seconds as "durationSeconds",payment_deadline as "paymentDeadline",status,settled_at as "settledAt",residency_starts_at as "residencyStartsAt",residency_ends_at as "residencyEndsAt",provider_payment_id as "providerPaymentId",commercial_policy_version as "commercialPolicyVersion" from expert_residency_orders where id=${input.orderId}::uuid for update`,
        );
        const order = orderResult.rows[0];
        if (!order || order.providerPaymentId !== input.paymentId)
          throw new ExpertResidencySettlementError(
            "EXPERT_RESIDENCY_REVERSAL_PAYMENT_MISMATCH",
          );
        await tx.execute(
          sql`select id from expert_residency_payment_attempts where order_id=${order.id}::uuid and provider_request_id=${input.paymentId} for update`,
        );
        if (claimed.status === "processed") {
          const priorResult = reversalResultFromPayload(
            claimed.resultPayload,
            input.eventId,
          );
          if (!priorResult)
            throw new ExpertResidencySettlementError(
              "EXPERT_RESIDENCY_REVERSAL_RESULT_MISSING",
            );
          return priorResult;
        }
        if (order.status !== "settled")
          throw new ExpertResidencySettlementError(
            "EXPERT_RESIDENCY_REVERSAL_STATE_CONFLICT",
          );
        const prior = await tx.execute<{ amount: bigint | string }>(
          sql`select coalesce(sum(amount_minor),0)::bigint as amount from expert_residency_provider_event_inbox where provider=${input.provider} and payment_id=${input.paymentId} and event_kind in ('refunded','charged_back') and status='processed'`,
        );
        const cumulative =
          BigInt(prior.rows[0]!.amount) + BigInt(input.amountMinor);
        if (
          BigInt(input.amountMinor) <= 0n ||
          cumulative > BigInt(order.cashMinor)
        )
          throw new ExpertResidencySettlementError(
            "EXPERT_RESIDENCY_REFUND_EXCEEDS_CAPTURED_CASH",
          );
        const terminating =
          reversalKind === "charged_back" ||
          cumulative === BigInt(order.cashMinor);
        let rewardReversed = false;
        let debtMinor = 0n;
        const nowResult = await tx.execute<{ now: Date | string }>(
          sql`select transaction_timestamp() as now`,
        );
        const now = new Date(nowResult.rows[0]!.now);
        if (terminating) {
          const marker = await tx.execute<{
            id: string;
            eligibility: string;
            inviterExpertId: string | null;
          }>(
            sql`select id,eligibility,settlement_inviter_expert_id as "inviterExpertId" from expert_first_residency_settlements where qualifying_order_id=${order.id}::uuid for update`,
          );
          const maturity = await tx.execute<{ id: string; status: string }>(
            sql`select id,status from expert_referral_reward_maturities where qualifying_order_id=${order.id}::uuid for update`,
          );
          if (maturity.rows[0]?.status === "pending") {
            await tx.execute(
              sql`update expert_referral_reward_maturities set status='cancelled',cancelled_at=transaction_timestamp(),terminal_reason='terminating_provider_reversal',resolved_at=transaction_timestamp(),reason_code='terminating_provider_reversal',lease_token=null,lease_until=null,updated_at=transaction_timestamp() where id=${maturity.rows[0].id}::uuid and status='pending'`,
            );
          }
          if (
            marker.rows[0] &&
            ["pending_feature_hold", "eligible"].includes(
              marker.rows[0].eligibility,
            )
          )
            await tx.execute(
              sql`update expert_first_residency_settlements set eligibility='cancelled_by_refund',reason_code='terminating_provider_reversal' where id=${marker.rows[0].id}::uuid`,
            );
          const firstMarker = marker.rows[0];
          if (firstMarker?.inviterExpertId) {
            const lockedExpertIds = [
              order.expertId,
              firstMarker.inviterExpertId,
            ].sort();
            await tx.execute(
              sql`select id from experts where id in (${sql.join(
                lockedExpertIds.map((id) => sql`${id}::uuid`),
                sql`,`,
              )}) order by id for update`,
            );
            const repaymentBenefits = await tx.execute<{
              entryId: string;
              expertId: string;
              grantId: string;
              amountMinor: bigint | string;
            }>(
              sql`select e.id as "entryId",e.expert_id as "expertId",a.reward_grant_id as "grantId",a.amount_minor as "amountMinor" from expert_referral_ledger_entries e join expert_referral_ledger_allocations a on a.ledger_entry_id=e.id where e.entry_kind='debt_repayment' and e.source_id=${firstMarker.id}::uuid and e.source_type in ('first_settlement','held_reward_replay') order by a.reward_grant_id,e.id for update of e,a`,
            );
            for (const benefit of repaymentBenefits.rows) {
              const reversal = await tx.execute<{ id: string }>(
                sql`insert into expert_referral_ledger_entries (expert_id,entry_kind,amount_minor,original_entry_id,source_type,source_id,idempotency_key) values (${benefit.expertId}::uuid,'reversal',${-BigInt(benefit.amountMinor)},${benefit.entryId}::uuid,'provider_reversal',${order.id}::uuid,${`repayment-reversal:${benefit.entryId}`}) on conflict (idempotency_key) do nothing returning id`,
              );
              if (reversal.rows[0])
                await tx.execute(
                  sql`insert into expert_referral_ledger_allocations (ledger_entry_id,reward_grant_id,expert_id,amount_minor) values (${reversal.rows[0].id}::uuid,${benefit.grantId}::uuid,${benefit.expertId}::uuid,${-BigInt(benefit.amountMinor)})`,
                );
              rewardReversed = true;
            }
          }
          const grant = firstMarker
            ? await tx.execute<{
                id: string;
                expertId: string;
                amountMinor: bigint | string;
                originalEntryId: string;
              }>(
                sql`select g.id,g.expert_id as "expertId",e.amount_minor as "amountMinor",e.id as "originalEntryId" from expert_referral_reward_grants g join expert_referral_ledger_entries e on e.source_id=g.id and e.entry_kind='reward_grant' where g.first_settlement_id=${firstMarker.id}::uuid for update of g,e`,
              )
            : { rows: [] };
          const rewardGrant = grant.rows[0];
          if (rewardGrant) {
            const activeReservations = await tx.execute<{
              entryId: string;
              amountMinor: bigint | string;
            }>(
              sql`select e.id as "entryId",a.amount_minor as "amountMinor" from expert_referral_ledger_entries e join expert_referral_ledger_allocations a on a.ledger_entry_id=e.id where a.reward_grant_id=${rewardGrant.id}::uuid and e.entry_kind='reservation' and not exists (select 1 from expert_referral_ledger_entries r where r.original_entry_id=e.id and r.entry_kind='release') order by e.id for update of e,a`,
            );
            for (const reservation of activeReservations.rows) {
              const release = await tx.execute<{ id: string }>(
                sql`insert into expert_referral_ledger_entries (expert_id,entry_kind,amount_minor,order_id,original_entry_id,source_type,source_id,idempotency_key) select expert_id,'release',${-BigInt(reservation.amountMinor)},order_id,id,'provider_reversal',${order.id}::uuid,${`refund-release:${firstMarker!.id}:${reservation.entryId}`} from expert_referral_ledger_entries where id=${reservation.entryId}::uuid on conflict (idempotency_key) do nothing returning id`,
              );
              if (release.rows[0])
                await tx.execute(
                  sql`insert into expert_referral_ledger_allocations (ledger_entry_id,reward_grant_id,expert_id,amount_minor) values (${release.rows[0].id}::uuid,${rewardGrant.id}::uuid,${rewardGrant.expertId}::uuid,${-BigInt(reservation.amountMinor)})`,
                );
            }
            const expired = await tx.execute<{ amount: bigint | string }>(
              sql`select coalesce(sum(a.amount_minor),0)::bigint as amount from expert_referral_ledger_entries e join expert_referral_ledger_allocations a on a.ledger_entry_id=e.id where a.reward_grant_id=${rewardGrant.id}::uuid and e.entry_kind='expiry'`,
            );
            const reversible =
              BigInt(rewardGrant.amountMinor) + BigInt(expired.rows[0]!.amount);
            if (reversible > 0n) {
              const reversal = await tx.execute<{ id: string }>(
                sql`insert into expert_referral_ledger_entries (expert_id,entry_kind,amount_minor,original_entry_id,source_type,source_id,idempotency_key) values (${rewardGrant.expertId}::uuid,'reversal',${-reversible},${rewardGrant.originalEntryId}::uuid,'provider_reversal',${order.id}::uuid,${`reward-reversal:${firstMarker!.id}`}) on conflict (idempotency_key) do nothing returning id`,
              );
              if (reversal.rows[0])
                await tx.execute(
                  sql`insert into expert_referral_ledger_allocations (ledger_entry_id,reward_grant_id,expert_id,amount_minor) values (${reversal.rows[0].id}::uuid,${rewardGrant.id}::uuid,${rewardGrant.expertId}::uuid,${-reversible})`,
                );
              rewardReversed = true;
              const balance = await tx.execute<{ debt: bigint | string }>(
                sql`select debt_minor as debt from expert_referral_balances where expert_id=${rewardGrant.expertId}::uuid`,
              );
              debtMinor = BigInt(balance.rows[0]?.debt ?? 0);
            }
          }
          if (firstMarker?.inviterExpertId) {
            const balance = await tx.execute<{ debt: bigint | string }>(
              sql`select debt_minor as debt from expert_referral_balances where expert_id=${firstMarker.inviterExpertId}::uuid`,
            );
            debtMinor = BigInt(balance.rows[0]?.debt ?? 0);
          }
          await tx.execute(
            sql`update expert_residency_orders set status=${reversalKind === "charged_back" ? "charged_back" : "refunded"},updated_at=${now} where id=${order.id}::uuid`,
          );
          await tx.execute(
            sql`update expert_residency_payment_attempts set status=${reversalKind === "charged_back" ? "charged_back" : "refunded"},resolved_at=${now},updated_at=${now} where order_id=${order.id}::uuid and provider=${input.provider} and provider_request_id=${input.paymentId}`,
          );
        }
        const result: ExpertResidencyReversalResult = {
          kind: reversalKind,
          orderId: order.id,
          paymentId: input.paymentId,
          cashRefundedMinor: BigInt(input.amountMinor),
          restoredCreditMinor: 0n,
          rewardReversed,
          debtMinor,
          terminated: terminating,
        };
        await tx.execute(
          sql`update expert_residency_provider_event_inbox set status='processed',result_code=${terminating ? "terminated" : "partial_refund"},result_schema_version=1,result_payload=${JSON.stringify(reversalResultPayload(result, input.eventId))}::jsonb,processed_at=${now},updated_at=${now} where provider=${input.provider} and external_event_id=${input.eventId}`,
        );
        return result;
      }),
    );
  }
  async replayHeldReward(expertId: string): Promise<{
    readonly kind: "granted" | "not_granted";
    readonly reason: string;
  }> {
    return withSerializableRetry(() =>
      this.db.transaction(async (tx) => {
        const markerResult = await tx.execute<{
          id: string;
          eligibility: string;
          referralId: string | null;
          orderId: string;
          paymentAttemptId: string;
          active: boolean;
          verified: boolean;
          abuseCleared: boolean;
          controlVersion: number;
          inviteeUserId: string;
          inviterExpertId: string | null;
          inviterUserId: string | null;
        }>(
          sql`select m.id,m.eligibility,m.referral_id as "referralId",m.qualifying_order_id as "orderId",m.qualifying_payment_attempt_id as "paymentAttemptId",m.settlement_expert_active as active,m.settlement_expert_verified as verified,m.settlement_abuse_cleared as "abuseCleared",m.settlement_control_version as "controlVersion",m.settlement_invitee_user_id as "inviteeUserId",m.settlement_inviter_expert_id as "inviterExpertId",m.settlement_inviter_user_id as "inviterUserId" from expert_first_residency_settlements m where m.expert_id=${expertId}::uuid`,
        );
        const marker = markerResult.rows[0];
        if (!marker || marker.eligibility !== "pending_feature_hold")
          return { kind: "not_granted" as const, reason: "not_pending" };
        if (!marker.inviterExpertId || !marker.inviterUserId)
          return {
            kind: "not_granted" as const,
            reason: "snapshot_incomplete",
          };
        const order = await tx.execute<{
          status: string;
          residencyEndsAt: Date | string | null;
        }>(
          sql`select status,residency_ends_at as "residencyEndsAt" from expert_residency_orders where id=${marker.orderId}::uuid for update`,
        );
        const lockedMarker = await tx.execute<{ id: string }>(
          sql`select id from expert_first_residency_settlements where id=${marker.id}::uuid and eligibility='pending_feature_hold' for update`,
        );
        if (!lockedMarker.rows[0])
          return { kind: "not_granted" as const, reason: "not_pending" };
        const lockedExpertIds = [expertId, marker.inviterExpertId].sort();
        await tx.execute(
          sql`select id from experts where id in (${sql.join(
            lockedExpertIds.map((id) => sql`${id}::uuid`),
            sql`,`,
          )}) order by id for update`,
        );
        const payment = await tx.execute<{ status: string }>(
          sql`select status from expert_residency_payment_attempts where id=${marker.paymentAttemptId}::uuid and order_id=${marker.orderId}::uuid for update`,
        );
        const control = await tx.execute<{
          enabled: boolean;
          version: number;
        }>(
          sql`select reward_grants_enabled as enabled,version from expert_referral_feature_controls where control_key='expert_referrals' for update`,
        );
        const clock = await tx.execute<{ now: Date | string }>(
          sql`select transaction_timestamp() as now`,
        );
        const now = new Date(clock.rows[0]!.now);
        if (
          !control.rows[0]?.enabled ||
          order.rows[0]?.status !== "settled" ||
          payment.rows[0]?.status !== "settled" ||
          !order.rows[0].residencyEndsAt ||
          new Date(order.rows[0].residencyEndsAt) <= now ||
          !marker.referralId ||
          !marker.active ||
          !marker.verified ||
          !marker.abuseCleared
        )
          return { kind: "not_granted" as const, reason: "gate_closed" };
        const inviter = marker.inviterExpertId;
        await tx.execute(
          sql`update expert_first_residency_settlements set eligibility='eligible',reason_code=${`held_replay_control_v${control.rows[0].version}`} where id=${marker.id}::uuid and eligibility='pending_feature_hold'`,
        );
        const debtFacts = await tx.execute<{
          entryId: string;
          grantId: string;
          amount: bigint | string;
          createdAt: Date | string;
          expiresAt: Date | string;
        }>(
          sql`select e.id as "entryId",a.reward_grant_id as "grantId",a.amount_minor as amount,e.created_at as "createdAt",g.expires_at as "expiresAt" from expert_referral_ledger_entries e join expert_referral_ledger_allocations a on a.ledger_entry_id=e.id join expert_referral_reward_grants g on g.id=a.reward_grant_id where e.expert_id=${inviter}::uuid and e.entry_kind in ('reversal','debt_repayment') order by g.expires_at,e.created_at,a.reward_grant_id,e.id for update of e,a,g`,
        );
        const debtByGrant = new Map<
          string,
          {
            originalId: string;
            amount: bigint;
            createdAt: number;
            expiresAt: number;
          }
        >();
        for (const fact of debtFacts.rows) {
          const current = debtByGrant.get(fact.grantId);
          debtByGrant.set(fact.grantId, {
            originalId: current?.originalId ?? fact.entryId,
            amount: (current?.amount ?? 0n) + BigInt(fact.amount),
            createdAt: current?.createdAt ?? new Date(fact.createdAt).getTime(),
            expiresAt: current?.expiresAt ?? new Date(fact.expiresAt).getTime(),
          });
        }
        let rewardRemaining = 100000n;
        for (const [grantId, debt] of [...debtByGrant].sort(
          (a, b) =>
            a[1].expiresAt - b[1].expiresAt ||
            a[1].createdAt - b[1].createdAt ||
            a[0].localeCompare(b[0]),
        )) {
          const outstanding = debt.amount < 0n ? -debt.amount : 0n;
          if (outstanding === 0n || rewardRemaining === 0n) continue;
          const amount =
            outstanding < rewardRemaining ? outstanding : rewardRemaining;
          const repayment = await tx.execute<{ id: string }>(
            sql`insert into expert_referral_ledger_entries (expert_id,entry_kind,amount_minor,original_entry_id,source_type,source_id,idempotency_key) values (${inviter}::uuid,'debt_repayment',${amount},${debt.originalId}::uuid,'held_reward_replay',${marker.id}::uuid,${`reward-debt:${marker.id}:${grantId}`}) on conflict (idempotency_key) do nothing returning id`,
          );
          if (repayment.rows[0])
            await tx.execute(
              sql`insert into expert_referral_ledger_allocations (ledger_entry_id,reward_grant_id,expert_id,amount_minor) values (${repayment.rows[0].id}::uuid,${grantId}::uuid,${inviter}::uuid,${amount})`,
            );
          rewardRemaining -= amount;
        }
        if (rewardRemaining === 0n)
          return { kind: "granted" as const, reason: "debt_repaid" };
        const grant = await tx.execute<{ id: string }>(
          sql`insert into expert_referral_reward_grants (expert_id,referral_id,first_settlement_id,qualifying_order_id,qualifying_payment_attempt_id,amount_minor,granted_at,expires_at,idempotency_key) values (${inviter}::uuid,${marker.referralId}::uuid,${marker.id}::uuid,${marker.orderId}::uuid,${marker.paymentAttemptId}::uuid,100000,${now},${new Date(now.getTime() + 365 * 86400000)},${`reward:${marker.id}`}) on conflict (first_settlement_id) do nothing returning id`,
        );
        if (!grant.rows[0])
          return { kind: "not_granted" as const, reason: "already_replayed" };
        const ledger = await tx.execute<{ id: string }>(
          sql`insert into expert_referral_ledger_entries (expert_id,entry_kind,amount_minor,source_type,source_id,idempotency_key) values (${inviter}::uuid,'reward_grant',${rewardRemaining},'reward_grant',${grant.rows[0].id}::uuid,${`reward-ledger:${marker.id}`}) returning id`,
        );
        await tx.execute(
          sql`insert into expert_referral_ledger_allocations (ledger_entry_id,reward_grant_id,expert_id,amount_minor) values (${ledger.rows[0]!.id}::uuid,${grant.rows[0].id}::uuid,${inviter}::uuid,${rewardRemaining})`,
        );
        return { kind: "granted" as const, reason: "feature_enabled" };
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
    const marker = await tx.execute<{
      id: string;
      eligibility: ExpertResidencySettlementResult["eligibility"];
    }>(
      sql`select id,eligibility from expert_first_residency_settlements where qualifying_order_id=${order.id}::uuid`,
    );
    const reward = marker.rows[0]
      ? await tx.execute<{ id: string }>(
          sql`select id from expert_referral_reward_grants where first_settlement_id=${marker.rows[0].id}::uuid union all select id from expert_referral_ledger_entries where entry_kind='debt_repayment' and source_id=${marker.rows[0].id}::uuid limit 1`,
        )
      : { rows: [] };
    return {
      kind: "settled",
      orderId: order.id,
      paymentId,
      firstSettlement: Boolean(marker.rows[0]),
      rewardGranted: Boolean(reward.rows[0]),
      eligibility: marker.rows[0]?.eligibility ?? "permanently_ineligible",
      residencyStartsAt: iso(order.residencyStartsAt),
      residencyEndsAt: iso(order.residencyEndsAt),
    };
  }
}
