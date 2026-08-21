const POSTGRES_BIGINT_MAX = 9_223_372_036_854_775_807n;
const MILLISECONDS_PER_SECOND = 1_000;
const MILLISECONDS_PER_DAY = 86_400_000;
const REWARD_LIFETIME_DAYS = 365;
const MIN_RESIDENCY_DURATION_SECONDS = 86_400;
const MAX_RESIDENCY_DURATION_SECONDS = 315_360_000;
export const EXPERT_REFERRAL_REWARD_MINOR = 100_000n;

export interface ReferralCreditGrant {
  grantId: string;
  availableMinor: bigint;
  grantedAt: Date;
  expiresAt: Date;
}

export interface CreditAllocation {
  grantId: string;
  amountMinor: bigint;
}

export type RewardStatus =
  | "granted"
  | "pending_feature_hold"
  | "cancelled_by_refund"
  | "reversed";

function requireDate(value: Date): number {
  if (!(value instanceof Date)) throw new Error("invalid_date");
  const milliseconds = value.getTime();
  if (!Number.isFinite(milliseconds)) throw new Error("invalid_date");
  return milliseconds;
}

function requireMinor(value: bigint): void {
  if (value < 0n || value > POSTGRES_BIGINT_MAX) throw new Error("invalid_money");
}

function dateAt(milliseconds: number): Date {
  const date = new Date(milliseconds);
  if (Number.isNaN(date.getTime())) throw new Error("invalid_date");
  return date;
}

export function quoteResidency(priceMinor: bigint, availableMinor: bigint) {
  if (priceMinor <= 0n || availableMinor < 0n) throw new Error("invalid_money");
  if (priceMinor > POSTGRES_BIGINT_MAX || availableMinor > POSTGRES_BIGINT_MAX) {
    throw new Error("invalid_money");
  }
  const creditMinor = availableMinor < priceMinor / 2n ? availableMinor : priceMinor / 2n;
  return { creditMinor, cashMinor: priceMinor - creditMinor } as const;
}

export function rewardExpiresAt(grantedAt: Date): Date {
  const grantedAtMilliseconds = requireDate(grantedAt);
  const expiresAtMilliseconds = grantedAtMilliseconds + REWARD_LIFETIME_DAYS * MILLISECONDS_PER_DAY;
  if (!Number.isFinite(expiresAtMilliseconds)) throw new Error("invalid_date");
  return dateAt(expiresAtMilliseconds);
}

export function settlementBeforeDeadline(now: Date, deadline: Date): boolean {
  return requireDate(now) < requireDate(deadline);
}

export function allocateCreditFifo(input: {
  grants: readonly ReferralCreditGrant[];
  allocationMinor: bigint;
  at: Date;
}): readonly CreditAllocation[] {
  requireMinor(input.allocationMinor);
  const atMilliseconds = requireDate(input.at);
  const grantIds = new Set<string>();
  const grants = input.grants.map((grant) => {
    if (typeof grant.grantId !== "string" || grant.grantId.length === 0 || grantIds.has(grant.grantId)) {
      throw new Error("invalid_credit_grant");
    }
    grantIds.add(grant.grantId);
    requireMinor(grant.availableMinor);
    return {
      ...grant,
      grantedAtMilliseconds: requireDate(grant.grantedAt),
      expiresAtMilliseconds: requireDate(grant.expiresAt),
    };
  }).toSorted((left, right) => left.expiresAtMilliseconds - right.expiresAtMilliseconds
    || left.grantedAtMilliseconds - right.grantedAtMilliseconds
    || left.grantId.localeCompare(right.grantId));

  let remainingMinor = input.allocationMinor;
  const allocations: CreditAllocation[] = [];
  for (const grant of grants) {
    if (grant.expiresAtMilliseconds <= atMilliseconds || remainingMinor === 0n) continue;
    const amountMinor = grant.availableMinor < remainingMinor ? grant.availableMinor : remainingMinor;
    if (amountMinor > 0n) allocations.push({ grantId: grant.grantId, amountMinor });
    remainingMinor -= amountMinor;
  }
  if (remainingMinor !== 0n) throw new Error("insufficient_credit");
  return allocations;
}

export function resolveRewardReversal(input: {
  rewardStatus: RewardStatus;
  unspentMinor: bigint;
  reservedMinor: bigint;
  spentMinor: bigint;
}) {
  requireMinor(input.unspentMinor);
  requireMinor(input.reservedMinor);
  requireMinor(input.spentMinor);
  if (input.unspentMinor + input.reservedMinor + input.spentMinor > EXPERT_REFERRAL_REWARD_MINOR) {
    throw new Error("invalid_reward_allocation");
  }
  if (input.rewardStatus !== "granted") {
    return { remove: 0n, cancelReservations: 0n, debt: 0n } as const;
  }
  return {
    remove: input.unspentMinor,
    cancelReservations: input.reservedMinor,
    debt: input.spentMinor,
  } as const;
}

export function applyRewardToDebt(debtMinor: bigint) {
  requireMinor(debtMinor);
  const debtRepaidMinor = debtMinor < EXPERT_REFERRAL_REWARD_MINOR
    ? debtMinor
    : EXPERT_REFERRAL_REWARD_MINOR;
  return {
    debtRepaidMinor,
    creditMinor: EXPERT_REFERRAL_REWARD_MINOR - debtRepaidMinor,
    remainingDebtMinor: debtMinor - debtRepaidMinor,
  } as const;
}

export function nextResidencyInterval(input: {
  currentEndsAt: Date;
  settledAt: Date;
  durationSeconds: number;
}) {
  const currentEndsAtMilliseconds = requireDate(input.currentEndsAt);
  const settledAtMilliseconds = requireDate(input.settledAt);
  if (!Number.isSafeInteger(input.durationSeconds)
    || input.durationSeconds < MIN_RESIDENCY_DURATION_SECONDS
    || input.durationSeconds > MAX_RESIDENCY_DURATION_SECONDS) {
    throw new Error("invalid_duration");
  }
  const startsAtMilliseconds = Math.max(currentEndsAtMilliseconds, settledAtMilliseconds);
  const endsAtMilliseconds = startsAtMilliseconds + input.durationSeconds * MILLISECONDS_PER_SECOND;
  if (!Number.isFinite(endsAtMilliseconds)) throw new Error("invalid_date");
  return { startsAt: dateAt(startsAtMilliseconds), endsAt: dateAt(endsAtMilliseconds) } as const;
}
