import { randomUUID } from "node:crypto";
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

export interface ExpertReferralMaturityBatchResult {
  readonly examined: number;
  readonly granted: number;
  readonly cancelled: number;
  readonly pending: number;
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

  async grantDueMaturityBatch(
    command: ExpertReferralWorkerBatchCommand,
  ): Promise<ExpertReferralMaturityBatchResult> {
    assertBatch(command);
    const candidates = await this.db.transaction(async (tx) => {
      const lease = randomUUID();
      const result = await tx.execute<{ id: string }>(sql`
        with due as (
          select id from expert_referral_reward_maturities
          where status = 'pending' and matures_at <= transaction_timestamp()
            and (lease_until is null or lease_until < transaction_timestamp())
          order by matures_at, id for update skip locked limit ${command.batchSize}
        )
        update expert_referral_reward_maturities m
        set lease_token=${lease}::uuid, lease_until=transaction_timestamp()+interval '5 minutes', attempt_count=m.attempt_count+1, updated_at=transaction_timestamp()
        from due where m.id=due.id returning m.id
      `);
      return result.rows;
    });
    let granted = 0;
    let cancelled = 0;
    let pending = 0;
    for (const candidate of candidates) {
      const outcome = await this.db.transaction(async (tx) => {
        await tx.execute(sql`set transaction isolation level serializable`);
        const maturity = await tx.execute<{ inviterExpertId: string; firstSettlementId: string; referralId: string; orderId: string; paymentAttemptId: string }>(sql`
          select inviter_expert_id as "inviterExpertId", first_settlement_id as "firstSettlementId", referral_id as "referralId", qualifying_order_id as "orderId", qualifying_payment_attempt_id as "paymentAttemptId"
          from expert_referral_reward_maturities where id=${candidate.id}::uuid and status='pending' and matures_at <= transaction_timestamp() for update
        `);
        const row = maturity.rows[0];
        if (!row) return "pending" as const;
        const evidence = await tx.execute<{ orderStatus: string; paymentStatus: string; eligibility: string }>(sql`
          select o.status as "orderStatus", p.status as "paymentStatus", s.eligibility
          from expert_referral_reward_maturities m
          join expert_residency_orders o on o.id=m.qualifying_order_id
          join expert_residency_payment_attempts p on p.id=m.qualifying_payment_attempt_id
          join expert_first_residency_settlements s on s.id=m.first_settlement_id
          where m.id=${candidate.id}::uuid
          for update of o,p,s
        `);
        const facts = evidence.rows[0];
        if (!facts || facts.orderStatus !== "settled" || facts.paymentStatus !== "settled") {
          await tx.execute(sql`update expert_referral_reward_maturities set status='cancelled',cancelled_at=transaction_timestamp(),terminal_reason='eligibility_lost',resolved_at=transaction_timestamp(),reason_code='eligibility_lost' where id=${candidate.id}::uuid and status='pending'`);
          return "cancelled" as const;
        }
        if (facts.eligibility === "pending_feature_hold") return "pending" as const;
        if (facts.eligibility !== "eligible") {
          await tx.execute(sql`update expert_referral_reward_maturities set status='cancelled',cancelled_at=transaction_timestamp(),terminal_reason='eligibility_lost',resolved_at=transaction_timestamp(),reason_code='eligibility_lost' where id=${candidate.id}::uuid and status='pending'`);
          return "cancelled" as const;
        }
        const grant = await tx.execute<{ id: string }>(sql`
          insert into expert_referral_reward_grants (expert_id,referral_id,first_settlement_id,qualifying_order_id,qualifying_payment_attempt_id,maturity_id,amount_minor,granted_at,expires_at,idempotency_key)
          values (${row.inviterExpertId}::uuid,${row.referralId}::uuid,${row.firstSettlementId}::uuid,${row.orderId}::uuid,${row.paymentAttemptId}::uuid,${candidate.id}::uuid,100000,transaction_timestamp(),transaction_timestamp()+interval '365 days',${`reward:${candidate.id}`})
          on conflict (first_settlement_id) do nothing returning id
        `);
        if (!grant.rows[0]) return "granted" as const;
        const ledger = await tx.execute<{ id: string }>(sql`insert into expert_referral_ledger_entries (expert_id,entry_kind,amount_minor,source_type,source_id,idempotency_key) values (${row.inviterExpertId}::uuid,'reward_grant',100000,'reward_grant',${grant.rows[0].id}::uuid,${`reward-ledger:${candidate.id}`}) returning id`);
        if (!ledger.rows[0]) throw new Error("expert_referral_maturity_ledger_insert_failed");
        await tx.execute(sql`insert into expert_referral_ledger_allocations (ledger_entry_id,reward_grant_id,expert_id,amount_minor) values (${ledger.rows[0].id}::uuid,${grant.rows[0].id}::uuid,${row.inviterExpertId}::uuid,100000)`);
        await tx.execute(sql`update expert_referral_reward_maturities set status='granted',granted_at=transaction_timestamp(),resolved_at=transaction_timestamp(),reason_code='matured' where id=${candidate.id}::uuid and status='pending'`);
        return "granted" as const;
      });
      if (outcome === "granted") granted++;
      else if (outcome === "cancelled") cancelled++;
      else pending++;
    }
    return { examined: candidates.length, granted, cancelled, pending };
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
