import { sql } from "drizzle-orm";
import type { DrizzleDb } from "../client.js";
import { PostgresExpertResidencyProviderInboxRepository } from "./expert-residency-provider-inbox-repository.js";
import { PostgresExpertResidencyRepository } from "./expert-residency-repository.js";

export interface ExpertReferralWorkerBatchCommand {
  readonly now: Date;
  readonly batchSize: number;
}

export interface ExpertResidencyWorkerBatchResult {
  readonly examined: number;
  readonly changed: number;
  readonly failed: number;
}

export interface ExpertReferralHoldReplayBatchResult {
  readonly examined: number;
  readonly granted: number;
  readonly cancelled: number;
}

export type ExpertResidencyWorkerPaymentStatus =
  | "settled"
  | "refunded"
  | "charged_back";

export interface ExpertResidencyWorkerPayment {
  readonly orderId: string;
  readonly provider: string;
  readonly paymentId: string;
  readonly amountMinor: string;
  readonly currency: "RUB";
  readonly status: ExpertResidencyWorkerPaymentStatus;
}

export interface ExpertResidencyWorkerMismatch {
  readonly orderId: string;
  readonly provider: string;
  readonly paymentId: string;
  readonly reason: "missing" | "status" | "amount" | "currency";
  readonly localStatus: ExpertResidencyWorkerPaymentStatus;
  readonly providerStatus?: ExpertResidencyWorkerPaymentStatus;
}

interface ResidencyExpiryPort {
  releaseExpiredOrders(limit: number): Promise<{
    readonly examined: number;
    readonly released: number;
  }>;
}

interface HeldRewardReplayPort {
  replayHeldReward(expertId: string): Promise<{
    readonly kind: "granted" | "not_granted";
    readonly reason: string;
  }>;
}

function assertBatch(command: ExpertReferralWorkerBatchCommand): void {
  if (
    !Number.isFinite(command.now.getTime()) ||
    !Number.isSafeInteger(command.batchSize) ||
    command.batchSize < 1 ||
    command.batchSize > 1_000
  ) {
    throw new Error("invalid_expert_referral_worker_batch");
  }
}

function money(value: bigint | string | number): string {
  const parsed = BigInt(value);
  if (parsed < 0n || parsed > 999_999_999_999n) {
    throw new Error("invalid_expert_residency_worker_money");
  }
  return parsed.toString();
}

function paymentStatus(value: string): ExpertResidencyWorkerPaymentStatus {
  if (value !== "settled" && value !== "refunded" && value !== "charged_back") {
    throw new Error("invalid_expert_residency_worker_status");
  }
  return value;
}

export class PostgresExpertReferralWorkerRepository {
  readonly #residency: ResidencyExpiryPort;
  readonly #heldRewards: HeldRewardReplayPort;

  constructor(
    private readonly db: DrizzleDb,
    dependencies: {
      readonly residency?: ResidencyExpiryPort;
      readonly heldRewards?: HeldRewardReplayPort;
    } = {},
  ) {
    this.#residency =
      dependencies.residency ?? new PostgresExpertResidencyRepository(db);
    this.#heldRewards =
      dependencies.heldRewards ??
      new PostgresExpertResidencyProviderInboxRepository(db);
  }

  async expireDueBatch(
    command: ExpertReferralWorkerBatchCommand,
  ): Promise<ExpertResidencyWorkerBatchResult> {
    assertBatch(command);
    // Financial deadline authority stays on PostgreSQL transaction_timestamp().
    const result = await this.#residency.releaseExpiredOrders(command.batchSize);
    return {
      examined: result.examined,
      changed: result.released,
      failed: result.examined - result.released,
    };
  }

  async replayDueBatch(
    command: ExpertReferralWorkerBatchCommand,
  ): Promise<ExpertReferralHoldReplayBatchResult> {
    assertBatch(command);
    const candidates = await this.db.transaction(async (tx) => {
      const result = await tx.execute<{ expertId: string }>(sql`
        select expert_id as "expertId"
        from expert_first_residency_settlements
        where eligibility = 'pending_feature_hold'
          and settled_at <= ${command.now}
        order by settled_at, expert_id
        for update skip locked
        limit ${command.batchSize}
      `);
      return result.rows;
    });

    let granted = 0;
    let cancelled = 0;
    for (const candidate of candidates) {
      // replayHeldReward owns the serializable financial recheck and idempotency.
      const result = await this.#heldRewards.replayHeldReward(candidate.expertId);
      if (result.kind === "granted") granted += 1;
      // A candidate selected as pending can become non-pending before the
      // serializable replay only through a concurrent terminal/replay path.
      // Gate-closed and incomplete snapshots remain pending and are retried.
      else if (result.reason === "not_pending") cancelled += 1;
    }
    return { examined: candidates.length, granted, cancelled };
  }

  async listReconciliationBatch(
    command: ExpertReferralWorkerBatchCommand,
  ): Promise<readonly ExpertResidencyWorkerPayment[]> {
    assertBatch(command);
    return this.db.transaction(async (tx) => {
      const result = await tx.execute<{
        orderId: string;
        provider: string;
        paymentId: string;
        amountMinor: bigint | string | number;
        currency: string;
        status: string;
      }>(sql`
        select
          a.order_id as "orderId",
          a.provider,
          a.provider_request_id as "paymentId",
          a.expected_amount_minor as "amountMinor",
          a.currency,
          a.status::text as status
        from expert_residency_payment_attempts a
        where a.status in ('settled', 'refunded', 'charged_back')
          and a.resolved_at is not null
          and a.resolved_at <= ${command.now}
        order by a.resolved_at, a.id
        for update of a skip locked
        limit ${command.batchSize}
      `);
      return result.rows.map((row) => {
        if (row.currency !== "RUB") {
          throw new Error("invalid_expert_residency_worker_currency");
        }
        if (
          row.provider.trim().length === 0 ||
          row.provider.length > 64 ||
          row.paymentId.trim().length === 0 ||
          row.paymentId.length > 256
        ) {
          throw new Error("invalid_expert_residency_worker_identity");
        }
        return {
          orderId: row.orderId,
          provider: row.provider,
          paymentId: row.paymentId,
          amountMinor: money(row.amountMinor),
          currency: "RUB" as const,
          status: paymentStatus(row.status),
        };
      });
    });
  }

  async recordReconciliationMismatches(
    mismatches: readonly ExpertResidencyWorkerMismatch[],
  ): Promise<void> {
    if (mismatches.length > 1_000) {
      throw new Error("too_many_expert_residency_mismatches");
    }
    await this.db.transaction(async (tx) => {
      for (const mismatch of mismatches) {
        const reasonCode = `expert_residency_reconciliation_${mismatch.reason}`;
        await tx.execute(sql`
          insert into integration_errors (provider, reason_code, metadata_hash)
          values (
            'expert_residency',
            ${reasonCode},
            'sha256:' || encode(digest(convert_to(
              ${mismatch.orderId} || ':' || ${mismatch.provider} || ':' ||
              ${mismatch.paymentId} || ':' || ${mismatch.localStatus} || ':' ||
              ${mismatch.providerStatus ?? "missing"} || ':' || ${mismatch.reason},
              'UTF8'
            ), 'sha256'), 'hex')
          )
        `);
      }
    });
  }
}
