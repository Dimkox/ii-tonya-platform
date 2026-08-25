import { createHash, randomUUID } from "node:crypto";
import {
  requireVerifiedExpertResidencyPaymentEvent,
  type VerifiedExpertResidencyPaymentEvent,
} from "@ii-tonya/integrations";
import { sql } from "drizzle-orm";
import type { DrizzleDb } from "../client.js";
import {
  PostgresExpertReferralControlRepository,
  type ExpertReferralEligibility,
  type ExpertReferralTransaction,
} from "./expert-referral-control-repository.js";
import { withSerializableRetry } from "./message-repository.js";

const REWARD_MINOR = 100_000n;
const REWARD_LIFETIME_MILLISECONDS = 365 * 86_400_000;

export type ExpertResidencySettlementResult =
  | Readonly<{ kind: "expired"; orderId: string }>
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
    }>;

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
  eligibilityStatus: "eligible" | "ineligible" | "pending_feature_hold";
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
      Object.keys(result).length === 2 && typeof result.orderId === "string"
    );
  }
  if (
    result.kind !== "settled" ||
    Object.keys(result).length !== 7 ||
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
    Array.isArray(result.rewardEffect)
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

  constructor(private readonly db: DrizzleDb) {
    this.controls = new PostgresExpertReferralControlRepository(db);
  }

  async settle(
    input: VerifiedExpertResidencyPaymentEvent,
  ): Promise<ExpertResidencySettlementResult> {
    const event = requireVerifiedExpertResidencyPaymentEvent(input);
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
            const applied = await this.applySettlement(
              effectsTx,
              event,
              inbox.id,
            );
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

  private replayOutcome(
    inbox: InboxRow,
    event: VerifiedExpertResidencyPaymentEvent,
  ):
    | Readonly<{ result: ExpertResidencySettlementResult }>
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
        !isSettlementResult(result) ||
        inbox.processingResultCode !== result.kind ||
        inbox.processingResultDigest !== this.resultDigest(event, { result })
      ) {
        throw new ExpertResidencySettlementError(
          "provider_event_replay_conflict",
        );
      }
      return { result };
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
      return this.resultForOrder(tx, order);
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
      const result = { kind: "expired", orderId: order.orderId } as const;
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
    await this.commitReservation(tx, order);

    const priorMarker = await this.lockFirstMarker(tx, order.expertId);
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
        await this.appendReward(tx, referral, order.orderId, markerId, now);
      }
    }

    const settledOrder: OrderRow = {
      ...order,
      status: "settled",
      settledAt: now,
      residencyStartsAt: startsAt,
      residencyEndsAt: endsAt,
    };
    const result = await this.resultForOrder(tx, settledOrder);
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
    const reservation = await this.activeReservation(tx, order.orderId);
    if (reservation === undefined) return;
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
  ): Promise<void> {
    const credit = bigint(order.creditMinor);
    const reservation = await this.activeReservation(tx, order.orderId);
    if (credit === 0n) {
      if (reservation !== undefined)
        throw new ExpertResidencySettlementError("unexpected_reservation");
      return;
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
  ): Promise<void> {
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
        and entry_kind = 'reversal'
      order by created_at, id for update`);
    const debts = (
      await tx.execute<{
        reversalId: string;
        remainingMinor: bigint | string;
      }>(sql`
        select reversal.id as "reversalId",
          (abs(reversal.amount_minor) - coalesce(sum(repayment.amount_minor), 0))::bigint
            as "remainingMinor"
        from expert_referral_ledger_entries reversal
        left join expert_referral_ledger_entries repayment
          on repayment.original_entry_id = reversal.id
          and repayment.entry_kind = 'debt_repayment'
        where reversal.account_expert_id = ${referral.inviterExpertId}::uuid
          and reversal.entry_kind = 'reversal'
        group by reversal.id, reversal.amount_minor, reversal.created_at
        having abs(reversal.amount_minor) > coalesce(sum(repayment.amount_minor), 0)
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
  ): Promise<ExpertResidencySettlementResult> {
    if (order.status === "expired") {
      return { kind: "expired", orderId: order.orderId };
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
      eligibilityStatus: qualifies
        ? marker!.eligibilityStatus
        : "not_first_settlement",
      rewardEffect,
    };
  }

  private resultDigest(
    event: VerifiedExpertResidencyPaymentEvent,
    outcome: { result: ExpertResidencySettlementResult } | { error: string },
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
    result: ExpertResidencySettlementResult,
  ): Promise<void> {
    await tx.execute(sql`update expert_residency_provider_event_inbox set
      processing_status = 'processed', processed_at = clock_timestamp(),
      processing_result_digest = ${this.resultDigest(event, { result })},
      processing_result_code = ${result.kind},
      processing_result = ${JSON.stringify(result)}::jsonb
      where id = ${inboxId}::uuid`);
  }

  private async auditAndOutbox(
    tx: ExpertReferralTransaction,
    expertId: string,
    event: VerifiedExpertResidencyPaymentEvent,
    result: ExpertResidencySettlementResult,
  ): Promise<void> {
    const action =
      result.kind === "settled"
        ? "expert_residency.settled"
        : "expert_residency.expired";
    const correlationId = `provider:${event.provider}:${event.eventId}`;
    const metadataHash = hash({
      orderId: event.orderId,
      kind: result.kind,
      payloadDigest: event.payloadDigest,
      verificationId: event.verification.verificationId,
    });
    await tx.execute(sql`insert into audit_events (
      actor_type, actor_id, authenticated_session_id_hash, action, object_type,
      object_id, decision, reason_code, correlation_id, occurred_at, metadata_hash
    ) values ('provider', ${expertId}::uuid,
      ${hash({ verificationId: event.verification.verificationId })}, ${action},
      'expert_residency_order', ${event.orderId}::uuid, 'allow', ${result.kind},
      ${correlationId}, clock_timestamp(), ${metadataHash})`);
    const payload = {
      orderId: event.orderId,
      expertId,
      status: result.kind,
    };
    const idempotencyKey = `expert-residency-${result.kind}:${event.orderId}`;
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
