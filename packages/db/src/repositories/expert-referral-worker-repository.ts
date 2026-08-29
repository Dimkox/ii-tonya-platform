import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import type { DrizzleDb } from "../client.js";
import { PostgresExpertResidencyProviderInboxRepository } from "./expert-residency-provider-inbox-repository.js";
import { PostgresExpertResidencyRepository } from "./expert-residency-repository.js";
import { grantExpertReferralReward } from "./expert-referral-reward-allocation.js";
import { withSerializableRetry } from "./message-repository.js";

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
  "settled" | "refunded" | "charged_back";

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
    const result = await this.#residency.releaseExpiredOrders(
      command.batchSize,
    );
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
      const result = await this.#heldRewards.replayHeldReward(
        candidate.expertId,
      );
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
      const result = await tx.execute<{ id: string; leaseToken: string }>(sql`
        with due as (
          select id from expert_referral_reward_maturities
          where status = 'pending' and matures_at <= transaction_timestamp()
            and (lease_until is null or lease_until < transaction_timestamp())
          order by matures_at, id for update skip locked limit ${command.batchSize}
        )
        update expert_referral_reward_maturities m
        set lease_token=${lease}::uuid, lease_until=transaction_timestamp()+interval '5 minutes', attempt_count=m.attempt_count+1, updated_at=transaction_timestamp()
        from due where m.id=due.id returning m.id,m.lease_token as "leaseToken"
      `);
      return result.rows;
    });
    let granted = 0;
    let cancelled = 0;
    let pending = 0;
    for (const candidate of candidates) {
      let outcome: "granted" | "cancelled" | "pending";
      try {
        outcome = await withSerializableRetry(() =>
          this.db.transaction(async (tx) => {
            await tx.execute(sql`set transaction isolation level serializable`);
            const pointer = await tx.execute<{
              inviterExpertId: string;
              inviteeExpertId: string;
              firstSettlementId: string;
              referralId: string;
              orderId: string;
              paymentAttemptId: string;
            }>(sql`
          select inviter_expert_id as "inviterExpertId", invitee_expert_id as "inviteeExpertId", first_settlement_id as "firstSettlementId", referral_id as "referralId", qualifying_order_id as "orderId", qualifying_payment_attempt_id as "paymentAttemptId"
          from expert_referral_reward_maturities where id=${candidate.id}::uuid and lease_token=${candidate.leaseToken}::uuid
        `);
            const row = pointer.rows[0];
            if (!row) return "pending" as const;
            const order = await tx.execute<{ status: string }>(
              sql`select status from expert_residency_orders where id=${row.orderId}::uuid for update`,
            );
            const payment = await tx.execute<{
              status: string;
              orderId: string;
            }>(
              sql`select status,order_id as "orderId" from expert_residency_payment_attempts where id=${row.paymentAttemptId}::uuid for update`,
            );
            const marker = await tx.execute<{
              eligibility: string;
              referralId: string | null;
              orderId: string;
              paymentAttemptId: string;
              expertId: string;
            }>(
              sql`select eligibility,referral_id as "referralId",qualifying_order_id as "orderId",qualifying_payment_attempt_id as "paymentAttemptId",expert_id as "expertId" from expert_first_residency_settlements where id=${row.firstSettlementId}::uuid for update`,
            );
            const maturity = await tx.execute<{ id: string }>(
              sql`select id from expert_referral_reward_maturities where id=${candidate.id}::uuid and lease_token=${candidate.leaseToken}::uuid and status='pending' and matures_at <= transaction_timestamp() and lease_until >= transaction_timestamp() for update`,
            );
            if (!maturity.rows[0]) return "pending" as const;
            const expertIds = [row.inviteeExpertId, row.inviterExpertId].sort();
            const experts = await tx.execute<{
              id: string;
              active: boolean;
              verified: boolean;
            }>(
              sql`select id,active,verified from experts where id in (${sql.join(
                expertIds.map((id) => sql`${id}::uuid`),
                sql`,`,
              )}) order by id for update`,
            );
            const linkedGrant = await tx.execute<{ id: string }>(
              sql`select id from expert_referral_reward_grants where maturity_id=${candidate.id}::uuid order by expires_at,granted_at,id for update`,
            );
            if (linkedGrant.rows[0]) {
              await tx.execute(
                sql`update expert_referral_reward_maturities set status='granted',granted_at=transaction_timestamp(),resolved_at=transaction_timestamp(),reason_code='existing_linked_grant',lease_token=null,lease_until=null,updated_at=transaction_timestamp() where id=${candidate.id}::uuid and lease_token=${candidate.leaseToken}::uuid and status='pending'`,
              );
              return "granted" as const;
            }
            const legacyGrant = await tx.execute<{ id: string }>(
              sql`select id from expert_referral_reward_grants where first_settlement_id=${row.firstSettlementId}::uuid and maturity_id is null order by expires_at,granted_at,id for update`,
            );
            const referral = await tx.execute<{ id: string }>(
              sql`select id from expert_referrals where id=${row.referralId}::uuid and inviter_expert_id=${row.inviterExpertId}::uuid and invitee_expert_id=${row.inviteeExpertId}::uuid`,
            );
            const abuse = await tx.execute<{ expertId: string }>(
              sql`select expert_id as "expertId" from expert_referral_abuse_holds where expert_id in (${sql.join(
                expertIds.map((id) => sql`${id}::uuid`),
                sql`,`,
              )}) and status='open' order by expert_id for update`,
            );
            const facts = marker.rows[0];
            if (
              !facts ||
              order.rows[0]?.status !== "settled" ||
              payment.rows[0]?.status !== "settled" ||
              payment.rows[0]?.orderId !== row.orderId ||
              facts.eligibility !== "eligible" ||
              facts.referralId !== row.referralId ||
              facts.orderId !== row.orderId ||
              facts.paymentAttemptId !== row.paymentAttemptId ||
              facts.expertId !== row.inviteeExpertId ||
              !referral.rows[0] ||
              experts.rows.length !== 2 ||
              experts.rows.some(
                (expert) => !expert.active || !expert.verified,
              ) ||
              abuse.rows.length > 0 ||
              legacyGrant.rows.length > 0
            ) {
              await tx.execute(
                sql`update expert_referral_reward_maturities set status='cancelled',cancelled_at=transaction_timestamp(),terminal_reason='eligibility_lost',resolved_at=transaction_timestamp(),reason_code=${legacyGrant.rows.length > 0 ? "legacy_grant_present" : "eligibility_lost"},lease_token=null,lease_until=null,updated_at=transaction_timestamp() where id=${candidate.id}::uuid and lease_token=${candidate.leaseToken}::uuid and status='pending'`,
              );
              return "cancelled" as const;
            }
            const control = await tx.execute<{ enabled: boolean }>(sql`
          select reward_grants_enabled as enabled
          from expert_referral_feature_controls
          where control_key='expert_referrals'
          for update
        `);
            if (!control.rows[0]?.enabled) {
              await tx.execute(
                sql`update expert_referral_reward_maturities set lease_token=null,lease_until=null,reason_code='retry_feature_disabled',updated_at=transaction_timestamp() where id=${candidate.id}::uuid and lease_token=${candidate.leaseToken}::uuid and status='pending'`,
              );
              return "pending" as const;
            }
            const allocation = await grantExpertReferralReward(tx, {
              maturityId: candidate.id,
              inviterExpertId: row.inviterExpertId,
              referralId: row.referralId,
              firstSettlementId: row.firstSettlementId,
              orderId: row.orderId,
              paymentAttemptId: row.paymentAttemptId,
            });
            await tx.execute(
              sql`update expert_referral_reward_maturities set status='granted',granted_at=transaction_timestamp(),resolved_at=transaction_timestamp(),reason_code='matured',lease_token=null,lease_until=null,updated_at=transaction_timestamp() where id=${candidate.id}::uuid and lease_token=${candidate.leaseToken}::uuid and status='pending'`,
            );
            return allocation === "already_granted"
              ? ("cancelled" as const)
              : ("granted" as const);
          }),
        );
      } catch (error) {
        await this.db.execute(
          sql`update expert_referral_reward_maturities set lease_token=null,lease_until=null,reason_code='retry_failed',updated_at=transaction_timestamp() where id=${candidate.id}::uuid and lease_token=${candidate.leaseToken}::uuid and status='pending'`,
        );
        throw error;
      }
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
