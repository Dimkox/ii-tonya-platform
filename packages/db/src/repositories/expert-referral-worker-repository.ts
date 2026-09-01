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
  replayHeldReward(command: {
    readonly expertId: string;
    readonly qualifyingOrderId: string;
  }): Promise<HeldRewardReplayResult>;
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
}

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

function reconciliationMatches(
  row: ReconciliationRow,
  event: VerifiedExpertResidencyPaymentEvent,
): boolean {
  if (
    event.provider !== row.provider ||
    event.paymentId !== row.providerPaymentId ||
    event.orderId !== row.orderId ||
    event.amountMinor !== BigInt(row.expectedAmountMinor).toString() ||
    event.currency !== row.currency
  ) {
    return false;
  }
  if (event.kind === "settled") {
    return row.attemptStatus === "succeeded" && row.orderStatus === "settled";
  }
  if (event.kind === "refunded") return row.orderStatus === "refunded";
  return row.orderStatus === "charged_back";
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
      replayHeldReward: (command) => providerInbox.replayHeldReward(command),
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
            order by updated_at, id
            for update skip locked
            limit ${command.batchSize}
          )
          update expert_residency_payment_attempts attempts
          set updated_at = clock_timestamp()
          from candidates
          where attempts.id = candidates.id
          returning attempts.id as "attemptId",
            candidates.provider_request_id as "providerPaymentId"
        `)
      ).rows;
      return rows.map((row) => ({
        attemptId: row.attemptId,
        providerPaymentId: row.providerPaymentId,
      }));
    });
  }

  async compareAndRecordReconciliation(
    candidate: ExpertResidencyReconciliationCandidate,
    verifiedEvent: unknown,
  ): Promise<"matched" | "mismatch"> {
    const event = requireVerifiedExpertResidencyPaymentEvent(verifiedEvent);
    return this.db.transaction(async (tx) => {
      const row = (
        await tx.execute<ReconciliationRow>(sql`
          select p.id as "attemptId", p.order_id as "orderId",
            o.expert_id as "expertId", p.provider,
            p.provider_request_id as "providerPaymentId",
            p.expected_amount_minor as "expectedAmountMinor", p.currency,
            p.status as "attemptStatus", o.status as "orderStatus"
          from expert_residency_payment_attempts p
          join expert_residency_orders o on o.id = p.order_id
          where p.id = ${candidate.attemptId}::uuid
          for update of p, o
        `)
      ).rows[0];
      if (
        row === undefined ||
        row.providerPaymentId !== candidate.providerPaymentId
      ) {
        throw new Error("reconciliation_candidate_conflict");
      }
      if (reconciliationMatches(row, event)) return "matched";

      const incident = {
        attemptId: row.attemptId,
        orderId: row.orderId,
        provider: row.provider,
        localAttemptStatus: row.attemptStatus,
        localOrderStatus: row.orderStatus,
        verifiedEventKind: event.kind,
        verifiedPayloadDigest: event.payloadDigest,
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
    const candidates = await this.db.transaction(
      async (tx) =>
        (
          await tx.execute<{
            expertId: string;
            qualifyingOrderId: string;
          }>(sql`
          select expert_id as "expertId", qualifying_order_id as "qualifyingOrderId"
          from expert_first_residency_settlements
          where eligibility_status = 'pending_feature_hold'
          order by settlement_sequence, id
          for update skip locked
          limit ${command.batchSize}
        `)
        ).rows,
    );
    let granted = 0;
    let debtRepaid = 0;
    let ineligible = 0;
    let cancelled = 0;
    let stillHeld = 0;
    let failed = 0;
    for (const candidate of candidates) {
      try {
        const result = await this.financial.replayHeldReward(candidate);
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
  }
}
