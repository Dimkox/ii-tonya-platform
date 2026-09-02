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
  readonly creditChanged: number;
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
  orderProvider: string | null;
  orderProviderPaymentId: string | null;
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
    event.provider !== row.orderProvider ||
    event.paymentId !== row.orderProviderPaymentId ||
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
      let creditChanged = 0;
      let failed = 0;
      for (const candidate of candidates) {
        try {
          const result = await tx.transaction((itemTx) =>
            this.financial.releaseExpiredOrderInTransaction(itemTx, {
              orderId: candidate.orderId,
            }),
          );
          if (result.kind === "expired") {
            changed += 1;
            if (result.released) creditChanged += 1;
          }
        } catch {
          failed += 1;
        }
      }
      return { examined: candidates.length, changed, creditChanged, failed };
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
      // Match the established financial lock order. Each lock is its own
      // statement so a waiter never projects from the statement snapshot that
      // existed before the conflicting state machine committed.
      await tx.execute(sql`select feature_key
        from expert_referral_feature_controls
        where feature_key = 'expert_referrals' for update`);
      const resolved = (
        await tx.execute<{ orderId: string }>(sql`select order_id as "orderId"
          from expert_residency_payment_attempts
          where id = ${candidate.attemptId}::uuid`)
      ).rows[0];
      if (resolved === undefined) throw new Error("reconciliation_claim_lost");
      await tx.execute(sql`select id from expert_residency_orders
        where id = ${resolved.orderId}::uuid for update`);
      const claimedAttempt = (
        await tx.execute<{ attemptId: string }>(sql`select id as "attemptId"
          from expert_residency_payment_attempts
          where id = ${candidate.attemptId}::uuid
            and order_id = ${resolved.orderId}::uuid
            and provider_request_id = ${candidate.providerPaymentId}
            and updated_at = ${candidate.claimedAt}::timestamptz
          for update`)
      ).rows[0];
      if (claimedAttempt === undefined)
        throw new Error("reconciliation_claim_lost");
      await tx.execute(sql`select id from expert_first_residency_settlements
        where qualifying_order_id = ${resolved.orderId}::uuid
        order by id for update`);
      await tx.execute(sql`select referral.id from expert_referrals referral
        join expert_residency_orders orders
          on orders.expert_id = referral.invitee_expert_id
        where orders.id = ${resolved.orderId}::uuid
        order by referral.id for update of referral`);
      await tx.execute(sql`select grant_row.id
        from expert_referral_reward_grants grant_row
        where grant_row.qualifying_order_id = ${resolved.orderId}::uuid
          or grant_row.referral_id in (
            select referral.id from expert_referrals referral
            join expert_residency_orders orders
              on orders.expert_id = referral.invitee_expert_id
            where orders.id = ${resolved.orderId}::uuid
          )
        order by grant_row.id for update`);
      await tx.execute(sql`select entry.id
        from expert_referral_ledger_entries entry
        where entry.account_expert_id in (
            select orders.expert_id from expert_residency_orders orders
              where orders.id = ${resolved.orderId}::uuid
            union
            select referral.inviter_expert_id from expert_referrals referral
              join expert_residency_orders orders
                on orders.expert_id = referral.invitee_expert_id
              where orders.id = ${resolved.orderId}::uuid
          )
          or (entry.source_type = 'residency_order'
            and entry.source_id = ${resolved.orderId}::uuid)
          or entry.reward_grant_id in (
            select id from expert_referral_reward_grants
              where qualifying_order_id = ${resolved.orderId}::uuid
          )
        order by entry.created_at, entry.id for update`);
      await tx.execute(sql`select allocation.ledger_entry_id,
          allocation.reward_grant_id
        from expert_referral_ledger_allocations allocation
        join expert_referral_ledger_entries entry
          on entry.id = allocation.ledger_entry_id
        where entry.account_expert_id in (
            select orders.expert_id from expert_residency_orders orders
              where orders.id = ${resolved.orderId}::uuid
            union
            select referral.inviter_expert_id from expert_referrals referral
              join expert_residency_orders orders
                on orders.expert_id = referral.invitee_expert_id
              where orders.id = ${resolved.orderId}::uuid
          )
          or (entry.source_type = 'residency_order'
            and entry.source_id = ${resolved.orderId}::uuid)
        order by allocation.ledger_entry_id, allocation.reward_grant_id
        for update of allocation`);
      await tx.execute(sql`select residency.id
        from expert_residency_orders residency
        join expert_residency_orders candidate_order
          on candidate_order.expert_id = residency.expert_id
        where candidate_order.id = ${resolved.orderId}::uuid
        order by residency.residency_starts_at nulls first,
          residency.residency_ends_at nulls first, residency.id
        for update of residency`);

      // READ COMMITTED gives this statement a fresh snapshot after every
      // relevant row has been locked.
      const row = (
        await tx.execute<ReconciliationRow>(sql`
          select p.id as "attemptId", p.order_id as "orderId",
            o.expert_id as "expertId", p.provider,
            p.provider_request_id as "providerPaymentId",
            o.payment_provider as "orderProvider",
            o.provider_payment_id as "orderProviderPaymentId",
            p.expected_amount_minor as "expectedAmountMinor", p.currency,
            p.status as "attemptStatus", o.status as "orderStatus",
            (
              order_ledger.reservation_minor = o.credit_minor
              and order_ledger.allocation_shape_valid
              and case
                when o.status in ('quoted', 'payment_pending') then
                  order_ledger.active_reserved_minor = o.credit_minor
                  and order_ledger.terminal_minor = 0
                when o.settled_at is not null then
                  order_ledger.active_reserved_minor = 0
                  and order_ledger.spent_minor = o.credit_minor
                  and order_ledger.released_minor = 0
                else order_ledger.active_reserved_minor = 0
                  and order_ledger.released_minor = o.credit_minor
                  and order_ledger.spent_minor = 0
              end
            ) as "reservationProjectionValid",
            (
              case when first_reward.reward_expected
                then first_reward.grant_count = 1
                  and first_reward.exact_grant_count = 1
                else first_reward.grant_count = 0
              end
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
                  'reward_grant', 'reservation', 'release', 'spend', 'expiry',
                  'reversal', 'debt_repayment'
                )
              group by entry.id, entry.amount_minor
              having coalesce(sum(allocation.amount_minor), 0)
                <> abs(entry.amount_minor)
            ) as "ledgerBalanceProjectionValid",
            not exists (
              select 1
              from expert_referral_ledger_entries reversal
              left join expert_referral_reward_grants grant_row
                on grant_row.id = reversal.source_id
              left join expert_referral_ledger_entries original
                on original.id = reversal.original_entry_id
              where reversal.account_expert_id in (
                o.expert_id,
                coalesce((select referral.inviter_expert_id
                  from expert_referrals referral
                  where referral.invitee_expert_id = o.expert_id), o.expert_id)
              )
                and reversal.entry_kind = 'reversal'
              group by reversal.id, reversal.amount_minor, reversal.source_type,
                reversal.source_id, reversal.account_expert_id, grant_row.id,
                grant_row.inviter_expert_id, original.entry_kind,
                original.reward_grant_id
              having reversal.source_type <> 'reward_grant'
                or grant_row.id is null
                or grant_row.inviter_expert_id <> reversal.account_expert_id
                or original.entry_kind <> 'reward_grant'
                or original.reward_grant_id <> grant_row.id
                or (select coalesce(sum(a.amount_minor), 0)
                  from expert_referral_ledger_allocations a
                  where a.ledger_entry_id = reversal.id)
                    <> -reversal.amount_minor
                or (select coalesce(sum(repayment.amount_minor), 0)
                  from expert_referral_ledger_entries repayment
                  where repayment.original_entry_id = reversal.id
                    and repayment.entry_kind = 'debt_repayment')
                    > -reversal.amount_minor
                or exists (
                  select 1 from expert_referral_ledger_entries repayment_row
                  where repayment_row.original_entry_id = reversal.id
                    and repayment_row.entry_kind = 'debt_repayment'
                    and (repayment_row.source_type <> 'reward_grant'
                      or repayment_row.source_id = reversal.source_id
                      or repayment_row.account_expert_id
                        <> reversal.account_expert_id
                      or not exists (
                        select 1 from expert_referral_reward_grants repayment_grant
                        where repayment_grant.id = repayment_row.source_id
                          and repayment_grant.inviter_expert_id
                            = repayment_row.account_expert_id
                      )
                      or not exists (
                        select 1
                        from expert_referral_ledger_allocations repayment_a
                        where repayment_a.ledger_entry_id = repayment_row.id
                        group by repayment_a.ledger_entry_id
                        having count(*) = 1
                          and min(repayment_a.reward_grant_id::text)
                            = repayment_row.source_id::text
                          and sum(repayment_a.amount_minor)
                            = repayment_row.amount_minor
                      ))
                )
            ) as "debtProjectionValid",
            case
              when o.status = 'settled' then
                o.settled_at is not null
                and o.residency_starts_at is not null
                and o.residency_ends_at is not null
                and o.residency_starts_at >= o.settled_at
                and extract(epoch from
                  (o.residency_ends_at - o.residency_starts_at))
                  = o.duration_seconds
              when o.status in ('refunded', 'charged_back')
                and o.settled_at is not null then
                o.residency_starts_at is not null
                and o.residency_ends_at is not null
                and o.residency_starts_at >= o.settled_at
                and extract(epoch from
                  (o.residency_ends_at - o.residency_starts_at))
                  = o.duration_seconds
              else o.settled_at is null
                and o.residency_starts_at is null
                and o.residency_ends_at is null
            end as "residencyActivationValid"
          from expert_residency_payment_attempts p
          join expert_residency_orders o on o.id = p.order_id
          left join lateral (
            select
              coalesce(sum(-reservation.amount_minor), 0)::bigint
                as reservation_minor,
              coalesce(sum(-reservation.amount_minor) filter (
                where terminal.id is null
              ), 0)::bigint as active_reserved_minor,
              coalesce(sum(abs(terminal.amount_minor)), 0)::bigint
                as terminal_minor,
              coalesce(sum(-terminal.amount_minor) filter (
                where terminal.entry_kind = 'spend'
              ), 0)::bigint as spent_minor,
              coalesce(sum(terminal.amount_minor) filter (
                where terminal.entry_kind = 'release'
              ), 0)::bigint as released_minor,
              coalesce(bool_and(
                coalesce((select sum(a.amount_minor)
                  from expert_referral_ledger_allocations a
                  where a.ledger_entry_id = reservation.id), 0)
                    = -reservation.amount_minor
                and (terminal.id is null or (
                  abs(terminal.amount_minor) = -reservation.amount_minor
                  and coalesce((select sum(a.amount_minor)
                    from expert_referral_ledger_allocations a
                    where a.ledger_entry_id = terminal.id), 0)
                      = abs(terminal.amount_minor)
                  and not exists (
                    select 1
                    from expert_referral_ledger_allocations reservation_a
                    full join expert_referral_ledger_allocations terminal_a
                      on terminal_a.ledger_entry_id = terminal.id
                      and terminal_a.reward_grant_id
                        = reservation_a.reward_grant_id
                    where reservation_a.ledger_entry_id = reservation.id
                      and (terminal_a.reward_grant_id is null
                        or terminal_a.amount_minor
                          <> reservation_a.amount_minor)
                  )
                ))
              ), true) as allocation_shape_valid
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
              coalesce(bool_or(marker.eligibility_status = 'eligible'
                and referral.id is not null), false) as reward_expected,
              count(grant_row.id)::integer as grant_count,
              count(grant_row.id) filter (where
                grant_row.inviter_expert_id = referral.inviter_expert_id
                and grant_row.referral_id = referral.id
                and grant_row.first_settlement_id = marker.id
                and grant_row.qualifying_order_id = o.id
                and grant_row.amount_minor = 100000
                and extract(epoch from
                  (grant_row.expires_at - grant_row.granted_at)) = 31536000
                and exists (
                  select 1 from expert_referral_ledger_entries reward
                  where reward.entry_kind = 'reward_grant'
                    and reward.reward_grant_id = grant_row.id
                    and reward.account_expert_id = grant_row.inviter_expert_id
                    and reward.source_type = 'reward_grant'
                    and reward.source_id = grant_row.id
                    and reward.amount_minor = grant_row.amount_minor
                    and (select coalesce(sum(a.amount_minor), 0)
                      from expert_referral_ledger_allocations a
                      where a.ledger_entry_id = reward.id
                        and a.reward_grant_id = grant_row.id)
                      = grant_row.amount_minor
                )
              )::integer as exact_grant_count
            from expert_first_residency_settlements marker
            left join expert_referrals referral
              on referral.invitee_expert_id = marker.expert_id
            left join expert_referral_reward_grants grant_row
              on grant_row.first_settlement_id = marker.id
              and grant_row.qualifying_order_id = marker.qualifying_order_id
            where marker.qualifying_order_id = o.id
          ) first_reward on true
          where p.id = ${candidate.attemptId}::uuid
            and o.id = ${resolved.orderId}::uuid
            and p.provider_request_id = ${candidate.providerPaymentId}
            and p.updated_at = ${candidate.claimedAt}::timestamptz
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
          order by orders.updated_at, marker.settlement_sequence, marker.id
          for update of orders skip locked
          limit ${command.batchSize}
        `)
      ).rows;
      if (candidates.length > 0) {
        const claimedOrderIds = sql.join(
          candidates.map(
            ({ qualifyingOrderId }) => sql`${qualifyingOrderId}::uuid`,
          ),
          sql`, `,
        );
        // This cursor is part of the outer claim transaction, not the
        // per-item savepoint. A still-held or poisoned oldest row therefore
        // moves behind untouched work without losing retry visibility.
        await tx.execute(sql`update expert_residency_orders
          set updated_at = clock_timestamp()
          where id in (${claimedOrderIds})`);
      }
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
