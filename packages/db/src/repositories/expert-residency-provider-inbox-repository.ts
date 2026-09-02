import { createHash, randomUUID } from "node:crypto";
import type {
  ExpertResidencyHeldReplayFinancialFacts,
  ExpertResidencyRefundFinancialFacts,
  ExpertResidencySettlementFinancialFacts,
} from "@ii-tonya/contracts";
import {
  requireVerifiedExpertResidencyPaymentEvent,
  type VerifiedExpertResidencyPaymentEvent,
} from "@ii-tonya/integrations";
import { sql } from "drizzle-orm";
import type { DrizzleDb } from "../client.js";
import {
  appendExpertReferralAuditEvent,
  PostgresExpertReferralControlRepository,
  validateAndConsumeExpertReferralAdminEvidence,
  type ExpertReferralAdminEvidence,
  type ExpertReferralEligibility,
  type ExpertReferralTransaction,
} from "./expert-referral-control-repository.js";
import {
  ExpertResidencyRepositoryError,
  PostgresExpertResidencyRepository,
  type RewardReversalResult,
} from "./expert-residency-repository.js";
import { withSerializableRetry } from "./message-repository.js";

const REWARD_MINOR = 100_000n;
const REWARD_LIFETIME_MILLISECONDS = 365 * 86_400_000;

export type ExpertResidencySettlementResult =
  | Readonly<{
      kind: "expired";
      orderId: string;
      financialFacts: ExpertResidencySettlementFinancialFacts;
    }>
  | Readonly<{
      kind: "settled";
      orderId: string;
      settledAt: string;
      residencyStartsAt: string;
      residencyEndsAt: string;
      eligibilityStatus:
        | "eligible"
        | "ineligible"
        | "pending_feature_hold"
        | "not_first_settlement";
      rewardEffect:
        | Readonly<{ kind: "none" }>
        | Readonly<{ kind: "reward_granted"; amountMinor: "100000" }>
        | Readonly<{ kind: "debt_repaid"; amountMinor: string }>;
      financialFacts: ExpertResidencySettlementFinancialFacts;
    }>;

export type ExpertResidencyRefundResult = Readonly<{
  kind: "refunded" | "charged_back";
  orderId: string;
  cashRefundedMinor: string;
  cumulativeCashRefundedMinor: string;
  restoredCreditMinor: "0";
  residencyTerminated: boolean;
  rewardReversed: boolean;
  removedCreditMinor: string;
  cancelledReservationMinor: string;
  debtMinor: string;
  eligibilityStatus:
    | "eligible"
    | "ineligible"
    | "pending_feature_hold"
    | "cancelled_by_refund"
    | "not_first_settlement";
  financialFacts: ExpertResidencyRefundFinancialFacts;
}>;

export type HeldRewardReplayResult =
  | Readonly<{
      kind: "still_held";
      financialFacts: ExpertResidencyHeldReplayFinancialFacts;
    }>
  | Readonly<{
      kind: "cancelled_by_refund";
      financialFacts: ExpertResidencyHeldReplayFinancialFacts;
    }>
  | Readonly<{
      kind: "ineligible";
      reason: string;
      financialFacts: ExpertResidencyHeldReplayFinancialFacts;
    }>
  | Readonly<{
      kind: "terminated_after_grant";
      financialFacts: ExpertResidencyHeldReplayFinancialFacts;
    }>
  | Readonly<{
      kind: "reward_granted";
      amountMinor: "100000";
      financialFacts: ExpertResidencyHeldReplayFinancialFacts;
    }>
  | Readonly<{
      kind: "debt_repaid";
      amountMinor: string;
      financialFacts: ExpertResidencyHeldReplayFinancialFacts;
    }>;

export interface AdminHeldRewardReplay extends ExpertReferralAdminEvidence {
  readonly expertId: string;
  readonly qualifyingOrderId: string;
}
type ExpertResidencyProviderEventResult =
  ExpertResidencySettlementResult | ExpertResidencyRefundResult;

export class ExpertResidencySettlementError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "ExpertResidencySettlementError";
  }
}

interface InboxRow extends Record<string, unknown> {
  id: string;
  provider: string;
  externalEventId: string;
  paymentAttemptId: string | null;
  orderId: string | null;
  payloadDigest: string;
  verificationId: string;
  verifierKeyVersion: string;
  verifiedAt: Date | string;
  authenticated: boolean;
  eventKind: string;
  processingStatus: "pending" | "processing" | "processed" | "failed";
  processingResultDigest: string | null;
  processingResultCode: string | null;
  processingResult: unknown;
}

interface OrderRow extends Record<string, unknown> {
  orderId: string;
  expertId: string;
  cashMinor: bigint | string;
  creditMinor: bigint | string;
  currency: string;
  durationSeconds: number;
  paymentDeadline: Date | string;
  paymentProvider: string | null;
  providerPaymentId: string | null;
  status:
    | "quoted"
    | "payment_pending"
    | "settled"
    | "failed"
    | "expired"
    | "refunded"
    | "charged_back";
  settledAt: Date | string | null;
  residencyStartsAt: Date | string | null;
  residencyEndsAt: Date | string | null;
  paymentAttemptId: string | null;
  attemptProvider: string | null;
  providerRequestId: string | null;
  expectedAmountMinor: bigint | string | null;
  attemptCurrency: string | null;
}

interface MarkerRow extends Record<string, unknown> {
  id: string;
  qualifyingOrderId: string;
  eligibilityStatus:
    "eligible" | "ineligible" | "pending_feature_hold" | "cancelled_by_refund";
}

interface ReservationRow extends Record<string, unknown> {
  id: string;
  accountExpertId: string;
  amountMinor: bigint | string;
}

interface AllocationRow extends Record<string, unknown> {
  grantId: string;
  amountMinor: bigint | string;
}

interface ReferralRow extends Record<string, unknown> {
  referralId: string;
  inviterExpertId: string;
}

const noHeldRewardFinancialFacts =
  (): ExpertResidencyHeldReplayFinancialFacts => ({
    rewardCreated: false,
    debtRepaidMinor: "0",
  });

const noAppliedSettlementFinancialEffects = (): Extract<
  ExpertResidencySettlementFinancialFacts,
  { disposition: "applied" }
> => ({
  disposition: "applied",
  creditSpentMinor: "0",
  firstPaymentQualification: null,
  rewardCreated: false,
  debtRepaidMinor: "0",
});

function bigint(value: bigint | string): bigint {
  return typeof value === "bigint" ? value : BigInt(value);
}

function date(value: Date | string): Date {
  const parsed = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(parsed.getTime()))
    throw new Error("invalid_database_timestamp");
  return parsed;
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  }
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
    .join(",")}}`;
}

function hash(value: unknown): string {
  return `sha256:${createHash("sha256").update(canonicalJson(value)).digest("hex")}`;
}

function nestedDatabaseCode(error: unknown): string | null {
  let current = error;
  const seen = new Set<unknown>();
  while (
    typeof current === "object" &&
    current !== null &&
    !seen.has(current)
  ) {
    seen.add(current);
    const code = (current as { code?: unknown }).code;
    if (typeof code === "string") return code;
    current = (current as { cause?: unknown }).cause;
  }
  return null;
}

function deterministicFailureCode(error: unknown): string | null {
  if (error instanceof ExpertResidencySettlementError) return error.code;
  if (error instanceof ExpertResidencyRepositoryError) return error.code;
  const databaseCode = nestedDatabaseCode(error);
  if (databaseCode?.startsWith("23")) {
    return "settlement_effect_constraint_failed";
  }
  if (
    error instanceof Error &&
    ["invalid_database_timestamp", "database_clock_unavailable"].includes(
      error.message,
    )
  ) {
    return "settlement_data_invalid";
  }
  return null;
}

function isSettlementResult(
  value: unknown,
): value is ExpertResidencySettlementResult {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const result = value as Record<string, unknown>;
  if (result.kind === "expired") {
    return (
      Object.keys(result).length === 3 &&
      typeof result.orderId === "string" &&
      isSettlementFinancialFacts(result.financialFacts)
    );
  }
  if (
    result.kind !== "settled" ||
    Object.keys(result).length !== 8 ||
    typeof result.orderId !== "string" ||
    typeof result.settledAt !== "string" ||
    typeof result.residencyStartsAt !== "string" ||
    typeof result.residencyEndsAt !== "string" ||
    ![
      "eligible",
      "ineligible",
      "pending_feature_hold",
      "not_first_settlement",
    ].includes(String(result.eligibilityStatus)) ||
    typeof result.rewardEffect !== "object" ||
    result.rewardEffect === null ||
    Array.isArray(result.rewardEffect) ||
    !isSettlementFinancialFacts(result.financialFacts)
  ) {
    return false;
  }
  const effect = result.rewardEffect as Record<string, unknown>;
  return (
    (effect.kind === "none" && Object.keys(effect).length === 1) ||
    (effect.kind === "reward_granted" &&
      effect.amountMinor === "100000" &&
      Object.keys(effect).length === 2) ||
    (effect.kind === "debt_repaid" &&
      typeof effect.amountMinor === "string" &&
      /^[1-9][0-9]{0,18}$/u.test(effect.amountMinor) &&
      Object.keys(effect).length === 2)
  );
}

function isSettlementFinancialFacts(
  value: unknown,
): value is ExpertResidencySettlementFinancialFacts {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const facts = value as Record<string, unknown>;
  if (facts.disposition === "duplicate") {
    return Object.keys(facts).length === 1;
  }
  return (
    facts.disposition === "applied" &&
    Object.keys(facts).length === 5 &&
    isCanonicalNonnegativeMinor(facts.creditSpentMinor) &&
    (facts.firstPaymentQualification === null ||
      ["eligible", "ineligible", "pending_feature_hold"].includes(
        String(facts.firstPaymentQualification),
      )) &&
    typeof facts.rewardCreated === "boolean" &&
    isCanonicalNonnegativeMinor(facts.debtRepaidMinor)
  );
}

function isRefundFinancialFacts(
  value: unknown,
): value is ExpertResidencyRefundFinancialFacts {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const facts = value as Record<string, unknown>;
  if (facts.disposition === "duplicate") {
    return Object.keys(facts).length === 1;
  }
  return (
    facts.disposition === "applied" &&
    Object.keys(facts).length === 4 &&
    isCanonicalNonnegativeMinor(facts.cashRefundedMinor) &&
    typeof facts.rewardReversed === "boolean" &&
    isCanonicalNonnegativeMinor(facts.debtCreatedMinor)
  );
}

function isCanonicalNonnegativeMinor(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^(?:0|[1-9][0-9]{0,18})$/u.test(value) &&
    (value.length < 19 || value <= "9223372036854775807")
  );
}

function isRefundResult(value: unknown): value is ExpertResidencyRefundResult {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const result = value as Record<string, unknown>;
  return (
    Object.keys(result).length === 12 &&
    ["refunded", "charged_back"].includes(String(result.kind)) &&
    typeof result.orderId === "string" &&
    isCanonicalNonnegativeMinor(result.cashRefundedMinor) &&
    isCanonicalNonnegativeMinor(result.cumulativeCashRefundedMinor) &&
    result.restoredCreditMinor === "0" &&
    typeof result.residencyTerminated === "boolean" &&
    typeof result.rewardReversed === "boolean" &&
    isCanonicalNonnegativeMinor(result.removedCreditMinor) &&
    isCanonicalNonnegativeMinor(result.cancelledReservationMinor) &&
    isCanonicalNonnegativeMinor(result.debtMinor) &&
    isRefundFinancialFacts(result.financialFacts) &&
    [
      "eligible",
      "ineligible",
      "pending_feature_hold",
      "cancelled_by_refund",
      "not_first_settlement",
    ].includes(String(result.eligibilityStatus))
  );
}

function isProviderEventResult(
  value: unknown,
): value is ExpertResidencyProviderEventResult {
  return isSettlementResult(value) || isRefundResult(value);
}

function eventFingerprint(event: VerifiedExpertResidencyPaymentEvent): string {
  return hash({
    kind: event.kind,
    provider: event.provider,
    eventId: event.eventId,
    paymentId: event.paymentId,
    orderId: event.orderId,
    amountMinor: event.amountMinor,
    currency: event.currency,
    occurredAt: event.occurredAt,
    payloadDigest: event.payloadDigest,
    ...(event.kind === "settled"
      ? {}
      : { terminatesResidency: event.terminatesResidency }),
    verification: event.verification,
  });
}

function eligibilityDecision(eligibility: ExpertReferralEligibility): {
  eligible: boolean;
  reason: string;
} {
  if (!eligibility.found)
    return { eligible: false, reason: "expert_not_found" };
  if (!eligibility.active)
    return { eligible: false, reason: "expert_inactive" };
  if (!eligibility.verified)
    return { eligible: false, reason: "expert_unverified" };
  if (!eligibility.userActive)
    return { eligible: false, reason: "user_inactive" };
  if (!eligibility.uniqueIdentity)
    return { eligible: false, reason: "duplicate_identity" };
  if (!eligibility.abuseCleared)
    return { eligible: false, reason: "abuse_review_open" };
  return { eligible: true, reason: "eligible" };
}

export class PostgresExpertResidencyProviderInboxRepository {
  private readonly controls: PostgresExpertReferralControlRepository;
  private readonly residency: PostgresExpertResidencyRepository;

  constructor(private readonly db: DrizzleDb) {
    this.controls = new PostgresExpertReferralControlRepository(db);
    this.residency = new PostgresExpertResidencyRepository(db);
  }

  async settle(
    input: VerifiedExpertResidencyPaymentEvent,
  ): Promise<ExpertResidencySettlementResult> {
    const event = requireVerifiedExpertResidencyPaymentEvent(input);
    if (event.kind !== "settled") {
      throw new ExpertResidencySettlementError("settlement_event_required");
    }
    return (await this.processEvent(event, (tx, inboxId) =>
      this.applySettlement(tx, event, inboxId),
    )) as ExpertResidencySettlementResult;
  }

  async refund(
    input: VerifiedExpertResidencyPaymentEvent,
  ): Promise<ExpertResidencyRefundResult> {
    const event = requireVerifiedExpertResidencyPaymentEvent(input);
    if (event.kind !== "refunded" && event.kind !== "charged_back") {
      throw new ExpertResidencySettlementError("refund_event_required");
    }
    return (await this.processEvent(event, (tx, inboxId) =>
      this.applyRefund(tx, event, inboxId),
    )) as ExpertResidencyRefundResult;
  }

  async replayHeldReward(
    input:
      | Readonly<{
          expertId: string;
          qualifyingOrderId: string;
        }>
      | AdminHeldRewardReplay,
  ): Promise<HeldRewardReplayResult> {
    return withSerializableRetry(() =>
      this.db.transaction(async (tx) => {
        await tx.execute(sql`set transaction isolation level serializable`);
        if ("approvalId" in input) {
          const approval = await validateAndConsumeExpertReferralAdminEvidence(
            tx,
            input,
            {
              action: "expert_referral.hold_replay",
              objectType: "expert_residency_order",
              objectId: input.qualifyingOrderId,
              payload: { expertId: input.expertId },
            },
          );
          if (approval.replay) {
            throw new ExpertResidencySettlementError(
              "hold_replay_approval_replayed",
            );
          }
          await appendExpertReferralAuditEvent(tx, {
            ...input,
            action: "expert_referral.hold_replay",
            objectType: "expert_residency_order",
            objectId: input.qualifyingOrderId,
            reasonCode: "held_replay_approved",
            metadata: {
              expertId: input.expertId,
              qualifyingOrderId: input.qualifyingOrderId,
            },
          });
        }
        return this.replayHeldRewardInTransaction(tx, input);
      }),
    );
  }

  async replayHeldRewardInTransaction(
    tx: ExpertReferralTransaction,
    input: Readonly<{
      expertId: string;
      qualifyingOrderId: string;
    }>,
  ): Promise<HeldRewardReplayResult> {
    const featureControl = await this.controls.lockFeatureControl(tx);
    const order = await this.lockOrder(tx, input.qualifyingOrderId);
    if (order === undefined || order.expertId !== input.expertId) {
      throw new ExpertResidencySettlementError("held_order_not_found");
    }
    if (order.paymentAttemptId !== null) {
      await tx.execute(sql`select id from expert_residency_payment_attempts
            where id = ${order.paymentAttemptId}::uuid for update`);
    }
    await tx.execute(sql`select pg_advisory_xact_lock(
          hashtextextended(${`expert-residency:settlement:${order.expertId}`}, 0)
        )`);
    await this.controls.lockEligibility(tx, order.expertId);
    const referral = await this.lockReferral(tx, order.expertId);
    await this.lockResidencyRows(tx, order.expertId);
    const marker = await this.lockFirstMarker(tx, order.expertId);
    if (marker === undefined || marker.qualifyingOrderId !== order.orderId) {
      throw new ExpertResidencySettlementError("held_marker_not_found");
    }
    if (marker.eligibilityStatus === "cancelled_by_refund") {
      return {
        kind: "cancelled_by_refund",
        financialFacts: noHeldRewardFinancialFacts(),
      };
    }
    if (marker.eligibilityStatus === "ineligible") {
      return {
        kind: "ineligible",
        reason: "permanently_ineligible",
        financialFacts: noHeldRewardFinancialFacts(),
      };
    }
    if (marker.eligibilityStatus === "eligible") {
      if (order.status !== "settled") {
        return {
          kind: "terminated_after_grant",
          financialFacts: noHeldRewardFinancialFacts(),
        };
      }
      const result = await this.heldRewardEffect(tx, order);
      await this.auditHeldReplay(tx, order, marker.id, result);
      return result;
    }
    const snapshot = (
      await tx.execute<{
        expertActive: boolean;
        expertVerified: boolean;
        uniqueIdentity: boolean;
        abuseCleared: boolean;
      }>(sql`select expert_active as "expertActive",
            expert_verified as "expertVerified",
            unique_identity as "uniqueIdentity", abuse_cleared as "abuseCleared"
            from expert_first_residency_settlements
            where id = ${marker.id}::uuid`)
    ).rows[0]!;
    const now = await this.databaseNow(tx);
    let ineligibleReason: string | null = null;
    if (
      !snapshot.expertActive ||
      !snapshot.expertVerified ||
      !snapshot.uniqueIdentity ||
      !snapshot.abuseCleared
    ) {
      ineligibleReason = "held_snapshot_ineligible";
    } else if (order.status !== "settled") {
      ineligibleReason = "held_order_not_settled";
    } else if (
      order.residencyEndsAt === null ||
      date(order.residencyEndsAt).getTime() <= now.getTime()
    ) {
      ineligibleReason = "held_residency_not_active";
    } else if (referral === undefined) {
      ineligibleReason = "held_referral_missing";
    }
    if (ineligibleReason !== null) {
      const eligibility =
        order.status === "refunded" || order.status === "charged_back"
          ? "cancelled_by_refund"
          : "ineligible";
      const reason =
        eligibility === "cancelled_by_refund"
          ? order.status === "refunded"
            ? "terminating_refund"
            : "terminating_chargeback"
          : ineligibleReason;
      await tx.execute(sql`update expert_first_residency_settlements set
            eligibility_status = ${eligibility}, eligibility_reason_code = ${reason}
            where id = ${marker.id}::uuid
              and eligibility_status = 'pending_feature_hold'`);
      const result: HeldRewardReplayResult =
        eligibility === "cancelled_by_refund"
          ? {
              kind: "cancelled_by_refund",
              financialFacts: noHeldRewardFinancialFacts(),
            }
          : {
              kind: "ineligible",
              reason,
              financialFacts: noHeldRewardFinancialFacts(),
            };
      await this.auditHeldReplay(tx, order, marker.id, result);
      return result;
    }
    if (!featureControl.rewardGrantsEnabled) {
      return {
        kind: "still_held",
        financialFacts: noHeldRewardFinancialFacts(),
      };
    }
    await tx.execute(sql`update expert_first_residency_settlements set
          eligibility_status = 'eligible',
          eligibility_reason_code = 'eligible_after_feature_replay'
          where id = ${marker.id}::uuid
            and eligibility_status = 'pending_feature_hold'`);
    const financialFacts = await this.appendReward(
      tx,
      referral!,
      order.orderId,
      marker.id,
      date(order.settledAt!),
    );
    await this.flushDeferredSettlementConstraints(tx);
    const result: HeldRewardReplayResult =
      financialFacts.debtRepaidMinor > 0n
        ? {
            kind: "debt_repaid",
            amountMinor: financialFacts.debtRepaidMinor.toString(),
            financialFacts: {
              rewardCreated: financialFacts.rewardCreated,
              debtRepaidMinor: financialFacts.debtRepaidMinor.toString(),
            },
          }
        : {
            kind: "reward_granted",
            amountMinor: "100000",
            financialFacts: {
              rewardCreated: financialFacts.rewardCreated,
              debtRepaidMinor: "0",
            },
          };
    await this.auditHeldReplay(tx, order, marker.id, result);
    return result;
  }

  replayHeldRewardAsAdmin(
    input: AdminHeldRewardReplay,
  ): Promise<HeldRewardReplayResult> {
    return this.replayHeldReward(input);
  }

  private async processEvent(
    event: VerifiedExpertResidencyPaymentEvent,
    apply: (
      tx: ExpertReferralTransaction,
      inboxId: string,
    ) => Promise<ExpertResidencyProviderEventResult>,
  ): Promise<ExpertResidencyProviderEventResult> {
    const outcome = await withSerializableRetry(() =>
      this.db.transaction(async (tx) => {
        await tx.execute(sql`set transaction isolation level serializable`);
        const inserted = (
          await tx.execute<{ id: string }>(sql`
            insert into expert_residency_provider_event_inbox (
              provider, external_event_id, payload_digest, verification_id,
              verifier_key_version, verified_at, authenticated, event_kind,
              processing_status
            ) values (
              ${event.provider}, ${event.eventId}, ${event.payloadDigest},
              ${event.verification.verificationId},
              ${event.verification.verifierKeyVersion},
              ${new Date(event.verification.verifiedAt)}, true, ${event.kind},
              'processing'
            ) on conflict (provider, external_event_id) do nothing
            returning id
          `)
        ).rows[0];
        const inbox = await this.lockInbox(tx, event.provider, event.eventId);
        this.assertInboxIdentity(inbox, event);
        if (inserted === undefined) {
          return this.replayOutcome(inbox, event);
        }
        try {
          const result = await tx.transaction(async (effectsTx) => {
            const applied = await apply(effectsTx, inbox.id);
            await this.flushDeferredSettlementConstraints(effectsTx);
            await this.completeInbox(effectsTx, inbox.id, event, applied);
            return applied;
          });
          return { result } as const;
        } catch (error) {
          const code = deterministicFailureCode(error);
          if (code === null) throw error;
          await this.linkFailedInbox(tx, inbox.id, event);
          await this.failInbox(tx, inbox.id, event, code);
          return { error: code } as const;
        }
      }),
    );
    if ("error" in outcome) {
      throw new ExpertResidencySettlementError(outcome.error);
    }
    return outcome.result;
  }

  private async flushDeferredSettlementConstraints(
    tx: ExpertReferralTransaction,
  ): Promise<void> {
    await tx.execute(sql`set constraints
      expert_ledger_entry_allocation_required,
      expert_ledger_allocation_total,
      expert_reward_grant_ledger_required immediate`);
    await tx.execute(sql`set constraints
      expert_ledger_entry_allocation_required,
      expert_ledger_allocation_total,
      expert_reward_grant_ledger_required deferred`);
  }

  private replayOutcome(
    inbox: InboxRow,
    event: VerifiedExpertResidencyPaymentEvent,
  ):
    | Readonly<{ result: ExpertResidencyProviderEventResult }>
    | Readonly<{ error: string }> {
    if (inbox.processingStatus === "failed") {
      const error = inbox.processingResultCode;
      if (
        error === null ||
        !/^[a-z][a-z0-9_]{0,63}$/u.test(error) ||
        inbox.processingResult !== null ||
        inbox.processingResultDigest !== this.resultDigest(event, { error })
      ) {
        throw new ExpertResidencySettlementError(
          "provider_event_replay_conflict",
        );
      }
      return { error };
    }
    if (inbox.processingStatus === "processed") {
      const result = inbox.processingResult;
      if (
        !isProviderEventResult(result) ||
        inbox.processingResultCode !== result.kind ||
        inbox.processingResultDigest !== this.resultDigest(event, { result })
      ) {
        throw new ExpertResidencySettlementError(
          "provider_event_replay_conflict",
        );
      }
      return {
        result: {
          ...result,
          financialFacts: { disposition: "duplicate" },
        },
      };
    }
    throw new ExpertResidencySettlementError("provider_event_claim_conflict");
  }

  private async applySettlement(
    tx: ExpertReferralTransaction,
    event: VerifiedExpertResidencyPaymentEvent,
    inboxId: string,
  ): Promise<ExpertResidencySettlementResult> {
    const featureControl = await this.controls.lockFeatureControl(tx);
    const order = await this.lockOrder(tx, event.orderId);
    if (order === undefined) {
      throw new ExpertResidencySettlementError("order_not_found");
    }
    if (order.paymentAttemptId !== null) {
      await tx.execute(sql`select id from expert_residency_payment_attempts
        where id = ${order.paymentAttemptId}::uuid for update`);
    }
    await tx.execute(sql`update expert_residency_provider_event_inbox
      set order_id = ${order.orderId}::uuid,
        payment_attempt_id = ${order.paymentAttemptId}::uuid
      where id = ${inboxId}::uuid`);
    const validationError =
      this.paymentIdentityError(order, event) ??
      this.validationError(order, event);
    if (validationError !== null) {
      throw new ExpertResidencySettlementError(validationError);
    }
    if (order.status === "settled" || order.status === "expired") {
      return this.resultForOrder(
        tx,
        order,
        noAppliedSettlementFinancialEffects(),
      );
    }
    if (order.status !== "payment_pending" && order.status !== "quoted") {
      throw new ExpertResidencySettlementError("order_state_invalid");
    }

    const deadline = (
      await tx.execute<{
        decision: "settlement_allowed" | "expire_and_release";
      }>(sql`
        select expert_residency_payment_deadline_state(${date(order.paymentDeadline)}) as decision
      `)
    ).rows[0]?.decision;
    if (deadline !== "settlement_allowed") {
      await this.expireAndRelease(tx, order);
      const result = {
        kind: "expired",
        orderId: order.orderId,
        financialFacts: noAppliedSettlementFinancialEffects(),
      } as const;
      await this.auditAndOutbox(tx, order.expertId, event, result);
      return result;
    }

    await tx.execute(sql`select pg_advisory_xact_lock(
      hashtextextended(${`expert-residency:settlement:${order.expertId}`}, 0)
    )`);
    const eligibility = await this.controls.lockEligibility(tx, order.expertId);
    const referral = await this.lockReferral(tx, order.expertId);
    await this.lockResidencyRows(tx, order.expertId);
    const now = await this.databaseNow(tx);
    const currentEnd = await this.currentResidencyEnd(tx, order.expertId);
    const startsAt = currentEnd !== null && currentEnd > now ? currentEnd : now;
    const endsAt = new Date(startsAt.getTime() + order.durationSeconds * 1_000);
    await tx.execute(sql`update expert_residency_orders set
      status = 'settled', settled_at = ${now}, residency_starts_at = ${startsAt},
      residency_ends_at = ${endsAt}, updated_at = clock_timestamp()
      where id = ${order.orderId}::uuid`);
    await tx.execute(sql`update expert_residency_payment_attempts set
      status = 'succeeded', updated_at = clock_timestamp()
      where id = ${order.paymentAttemptId}::uuid`);
    const creditSpentMinor = await this.commitReservation(tx, order);

    const priorMarker = await this.lockFirstMarker(tx, order.expertId);
    let firstPaymentQualification: Extract<
      ExpertResidencySettlementFinancialFacts,
      { disposition: "applied" }
    >["firstPaymentQualification"] = null;
    let rewardCreated = false;
    let debtRepaidMinor = 0n;
    if (priorMarker === undefined) {
      const decision = eligibilityDecision(eligibility);
      const status = !decision.eligible
        ? "ineligible"
        : referral !== undefined && !featureControl.rewardGrantsEnabled
          ? "pending_feature_hold"
          : "eligible";
      const reason =
        status === "pending_feature_hold"
          ? "reward_grants_disabled"
          : decision.reason;
      firstPaymentQualification = status;
      const markerId = randomUUID();
      await tx.execute(sql`insert into expert_first_residency_settlements (
        id, expert_id, qualifying_order_id, eligibility_status,
        eligibility_reason_code, expert_active, expert_verified,
        unique_identity, abuse_cleared, settled_at
      ) values (
        ${markerId}::uuid, ${order.expertId}::uuid, ${order.orderId}::uuid,
        ${status}, ${reason}, ${eligibility.active && eligibility.userActive},
        ${eligibility.verified}, ${eligibility.uniqueIdentity},
        ${eligibility.abuseCleared}, ${now}
      )`);
      if (status === "eligible" && referral !== undefined) {
        const rewardFacts = await this.appendReward(
          tx,
          referral,
          order.orderId,
          markerId,
          now,
        );
        rewardCreated = rewardFacts.rewardCreated;
        debtRepaidMinor = rewardFacts.debtRepaidMinor;
      }
    }

    const settledOrder: OrderRow = {
      ...order,
      status: "settled",
      settledAt: now,
      residencyStartsAt: startsAt,
      residencyEndsAt: endsAt,
    };
    const result = await this.resultForOrder(tx, settledOrder, {
      disposition: "applied",
      creditSpentMinor: creditSpentMinor.toString(),
      firstPaymentQualification,
      rewardCreated,
      debtRepaidMinor: debtRepaidMinor.toString(),
    });
    await this.auditAndOutbox(tx, order.expertId, event, result);
    return result;
  }

  private async applyRefund(
    tx: ExpertReferralTransaction,
    event: Extract<
      VerifiedExpertResidencyPaymentEvent,
      { kind: "refunded" | "charged_back" }
    >,
    inboxId: string,
  ): Promise<ExpertResidencyRefundResult> {
    await this.controls.lockFeatureControl(tx);
    const order = await this.lockOrder(tx, event.orderId);
    if (order === undefined) {
      throw new ExpertResidencySettlementError("order_not_found");
    }
    if (order.paymentAttemptId !== null) {
      await tx.execute(sql`select id from expert_residency_payment_attempts
        where id = ${order.paymentAttemptId}::uuid for update`);
    }
    await tx.execute(sql`update expert_residency_provider_event_inbox
      set order_id = ${order.orderId}::uuid,
        payment_attempt_id = ${order.paymentAttemptId}::uuid
      where id = ${inboxId}::uuid`);
    const identityError = this.paymentIdentityError(order, event);
    if (identityError !== null) {
      throw new ExpertResidencySettlementError(identityError);
    }
    if (
      event.currency !== order.currency ||
      event.currency !== order.attemptCurrency
    ) {
      throw new ExpertResidencySettlementError("payment_currency_mismatch");
    }
    const beforeSettlement =
      order.status === "quoted" || order.status === "payment_pending";
    if (!beforeSettlement && order.status !== "settled") {
      throw new ExpertResidencySettlementError("order_state_invalid");
    }
    const priorRefunded = bigint(
      (
        await tx.execute<{ amountMinor: bigint | string }>(sql`select
          coalesce(sum((processing_result ->> 'cashRefundedMinor')::bigint), 0)::bigint
            as "amountMinor"
          from expert_residency_provider_event_inbox
          where order_id = ${order.orderId}::uuid
            and processing_status = 'processed'
            and event_kind in ('refunded', 'charged_back')`)
      ).rows[0]!.amountMinor,
    );
    const refundMinor = bigint(event.amountMinor);
    const cumulative = priorRefunded + refundMinor;
    if (cumulative > bigint(order.cashMinor)) {
      throw new ExpertResidencySettlementError("refund_cash_exceeded");
    }
    if (
      event.kind === "refunded" &&
      event.terminatesResidency &&
      cumulative !== bigint(order.cashMinor)
    ) {
      throw new ExpertResidencySettlementError(
        "terminating_refund_cash_incomplete",
      );
    }

    let eligibilityStatus: ExpertResidencyRefundResult["eligibilityStatus"] =
      "not_first_settlement";
    let reversal: RewardReversalResult = {
      rewardReversed: false,
      removedCreditMinor: 0n,
      cancelledReservationMinor: 0n,
      debtMinor: 0n,
    };
    if (event.terminatesResidency) {
      await tx.execute(sql`select pg_advisory_xact_lock(
        hashtextextended(${`expert-residency:settlement:${order.expertId}`}, 0)
      )`);
      await this.controls.lockEligibility(tx, order.expertId);
      const referral = await this.lockReferral(tx, order.expertId);
      await this.lockResidencyRows(tx, order.expertId);
      const marker = await this.lockFirstMarker(tx, order.expertId);
      const qualifies = marker?.qualifyingOrderId === order.orderId;
      if (qualifies && marker !== undefined) {
        eligibilityStatus = marker.eligibilityStatus;
        if (marker.eligibilityStatus === "pending_feature_hold") {
          eligibilityStatus = "cancelled_by_refund";
          await tx.execute(sql`update expert_first_residency_settlements set
            eligibility_status = 'cancelled_by_refund',
            eligibility_reason_code = ${event.kind === "refunded" ? "terminating_refund" : "terminating_chargeback"}
            where id = ${marker.id}::uuid
              and eligibility_status = 'pending_feature_hold'`);
        } else if (
          marker.eligibilityStatus === "eligible" &&
          referral !== undefined
        ) {
          const grant = (
            await tx.execute<{ grantId: string }>(sql`select id as "grantId"
              from expert_referral_reward_grants
              where qualifying_order_id = ${order.orderId}::uuid
                and inviter_expert_id = ${referral.inviterExpertId}::uuid
              for update`)
          ).rows[0];
          if (grant !== undefined) {
            reversal = await this.residency.reverseRewardGrant(tx, {
              grantId: grant.grantId,
              inviterExpertId: referral.inviterExpertId,
              reversedAt: await this.databaseNow(tx),
            });
          }
        }
      }
      if (beforeSettlement) {
        await this.releaseReservation(tx, order, true);
      }
      await tx.execute(sql`update expert_residency_orders set
        status = ${event.kind}, updated_at = clock_timestamp()
        where id = ${order.orderId}::uuid
          and status in ('quoted', 'payment_pending', 'settled')`);
      if (beforeSettlement) {
        await tx.execute(sql`update expert_residency_payment_attempts
          set status = 'cancelled', updated_at = clock_timestamp()
          where id = ${order.paymentAttemptId}::uuid
            and status in ('created', 'pending', 'unknown_outcome')`);
      }
    }
    const result: ExpertResidencyRefundResult = {
      kind: event.kind,
      orderId: order.orderId,
      cashRefundedMinor: refundMinor.toString(),
      cumulativeCashRefundedMinor: cumulative.toString(),
      restoredCreditMinor: "0",
      residencyTerminated: event.terminatesResidency,
      rewardReversed: reversal.rewardReversed,
      removedCreditMinor: reversal.removedCreditMinor.toString(),
      cancelledReservationMinor: reversal.cancelledReservationMinor.toString(),
      debtMinor: reversal.debtMinor.toString(),
      eligibilityStatus,
      financialFacts: {
        disposition: "applied",
        cashRefundedMinor: refundMinor.toString(),
        rewardReversed: reversal.rewardReversed,
        debtCreatedMinor: reversal.debtMinor.toString(),
      },
    };
    await this.auditAndOutbox(tx, order.expertId, event, result);
    return result;
  }

  private async lockInbox(
    tx: ExpertReferralTransaction,
    provider: string,
    eventId: string,
  ): Promise<InboxRow> {
    const row = (
      await tx.execute<InboxRow>(sql`select id, provider,
        external_event_id as "externalEventId",
        payment_attempt_id as "paymentAttemptId", order_id as "orderId",
        payload_digest as "payloadDigest", verification_id as "verificationId",
        verifier_key_version as "verifierKeyVersion", verified_at as "verifiedAt",
        authenticated, event_kind as "eventKind",
        processing_status as "processingStatus",
        processing_result_digest as "processingResultDigest",
        processing_result_code as "processingResultCode",
        processing_result as "processingResult"
        from expert_residency_provider_event_inbox
        where provider = ${provider} and external_event_id = ${eventId}
        for update`)
    ).rows[0];
    if (row === undefined) throw new Error("provider_event_claim_failed");
    return row;
  }

  private assertInboxIdentity(
    inbox: InboxRow,
    event: VerifiedExpertResidencyPaymentEvent,
  ): void {
    if (
      inbox.provider !== event.provider ||
      inbox.externalEventId !== event.eventId ||
      inbox.payloadDigest !== event.payloadDigest ||
      inbox.verificationId !== event.verification.verificationId ||
      inbox.verifierKeyVersion !== event.verification.verifierKeyVersion ||
      date(inbox.verifiedAt).getTime() !==
        new Date(event.verification.verifiedAt).getTime() ||
      !inbox.authenticated ||
      inbox.eventKind !== event.kind
    ) {
      throw new ExpertResidencySettlementError(
        "provider_event_replay_conflict",
      );
    }
  }

  private async lockOrder(
    tx: ExpertReferralTransaction,
    orderId: string,
  ): Promise<OrderRow | undefined> {
    return (
      await tx.execute<OrderRow>(sql`select
        o.id as "orderId", o.expert_id as "expertId", o.cash_minor as "cashMinor",
        o.credit_minor as "creditMinor", o.currency, o.duration_seconds as "durationSeconds",
        o.payment_deadline as "paymentDeadline", o.payment_provider as "paymentProvider",
        o.provider_payment_id as "providerPaymentId", o.status,
        o.settled_at as "settledAt", o.residency_starts_at as "residencyStartsAt",
        o.residency_ends_at as "residencyEndsAt", p.id as "paymentAttemptId",
        p.provider as "attemptProvider", p.provider_request_id as "providerRequestId",
        p.expected_amount_minor as "expectedAmountMinor", p.currency as "attemptCurrency"
        from expert_residency_orders o
        left join expert_residency_payment_attempts p on p.order_id = o.id
          and p.provider = o.payment_provider
          and p.provider_request_id = o.provider_payment_id
        where o.id = ${orderId}::uuid for update of o`)
    ).rows[0];
  }

  private paymentIdentityError(
    order: OrderRow,
    event: VerifiedExpertResidencyPaymentEvent,
  ): "payment_identity_mismatch" | null {
    if (
      order.paymentAttemptId === null ||
      order.paymentProvider !== event.provider ||
      order.providerPaymentId !== event.paymentId ||
      order.attemptProvider !== event.provider ||
      order.providerRequestId !== event.paymentId
    ) {
      return "payment_identity_mismatch";
    }
    return null;
  }

  private validationError(
    order: OrderRow,
    event: VerifiedExpertResidencyPaymentEvent,
  ): string | null {
    if (
      event.amountMinor !== bigint(order.cashMinor).toString() ||
      order.expectedAmountMinor === null ||
      event.amountMinor !== bigint(order.expectedAmountMinor).toString()
    ) {
      return "payment_amount_mismatch";
    }
    if (
      event.currency !== order.currency ||
      event.currency !== order.attemptCurrency
    ) {
      return "payment_currency_mismatch";
    }
    return null;
  }

  private async expireAndRelease(
    tx: ExpertReferralTransaction,
    order: OrderRow,
  ): Promise<void> {
    await tx.execute(sql`update expert_residency_orders set status = 'expired',
      updated_at = clock_timestamp() where id = ${order.orderId}::uuid
        and status in ('quoted', 'payment_pending')`);
    await this.releaseReservation(tx, order, false);
  }

  private async releaseReservation(
    tx: ExpertReferralTransaction,
    order: OrderRow,
    requireExact: boolean,
  ): Promise<void> {
    const reservation = await this.activeReservation(tx, order.orderId);
    if (reservation === undefined) {
      if (requireExact && bigint(order.creditMinor) > 0n) {
        throw new ExpertResidencySettlementError("reservation_mismatch");
      }
      return;
    }
    if (
      requireExact &&
      -bigint(reservation.amountMinor) !== bigint(order.creditMinor)
    ) {
      throw new ExpertResidencySettlementError("reservation_mismatch");
    }
    const releaseId = randomUUID();
    await tx.execute(sql`insert into expert_referral_ledger_entries (
      id, account_expert_id, entry_kind, amount_minor, source_type, source_id,
      original_entry_id, idempotency_key
    ) values (${releaseId}::uuid, ${reservation.accountExpertId}::uuid, 'release',
      ${-bigint(reservation.amountMinor)}, 'residency_order', ${order.orderId}::uuid,
      ${reservation.id}::uuid, ${`residency-release:${order.orderId}`})`);
    await this.copyAllocations(tx, reservation.id, releaseId);
  }

  private async commitReservation(
    tx: ExpertReferralTransaction,
    order: OrderRow,
  ): Promise<bigint> {
    const credit = bigint(order.creditMinor);
    const reservation = await this.activeReservation(tx, order.orderId);
    if (credit === 0n) {
      if (reservation !== undefined)
        throw new ExpertResidencySettlementError("unexpected_reservation");
      return 0n;
    }
    if (
      reservation === undefined ||
      -bigint(reservation.amountMinor) !== credit
    ) {
      throw new ExpertResidencySettlementError("reservation_mismatch");
    }
    const spendId = randomUUID();
    await tx.execute(sql`insert into expert_referral_ledger_entries (
      id, account_expert_id, entry_kind, amount_minor, source_type, source_id,
      original_entry_id, idempotency_key
    ) values (${spendId}::uuid, ${reservation.accountExpertId}::uuid, 'spend',
      ${reservation.amountMinor}, 'residency_order', ${order.orderId}::uuid,
      ${reservation.id}::uuid, ${`residency-spend:${order.orderId}`})`);
    await this.copyAllocations(tx, reservation.id, spendId);
    return credit;
  }

  private async activeReservation(
    tx: ExpertReferralTransaction,
    orderId: string,
  ): Promise<ReservationRow | undefined> {
    return (
      await tx.execute<ReservationRow>(sql`select l.id,
        l.account_expert_id as "accountExpertId", l.amount_minor as "amountMinor"
        from expert_referral_ledger_entries l
        where l.entry_kind = 'reservation' and l.source_type = 'residency_order'
          and l.source_id = ${orderId}::uuid
          and not exists (select 1 from expert_referral_ledger_entries terminal
            where terminal.original_entry_id = l.id
              and terminal.entry_kind in ('release', 'spend'))
        for update`)
    ).rows[0];
  }

  private async copyAllocations(
    tx: ExpertReferralTransaction,
    sourceEntryId: string,
    targetEntryId: string,
  ): Promise<void> {
    const allocations = (
      await tx.execute<AllocationRow>(sql`select
        reward_grant_id as "grantId", amount_minor as "amountMinor"
        from expert_referral_ledger_allocations
        where ledger_entry_id = ${sourceEntryId}::uuid order by reward_grant_id`)
    ).rows;
    for (const allocation of allocations) {
      await tx.execute(sql`insert into expert_referral_ledger_allocations (
        ledger_entry_id, reward_grant_id, amount_minor
      ) values (${targetEntryId}::uuid, ${allocation.grantId}::uuid,
        ${bigint(allocation.amountMinor)})`);
    }
  }

  private async lockReferral(
    tx: ExpertReferralTransaction,
    inviteeExpertId: string,
  ): Promise<ReferralRow | undefined> {
    return (
      await tx.execute<ReferralRow>(sql`select id as "referralId",
        inviter_expert_id as "inviterExpertId" from expert_referrals
        where invitee_expert_id = ${inviteeExpertId}::uuid for share`)
    ).rows[0];
  }

  private async lockFirstMarker(
    tx: ExpertReferralTransaction,
    expertId: string,
  ): Promise<MarkerRow | undefined> {
    return (
      await tx.execute<MarkerRow>(sql`select id,
        qualifying_order_id as "qualifyingOrderId",
        eligibility_status as "eligibilityStatus"
        from expert_first_residency_settlements
        where expert_id = ${expertId}::uuid for update`)
    ).rows[0];
  }

  private async appendReward(
    tx: ExpertReferralTransaction,
    referral: ReferralRow,
    orderId: string,
    markerId: string,
    grantedAt: Date,
  ): Promise<{
    readonly rewardCreated: true;
    readonly debtRepaidMinor: bigint;
  }> {
    await tx.execute(sql`select pg_advisory_xact_lock(
      hashtextextended(${`expert-referral:reward:${referral.inviterExpertId}`}, 0)
    )`);
    await tx.execute(sql`select id from expert_referral_reward_grants
      where inviter_expert_id = ${referral.inviterExpertId}::uuid for update`);
    const grantId = randomUUID();
    const ledgerId = randomUUID();
    const expiresAt = new Date(
      grantedAt.getTime() + REWARD_LIFETIME_MILLISECONDS,
    );
    await tx.execute(sql`insert into expert_referral_reward_grants (
      id, inviter_expert_id, referral_id, qualifying_order_id,
      first_settlement_id, amount_minor, granted_at, expires_at
    ) values (${grantId}::uuid, ${referral.inviterExpertId}::uuid,
      ${referral.referralId}::uuid, ${orderId}::uuid, ${markerId}::uuid,
      ${REWARD_MINOR}, ${grantedAt}, ${expiresAt})`);
    await tx.execute(sql`insert into expert_referral_ledger_entries (
      id, account_expert_id, entry_kind, amount_minor, source_type, source_id,
      reward_grant_id, idempotency_key
    ) values (${ledgerId}::uuid, ${referral.inviterExpertId}::uuid,
      'reward_grant', ${REWARD_MINOR}, 'reward_grant', ${grantId}::uuid,
      ${grantId}::uuid, ${`expert-referral-reward:${referral.referralId}`})`);
    await tx.execute(sql`insert into expert_referral_ledger_allocations (
      ledger_entry_id, reward_grant_id, amount_minor
    ) values (${ledgerId}::uuid, ${grantId}::uuid, ${REWARD_MINOR})`);

    await tx.execute(sql`select id from expert_referral_ledger_entries
      where account_expert_id = ${referral.inviterExpertId}::uuid
      order by created_at, id for update`);
    const debts = (
      await tx.execute<{
        reversalId: string;
        remainingMinor: bigint | string;
      }>(sql`
        with debt_offsets as (
          select reversal.source_id as grant_id,
            coalesce(sum(repayment.amount_minor), 0)::bigint as repaid_minor
          from expert_referral_ledger_entries repayment
          join expert_referral_ledger_entries reversal
            on reversal.id = repayment.original_entry_id
            and reversal.entry_kind = 'reversal'
          where repayment.entry_kind = 'debt_repayment'
            and repayment.account_expert_id = ${referral.inviterExpertId}::uuid
          group by reversal.source_id
        ), grant_positions as (
          select g.id as grant_id,
            coalesce(sum(case
              when l.entry_kind = 'release' then 0
              when l.entry_kind = 'debt_repayment' then -a.amount_minor
              when l.entry_kind = 'reservation' and exists (
                select 1 from expert_referral_ledger_entries terminal
                where terminal.original_entry_id = l.id
                  and terminal.entry_kind in ('release', 'spend')
              ) then 0
              when l.amount_minor < 0 then -a.amount_minor
              else a.amount_minor
            end), 0)::bigint + coalesce(debt_offsets.repaid_minor, 0)::bigint
              as net_minor
          from expert_referral_reward_grants g
          left join expert_referral_ledger_allocations a
            on a.reward_grant_id = g.id
          left join expert_referral_ledger_entries l on l.id = a.ledger_entry_id
          left join debt_offsets on debt_offsets.grant_id = g.id
          where g.inviter_expert_id = ${referral.inviterExpertId}::uuid
          group by g.id, debt_offsets.repaid_minor
        )
        select reversal.id as "reversalId", (-position.net_minor)::bigint
          as "remainingMinor"
        from grant_positions position
        join expert_referral_ledger_entries reversal
          on reversal.source_id = position.grant_id
          and reversal.entry_kind = 'reversal'
        where position.net_minor < 0
        order by reversal.created_at, reversal.id
      `)
    ).rows;
    let remainingReward = REWARD_MINOR;
    for (const debt of debts) {
      if (remainingReward === 0n) break;
      const repayment =
        bigint(debt.remainingMinor) < remainingReward
          ? bigint(debt.remainingMinor)
          : remainingReward;
      const repaymentId = randomUUID();
      await tx.execute(sql`insert into expert_referral_ledger_entries (
        id, account_expert_id, entry_kind, amount_minor, source_type, source_id,
        original_entry_id, idempotency_key
      ) values (${repaymentId}::uuid, ${referral.inviterExpertId}::uuid,
        'debt_repayment', ${repayment}, 'reward_grant', ${grantId}::uuid,
        ${debt.reversalId}::uuid,
        ${`expert-referral-debt-repayment:${grantId}:${debt.reversalId}`})`);
      await tx.execute(sql`insert into expert_referral_ledger_allocations (
        ledger_entry_id, reward_grant_id, amount_minor
      ) values (${repaymentId}::uuid, ${grantId}::uuid, ${repayment})`);
      remainingReward -= repayment;
    }
    return {
      rewardCreated: true,
      debtRepaidMinor: REWARD_MINOR - remainingReward,
    };
  }

  private async lockResidencyRows(
    tx: ExpertReferralTransaction,
    expertId: string,
  ): Promise<void> {
    await tx.execute(sql`select id from expert_residency_orders
      where expert_id = ${expertId}::uuid and status = 'settled'
      order by residency_ends_at, id for update`);
  }

  private async currentResidencyEnd(
    tx: ExpertReferralTransaction,
    expertId: string,
  ): Promise<Date | null> {
    const value = (
      await tx.execute<{ residencyEnd: Date | string | null }>(sql`
        select max(residency_ends_at) as "residencyEnd"
        from expert_residency_orders where expert_id = ${expertId}::uuid
          and status = 'settled'
      `)
    ).rows[0]?.residencyEnd;
    return value === undefined || value === null ? null : date(value);
  }

  private async databaseNow(tx: ExpertReferralTransaction): Promise<Date> {
    const value = (
      await tx.execute<{ now: Date | string }>(
        sql`select transaction_timestamp() as now`,
      )
    ).rows[0]?.now;
    if (value === undefined) throw new Error("database_clock_unavailable");
    return date(value);
  }

  private async resultForOrder(
    tx: ExpertReferralTransaction,
    order: OrderRow,
    financialFacts: ExpertResidencySettlementFinancialFacts,
  ): Promise<ExpertResidencySettlementResult> {
    if (order.status === "expired") {
      return { kind: "expired", orderId: order.orderId, financialFacts };
    }
    if (
      order.status !== "settled" ||
      order.settledAt === null ||
      order.residencyStartsAt === null ||
      order.residencyEndsAt === null
    ) {
      throw new ExpertResidencySettlementError(
        "provider_event_replay_conflict",
      );
    }
    const marker = await this.lockFirstMarker(tx, order.expertId);
    const qualifies = marker?.qualifyingOrderId === order.orderId;
    const settlementEligibility = qualifies
      ? marker!.eligibilityStatus
      : "not_first_settlement";
    if (settlementEligibility === "cancelled_by_refund") {
      throw new ExpertResidencySettlementError(
        "provider_event_replay_conflict",
      );
    }
    let rewardEffect: Extract<
      ExpertResidencySettlementResult,
      { kind: "settled" }
    >["rewardEffect"] = { kind: "none" };
    if (qualifies) {
      const reward = (
        await tx.execute<{ grantId: string; repaidMinor: bigint | string }>(sql`
          select g.id as "grantId",
            coalesce(sum(l.amount_minor) filter (where l.entry_kind = 'debt_repayment'), 0)::bigint
              as "repaidMinor"
          from expert_referral_reward_grants g
          left join expert_referral_ledger_entries l
            on l.source_id = g.id and l.source_type = 'reward_grant'
          where g.qualifying_order_id = ${order.orderId}::uuid
          group by g.id
        `)
      ).rows[0];
      if (reward !== undefined) {
        rewardEffect =
          bigint(reward.repaidMinor) > 0n
            ? {
                kind: "debt_repaid",
                amountMinor: bigint(reward.repaidMinor).toString(),
              }
            : { kind: "reward_granted", amountMinor: "100000" };
      }
    }
    return {
      kind: "settled",
      orderId: order.orderId,
      settledAt: date(order.settledAt).toISOString(),
      residencyStartsAt: date(order.residencyStartsAt).toISOString(),
      residencyEndsAt: date(order.residencyEndsAt).toISOString(),
      eligibilityStatus: settlementEligibility,
      rewardEffect,
      financialFacts,
    };
  }

  private resultDigest(
    event: VerifiedExpertResidencyPaymentEvent,
    outcome: { result: ExpertResidencyProviderEventResult } | { error: string },
  ): string {
    return hash({ eventFingerprint: eventFingerprint(event), ...outcome });
  }

  private async linkFailedInbox(
    tx: ExpertReferralTransaction,
    inboxId: string,
    event: VerifiedExpertResidencyPaymentEvent,
  ): Promise<void> {
    await tx.execute(sql`update expert_residency_provider_event_inbox inbox set
      order_id = matching_order.id,
      payment_attempt_id = matching_attempt.id
      from expert_residency_orders matching_order
      left join expert_residency_payment_attempts matching_attempt
        on matching_attempt.order_id = matching_order.id
        and matching_attempt.provider = ${event.provider}
        and matching_attempt.provider_request_id = ${event.paymentId}
      where inbox.id = ${inboxId}::uuid
        and matching_order.id = ${event.orderId}::uuid`);
  }

  private async failInbox(
    tx: ExpertReferralTransaction,
    inboxId: string,
    event: VerifiedExpertResidencyPaymentEvent,
    error: string,
  ): Promise<void> {
    await tx.execute(sql`update expert_residency_provider_event_inbox set
      processing_status = 'failed', processed_at = clock_timestamp(),
      processing_result_digest = ${this.resultDigest(event, { error })},
      processing_result_code = ${error}, processing_result = null
      where id = ${inboxId}::uuid`);
  }

  private async completeInbox(
    tx: ExpertReferralTransaction,
    inboxId: string,
    event: VerifiedExpertResidencyPaymentEvent,
    result: ExpertResidencyProviderEventResult,
  ): Promise<void> {
    await tx.execute(sql`update expert_residency_provider_event_inbox set
      processing_status = 'processed', processed_at = clock_timestamp(),
      processing_result_digest = ${this.resultDigest(event, { result })},
      processing_result_code = ${result.kind},
      processing_result = ${JSON.stringify(result)}::jsonb
      where id = ${inboxId}::uuid`);
  }

  private async heldRewardEffect(
    tx: ExpertReferralTransaction,
    order: OrderRow,
  ): Promise<HeldRewardReplayResult> {
    const settlement = await this.resultForOrder(
      tx,
      order,
      noAppliedSettlementFinancialEffects(),
    );
    if (settlement.kind !== "settled") {
      throw new ExpertResidencySettlementError("held_order_not_settled");
    }
    if (settlement.rewardEffect.kind === "reward_granted") {
      return {
        ...settlement.rewardEffect,
        financialFacts: noHeldRewardFinancialFacts(),
      };
    }
    if (settlement.rewardEffect.kind === "debt_repaid") {
      return {
        ...settlement.rewardEffect,
        financialFacts: noHeldRewardFinancialFacts(),
      };
    }
    throw new ExpertResidencySettlementError("held_reward_effect_missing");
  }

  private async auditHeldReplay(
    tx: ExpertReferralTransaction,
    order: OrderRow,
    markerId: string,
    result: HeldRewardReplayResult,
  ): Promise<void> {
    const action = "expert_residency.held_reward_replayed";
    const correlationId = `held-replay:${markerId}`;
    const { financialFacts: _financialFacts, ...auditedResult } = result;
    void _financialFacts;
    const payload = {
      orderId: order.orderId,
      expertId: order.expertId,
      markerId,
      result: auditedResult,
    };
    const idempotencyKey = `expert-residency-held-replay:${markerId}`;
    const reconciliationKey = `expert-residency:${order.orderId}`;
    const payloadHash = hash(payload);
    const inserted = (
      await tx.execute<{ id: string }>(sql`insert into integration_outbox (
        idempotency_key, topic, payload, correlation_id, reconciliation_key,
        payload_hash
      ) values (${idempotencyKey}, ${action}, ${JSON.stringify(payload)}::jsonb,
        ${correlationId}, ${reconciliationKey}, ${payloadHash})
        on conflict (idempotency_key) do nothing returning id`)
    ).rows[0];
    if (inserted === undefined) {
      const existing = (
        await tx.execute<{
          topic: string;
          payload: unknown;
          correlationId: string;
          reconciliationKey: string;
          payloadHash: string;
        }>(sql`select topic, payload, correlation_id as "correlationId",
          reconciliation_key as "reconciliationKey", payload_hash as "payloadHash"
          from integration_outbox where idempotency_key = ${idempotencyKey}
          for update`)
      ).rows[0];
      if (
        existing === undefined ||
        existing.topic !== action ||
        canonicalJson(existing.payload) !== canonicalJson(payload) ||
        existing.correlationId !== correlationId ||
        existing.reconciliationKey !== reconciliationKey ||
        existing.payloadHash !== payloadHash
      ) {
        throw new ExpertResidencySettlementError("outbox_replay_conflict");
      }
      return;
    }
    await tx.execute(sql`insert into audit_events (
      actor_type, actor_id, authenticated_session_id_hash, action, object_type,
      object_id, decision, reason_code, correlation_id, occurred_at, metadata_hash
    ) values ('system', ${order.expertId}::uuid, ${hash({ markerId })}, ${action},
      'expert_first_residency_settlement', ${markerId}::uuid, 'allow',
      ${result.kind}, ${correlationId}, clock_timestamp(), ${payloadHash})`);
  }

  private async auditAndOutbox(
    tx: ExpertReferralTransaction,
    expertId: string,
    event: VerifiedExpertResidencyPaymentEvent,
    result: ExpertResidencyProviderEventResult,
  ): Promise<void> {
    const { financialFacts: _financialFacts, ...businessResult } = result;
    void _financialFacts;
    const action =
      result.kind === "settled"
        ? "expert_residency.settled"
        : result.kind === "expired"
          ? "expert_residency.expired"
          : result.kind === "refunded"
            ? "expert_residency.refunded"
            : "expert_residency.charged_back";
    const correlationId = `provider:${event.provider}:${event.eventId}`;
    const metadataHash = hash({
      orderId: event.orderId,
      kind: result.kind,
      payloadDigest: event.payloadDigest,
      verificationId: event.verification.verificationId,
      ...(result.kind === "refunded" || result.kind === "charged_back"
        ? { result: businessResult }
        : {}),
    });
    await tx.execute(sql`insert into audit_events (
      actor_type, actor_id, authenticated_session_id_hash, action, object_type,
      object_id, decision, reason_code, correlation_id, occurred_at, metadata_hash
    ) values ('provider', ${expertId}::uuid,
      ${hash({ verificationId: event.verification.verificationId })}, ${action},
      'expert_residency_order', ${event.orderId}::uuid, 'allow', ${result.kind},
      ${correlationId}, clock_timestamp(), ${metadataHash})`);
    const payload =
      result.kind === "refunded" || result.kind === "charged_back"
        ? { expertId, ...businessResult, status: result.kind }
        : {
            orderId: event.orderId,
            expertId,
            status: result.kind,
          };
    const idempotencyKey =
      result.kind === "settled" || result.kind === "expired"
        ? `expert-residency-${result.kind}:${event.orderId}`
        : `expert-residency-${result.kind}:${event.provider}:${event.eventId}`;
    const reconciliationKey = `expert-residency:${event.orderId}`;
    const payloadHash = hash(payload);
    const inserted = (
      await tx.execute<{ id: string }>(sql`insert into integration_outbox (
      idempotency_key, topic, payload, correlation_id, reconciliation_key,
      payload_hash
    ) values (${idempotencyKey}, ${action},
      ${JSON.stringify(payload)}::jsonb, ${correlationId},
      ${reconciliationKey}, ${payloadHash})
      on conflict (idempotency_key) do nothing returning id`)
    ).rows[0];
    if (inserted !== undefined) return;
    const existing = (
      await tx.execute<{
        topic: string;
        payload: unknown;
        correlationId: string;
        reconciliationKey: string;
        payloadHash: string;
      }>(sql`select topic, payload, correlation_id as "correlationId",
        reconciliation_key as "reconciliationKey", payload_hash as "payloadHash"
        from integration_outbox where idempotency_key = ${idempotencyKey}
        for update`)
    ).rows[0];
    if (
      existing === undefined ||
      existing.topic !== action ||
      canonicalJson(existing.payload) !== canonicalJson(payload) ||
      existing.correlationId !== correlationId ||
      existing.reconciliationKey !== reconciliationKey ||
      existing.payloadHash !== payloadHash
    ) {
      throw new ExpertResidencySettlementError("outbox_replay_conflict");
    }
  }
}
