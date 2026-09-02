import { createHash } from "node:crypto";
import {
  requireVerifiedExpertResidencyPaymentEvent,
  type VerifiedExpertResidencyPaymentEvent,
} from "@ii-tonya/integrations";
import { sql } from "drizzle-orm";
import type { DrizzleDb } from "../client.js";
import type { ExpertReferralTransaction } from "./expert-referral-control-repository.js";
import {
  PostgresExpertResidencyProviderInboxRepository,
  type HeldRewardReplayResult,
} from "./expert-residency-provider-inbox-repository.js";
import {
  PostgresExpertResidencyRepository,
  type ExpiryReleaseResult,
} from "./expert-residency-repository.js";

export interface ExpertReferralWorkerBatchCommand {
  readonly now: Date;
  readonly batchSize: number;
}

export interface ExpertReferralWorkerBatchResult {
  readonly examined: number;
  readonly changed: number;
  readonly failed: number;
}

export interface ExpertResidencyReconciliationCandidate extends Record<
  string,
  unknown
> {
  readonly attemptId: string;
  readonly providerPaymentId: string;
  readonly claimedAt: string;
}

export interface ExpertReferralHoldReplayBatchResult {
  readonly examined: number;
  readonly granted: number;
  readonly debtRepaid: number;
  readonly ineligible: number;
  readonly cancelled: number;
  readonly stillHeld: number;
  readonly failed: number;
}

interface WorkerFinancialStateMachine {
  releaseExpiredOrderInTransaction(
    tx: ExpertReferralTransaction,
    command: { readonly orderId: string },
  ): Promise<ExpiryReleaseResult>;
  replayHeldRewardInTransaction(
    tx: ExpertReferralTransaction,
    command: {
      readonly expertId: string;
      readonly qualifyingOrderId: string;
    },
  ): Promise<HeldRewardReplayResult>;
}

interface ReconciliationRow extends Record<string, unknown> {
  attemptId: string;
  orderId: string;
  expertId: string;
  provider: string;
  providerPaymentId: string;
  expectedAmountMinor: bigint | string;
  currency: string;
  attemptStatus:
    | "created"
    | "pending"
    | "unknown_outcome"
    | "succeeded"
    | "failed"
    | "cancelled";
  orderStatus:
    | "quoted"
    | "payment_pending"
    | "settled"
    | "failed"
    | "expired"
    | "refunded"
    | "charged_back";
  reservationProjectionValid: boolean;
  rewardGrantProjectionValid: boolean;
  ledgerBalanceProjectionValid: boolean;
  debtProjectionValid: boolean;
  residencyActivationValid: boolean;
}

type ReconciliationMismatchCode =
  | "provider_identity"
  | "provider_state"
  | "reservation_projection"
  | "reward_grant_projection"
  | "ledger_balance_projection"
  | "debt_projection"
  | "residency_activation";

function assertBatch(command: ExpertReferralWorkerBatchCommand): void {
  if (
    !(command.now instanceof Date) ||
    !Number.isFinite(command.now.getTime()) ||
    !Number.isSafeInteger(command.batchSize) ||
    command.batchSize < 1 ||
    command.batchSize > 1_000
  ) {
    throw new Error("invalid_worker_batch_size");
  }
}

function digest(value: unknown): string {
  return `sha256:${createHash("sha256").update(JSON.stringify(value)).digest("hex")}`;
}

function reconciliationMismatchCodes(
  row: ReconciliationRow,
  event: VerifiedExpertResidencyPaymentEvent,
): readonly ReconciliationMismatchCode[] {
  const codes: ReconciliationMismatchCode[] = [];
  if (
    event.provider !== row.provider ||
    event.paymentId !== row.providerPaymentId ||
    event.orderId !== row.orderId ||
    event.amountMinor !== BigInt(row.expectedAmountMinor).toString() ||
    event.currency !== row.currency
  ) {
    codes.push("provider_identity");
  }
  let stateMatches: boolean;
  if (event.kind === "settled") {
    stateMatches =
      row.attemptStatus === "succeeded" && row.orderStatus === "settled";
  } else if (event.kind === "refunded") {
    stateMatches = row.orderStatus === "refunded";
  } else {
    stateMatches = row.orderStatus === "charged_back";
  }
  if (!stateMatches) codes.push("provider_state");
  if (!row.reservationProjectionValid) codes.push("reservation_projection");
  if (!row.rewardGrantProjectionValid) codes.push("reward_grant_projection");
  if (!row.ledgerBalanceProjectionValid)
    codes.push("ledger_balance_projection");
  if (!row.debtProjectionValid) codes.push("debt_projection");
  if (!row.residencyActivationValid) codes.push("residency_activation");
  return codes;
}

export class PostgresExpertReferralWorkerRepository {
  private readonly financial: WorkerFinancialStateMachine;

  constructor(
    private readonly db: DrizzleDb,
    financial?: WorkerFinancialStateMachine,
  ) {
    if (financial !== undefined) {
      this.financial = financial;
      return;
    }
    const residency = new PostgresExpertResidencyRepository(db);
    const providerInbox = new PostgresExpertResidencyProviderInboxRepository(
      db,
    );
    this.financial = {
      releaseExpiredOrderInTransaction: (tx, command) =>
        residency.releaseExpiredOrderInTransaction(tx, command),
      replayHeldRewardInTransaction: (tx, command) =>
        providerInbox.replayHeldRewardInTransaction(tx, command),
    };
  }

  async expireDueBatch(
    command: ExpertReferralWorkerBatchCommand,
  ): Promise<ExpertReferralWorkerBatchResult> {
    assertBatch(command);
    return this.db.transaction(async (tx) => {
      const candidates = (
        await tx.execute<{ orderId: string }>(sql`
          select id as "orderId"
          from expert_residency_orders
          where status in ('quoted', 'payment_pending')
            and payment_deadline <= transaction_timestamp()
          order by payment_deadline, id
          for update skip locked
          limit ${command.batchSize}
        `)
      ).rows;
      let changed = 0;
      let failed = 0;
      for (const candidate of candidates) {
        try {
          const result = await tx.transaction((itemTx) =>
            this.financial.releaseExpiredOrderInTransaction(itemTx, {
              orderId: candidate.orderId,
            }),
          );
          if (result.kind === "expired") changed += 1;
        } catch {
          failed += 1;
        }
      }
      return { examined: candidates.length, changed, failed };
    });
  }

  async claimReconciliationBatch(
    command: ExpertReferralWorkerBatchCommand,
  ): Promise<readonly ExpertResidencyReconciliationCandidate[]> {
    assertBatch(command);
    return this.db.transaction(async (tx) => {
      const rows = (
        await tx.execute<ExpertResidencyReconciliationCandidate>(sql`
          with candidates as materialized (
            select id, provider_request_id
            from expert_residency_payment_attempts
            where status in ('pending', 'unknown_outcome', 'succeeded', 'cancelled')
              and updated_at <= transaction_timestamp() - interval '5 minutes'
            order by updated_at, id
            for update skip locked
            limit ${command.batchSize}
          )
          update expert_residency_payment_attempts attempts
          set updated_at = clock_timestamp()
          from candidates
          where attempts.id = candidates.id
          returning attempts.id as "attemptId",
            candidates.provider_request_id as "providerPaymentId",
            attempts.updated_at::text as "claimedAt"
        `)
      ).rows;
      return rows.map((row) => ({
        attemptId: row.attemptId,
        providerPaymentId: row.providerPaymentId,
        claimedAt: row.claimedAt,
      }));
    });
  }

  async compareAndRecordReconciliation(
    candidate: ExpertResidencyReconciliationCandidate,
    verifiedEvent: unknown,
  ): Promise<"matched" | "mismatch"> {
    const event = requireVerifiedExpertResidencyPaymentEvent(verifiedEvent);
    return this.db.transaction(async (tx) => {
      // All referral financial state machines take this lock before their
      // order/account locks. Holding it makes the complete projection below a
      // stable snapshot without inventing a second lock order.
      await tx.execute(sql`select feature_key
        from expert_referral_feature_controls
        where feature_key = 'expert_referrals' for update`);
      const row = (
        await tx.execute<ReconciliationRow>(sql`
          select p.id as "attemptId", p.order_id as "orderId",
            o.expert_id as "expertId", p.provider,
            p.provider_request_id as "providerPaymentId",
            p.expected_amount_minor as "expectedAmountMinor", p.currency,
            p.status as "attemptStatus", o.status as "orderStatus",
            (
              coalesce(order_ledger.active_reserved_minor, 0) = case
                when o.status in ('quoted', 'payment_pending') then o.credit_minor
                else 0
              end
              and coalesce(order_ledger.spent_minor, 0) = case
                when o.settled_at is not null then o.credit_minor else 0
              end
            ) as "reservationProjectionValid",
            (
              coalesce(first_reward.eligible_count, 0)
                = coalesce(first_reward.grant_count, 0)
              and coalesce(first_reward.grant_count, 0) <= 1
            ) as "rewardGrantProjectionValid",
            not exists (
              select 1
              from expert_referral_ledger_entries entry
              left join expert_referral_ledger_allocations allocation
                on allocation.ledger_entry_id = entry.id
              where entry.account_expert_id in (
                o.expert_id,
                coalesce((select referral.inviter_expert_id
                  from expert_referrals referral
                  where referral.invitee_expert_id = o.expert_id), o.expert_id)
              )
                and entry.entry_kind in (
                  'reward_grant', 'reservation', 'release', 'spend', 'expiry'
                )
              group by entry.id, entry.amount_minor
              having coalesce(sum(allocation.amount_minor), 0)
                <> abs(entry.amount_minor)
            ) as "ledgerBalanceProjectionValid",
            not exists (
              select 1
              from expert_referral_ledger_entries reversal
              left join expert_referral_ledger_entries repayment
                on repayment.original_entry_id = reversal.id
                and repayment.entry_kind = 'debt_repayment'
              where reversal.account_expert_id in (
                o.expert_id,
                coalesce((select referral.inviter_expert_id
                  from expert_referrals referral
                  where referral.invitee_expert_id = o.expert_id), o.expert_id)
              )
                and reversal.entry_kind = 'reversal'
              group by reversal.id, reversal.amount_minor
              having coalesce(sum(repayment.amount_minor), 0)
                > -reversal.amount_minor
            ) as "debtProjectionValid",
            case
              when o.status = 'settled' then
                o.settled_at is not null
                and o.residency_starts_at is not null
                and o.residency_ends_at is not null
                and o.residency_starts_at >= o.settled_at
              when o.status in ('refunded', 'charged_back')
                and o.settled_at is not null then
                o.residency_starts_at is not null
                and o.residency_ends_at is not null
                and o.residency_starts_at >= o.settled_at
              else o.settled_at is null
                and o.residency_starts_at is null
                and o.residency_ends_at is null
            end as "residencyActivationValid"
          from expert_residency_payment_attempts p
          join expert_residency_orders o on o.id = p.order_id
          left join lateral (
            select
              coalesce(sum(-reservation.amount_minor) filter (
                where terminal.id is null
              ), 0)::bigint as active_reserved_minor,
              coalesce(sum(-terminal.amount_minor) filter (
                where terminal.entry_kind = 'spend'
              ), 0)::bigint as spent_minor
            from expert_referral_ledger_entries reservation
            left join expert_referral_ledger_entries terminal
              on terminal.original_entry_id = reservation.id
              and terminal.entry_kind in ('release', 'spend')
            where reservation.entry_kind = 'reservation'
              and reservation.source_type = 'residency_order'
              and reservation.source_id = o.id
          ) order_ledger on true
          left join lateral (
            select
              count(*) filter (
                where marker.eligibility_status = 'eligible'
                  and referral.id is not null
              )::integer as eligible_count,
              count(grant_row.id)::integer as grant_count
            from expert_first_residency_settlements marker
            left join expert_referrals referral
              on referral.invitee_expert_id = marker.expert_id
            left join expert_referral_reward_grants grant_row
              on grant_row.first_settlement_id = marker.id
              and grant_row.qualifying_order_id = marker.qualifying_order_id
            where marker.qualifying_order_id = o.id
          ) first_reward on true
          where p.id = ${candidate.attemptId}::uuid
            and p.provider_request_id = ${candidate.providerPaymentId}
            and p.updated_at = ${candidate.claimedAt}::timestamptz
          for update of p, o
        `)
      ).rows[0];
      if (row === undefined) throw new Error("reconciliation_claim_lost");
      const mismatchCodes = reconciliationMismatchCodes(row, event);
      if (mismatchCodes.length === 0) return "matched";

      const incident = {
        attemptId: row.attemptId,
        orderId: row.orderId,
        provider: row.provider,
        localAttemptStatus: row.attemptStatus,
        localOrderStatus: row.orderStatus,
        verifiedEventKind: event.kind,
        verifiedPayloadDigest: event.payloadDigest,
        mismatchCodes,
      };
      const incidentHash = digest(incident);
      await tx.execute(sql`
        with created as (
          insert into integration_outbox (
            idempotency_key, topic, payload, correlation_id,
            reconciliation_key, payload_hash
          ) values (
            ${`expert-residency-reconciliation:${row.attemptId}:${incidentHash}`},
            'worker.expert_residency_reconciliation_mismatch',
            ${JSON.stringify(incident)}::jsonb,
            ${`expert-residency-reconciliation:${row.attemptId}`},
            ${`expert-residency:${row.orderId}`},
            ${incidentHash}
          ) on conflict (idempotency_key) do nothing
          returning id
        )
        insert into audit_events (
          actor_type, actor_id, authenticated_session_id_hash, action,
          object_type, object_id, decision, reason_code, correlation_id,
          occurred_at, metadata_hash
        )
        select 'system', ${row.expertId}::uuid, 'worker:expert-residency-reconciliation',
          'worker.expert_residency_reconciliation_mismatch',
          'expert_residency_payment_attempt', ${row.attemptId}::uuid,
          'blocked', 'verified_fact_mismatch',
          ${`expert-residency-reconciliation:${row.attemptId}`},
          transaction_timestamp(), ${incidentHash}
        from created
      `);
      return "mismatch";
    });
  }

  async replayDueBatch(
    command: ExpertReferralWorkerBatchCommand,
  ): Promise<ExpertReferralHoldReplayBatchResult> {
    assertBatch(command);
    return this.db.transaction(async (tx) => {
      // Keep the global control lock first, matching the Task 7 settlement and
      // refund lock order. The order row is the durable, schema-free claim.
      await tx.execute(sql`select feature_key
        from expert_referral_feature_controls
        where feature_key = 'expert_referrals' for update`);
      const candidates = (
        await tx.execute<{
          expertId: string;
          qualifyingOrderId: string;
        }>(sql`
          select marker.expert_id as "expertId",
            marker.qualifying_order_id as "qualifyingOrderId"
          from expert_first_residency_settlements marker
          join expert_residency_orders orders
            on orders.id = marker.qualifying_order_id
          where marker.eligibility_status = 'pending_feature_hold'
          order by marker.settlement_sequence, marker.id
          for update of orders skip locked
          limit ${command.batchSize}
        `)
      ).rows;
      let granted = 0;
      let debtRepaid = 0;
      let ineligible = 0;
      let cancelled = 0;
      let stillHeld = 0;
      let failed = 0;
      for (const candidate of candidates) {
        try {
          const result = await tx.transaction((itemTx) =>
            this.financial.replayHeldRewardInTransaction(itemTx, candidate),
          );
          switch (result.kind) {
            case "reward_granted":
              granted += 1;
              break;
            case "debt_repaid":
              debtRepaid += 1;
              break;
            case "cancelled_by_refund":
              cancelled += 1;
              break;
            case "still_held":
              stillHeld += 1;
              break;
            case "ineligible":
            case "terminated_after_grant":
              ineligible += 1;
              break;
          }
        } catch {
          failed += 1;
        }
      }
      return {
        examined: candidates.length,
        granted,
        debtRepaid,
        ineligible,
        cancelled,
        stillHeld,
        failed,
      };
    });
  }
}
