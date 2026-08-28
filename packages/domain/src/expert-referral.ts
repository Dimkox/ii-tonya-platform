export const POSTGRES_BIGINT_MAX = 9_223_372_036_854_775_807n;
export const MIN_RESIDENCY_DURATION_SECONDS = 86_400;
export const MAX_RESIDENCY_DURATION_SECONDS = 315_360_000;

const REWARD_LIFETIME_MILLISECONDS = 365 * 24 * 60 * 60 * 1_000;

export interface CreditGrant {
  readonly grantId: string;
  readonly availableMinor: bigint;
  readonly expiresAt: Date;
  readonly grantedAt: Date;
}

export interface CreditAllocation {
  readonly grantId: string;
  readonly amountMinor: bigint;
}

export type RewardStatus =
  "granted" | "pending_feature_hold" | "cancelled_by_refund";

export interface RewardReversalInput {
  readonly grantMinor: bigint;
  readonly availableMinor: bigint;
  readonly reservedMinor: bigint;
  readonly spentMinor: bigint;
  readonly expiresAt: Date;
  readonly reversedAt: Date;
  readonly alreadyReversed: boolean;
  readonly rewardStatus?: RewardStatus;
}

export interface ResidencyIntervalInput {
  readonly currentEndsAt: Date | null;
  readonly settledAt: Date;
  readonly durationSeconds: number;
}

function assertValidDate(value: Date): void {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    throw new Error("invalid_date");
  }
}

function assertMinor(value: bigint): void {
  if (typeof value !== "bigint" || value < 0n || value > POSTGRES_BIGINT_MAX) {
    throw new Error("invalid_money");
  }
}

function compareGrantIds(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function addMilliseconds(at: Date, milliseconds: number): Date {
  const result = new Date(at.getTime() + milliseconds);
  assertValidDate(result);
  return result;
}

export function quoteResidency(
  priceMinor: bigint,
  availableMinor: bigint,
  creditCapBps = 5_000,
) {
  assertMinor(priceMinor);
  assertMinor(availableMinor);
  if (priceMinor === 0n) throw new Error("invalid_money");
  if (
    !Number.isSafeInteger(creditCapBps) ||
    creditCapBps < 0 ||
    creditCapBps > 10_000
  ) {
    throw new Error("invalid_credit_cap");
  }

  const ceiling = (priceMinor * BigInt(creditCapBps)) / 10_000n;
  const creditMinor = availableMinor < ceiling ? availableMinor : ceiling;
  return { creditMinor, cashMinor: priceMinor - creditMinor } as const;
}

export function settlementBeforeDeadline(now: Date, deadline: Date): boolean {
  assertValidDate(now);
  assertValidDate(deadline);
  return now.getTime() < deadline.getTime();
}

export function allocateCreditFifo(
  grants: readonly CreditGrant[],
  requiredMinor: bigint,
  at: Date,
): readonly CreditAllocation[] {
  assertMinor(requiredMinor);
  assertValidDate(at);

  const grantIds = new Set<string>();
  const eligible = grants
    .map((grant) => {
      if (
        typeof grant.grantId !== "string" ||
        grant.grantId.length === 0 ||
        grantIds.has(grant.grantId)
      ) {
        throw new Error("invalid_grant");
      }
      grantIds.add(grant.grantId);
      assertMinor(grant.availableMinor);
      assertValidDate(grant.expiresAt);
      assertValidDate(grant.grantedAt);
      return grant;
    })
    .filter(
      (grant) =>
        grant.availableMinor > 0n &&
        settlementBeforeDeadline(at, grant.expiresAt),
    )
    .toSorted(
      (left, right) =>
        left.expiresAt.getTime() - right.expiresAt.getTime() ||
        left.grantedAt.getTime() - right.grantedAt.getTime() ||
        compareGrantIds(left.grantId, right.grantId),
    );

  let remainingMinor = requiredMinor;
  const allocations: CreditAllocation[] = [];
  for (const grant of eligible) {
    if (remainingMinor === 0n) break;
    const amountMinor =
      grant.availableMinor < remainingMinor
        ? grant.availableMinor
        : remainingMinor;
    allocations.push({ grantId: grant.grantId, amountMinor });
    remainingMinor -= amountMinor;
  }

  if (remainingMinor !== 0n) throw new Error("insufficient_credit");
  return allocations;
}

export function rewardExpiresAt(grantedAt: Date): Date {
  assertValidDate(grantedAt);
  return addMilliseconds(grantedAt, REWARD_LIFETIME_MILLISECONDS);
}

export function resolveRewardReversal(input: RewardReversalInput) {
  assertMinor(input.grantMinor);
  assertMinor(input.availableMinor);
  assertMinor(input.reservedMinor);
  assertMinor(input.spentMinor);
  assertValidDate(input.expiresAt);
  assertValidDate(input.reversedAt);
  if (typeof input.alreadyReversed !== "boolean")
    throw new Error("invalid_reversal");
  if (
    input.rewardStatus !== undefined &&
    input.rewardStatus !== "granted" &&
    input.rewardStatus !== "pending_feature_hold" &&
    input.rewardStatus !== "cancelled_by_refund"
  ) {
    throw new Error("invalid_reversal");
  }
  if (
    input.availableMinor + input.reservedMinor + input.spentMinor >
    input.grantMinor
  ) {
    throw new Error("invalid_reversal");
  }
  if (
    input.alreadyReversed ||
    input.rewardStatus === "pending_feature_hold" ||
    input.rewardStatus === "cancelled_by_refund"
  ) {
    return { remove: 0n, cancelReservations: 0n, debt: 0n } as const;
  }

  return {
    remove: settlementBeforeDeadline(input.reversedAt, input.expiresAt)
      ? input.availableMinor
      : 0n,
    cancelReservations: input.reservedMinor,
    debt: input.spentMinor,
  } as const;
}

export function applyRewardToDebt(rewardMinor: bigint, debtMinor: bigint) {
  assertMinor(rewardMinor);
  assertMinor(debtMinor);

  const debtRepaidMinor = rewardMinor < debtMinor ? rewardMinor : debtMinor;
  return {
    debtRepaidMinor,
    creditMinor: rewardMinor - debtRepaidMinor,
    remainingDebtMinor: debtMinor - debtRepaidMinor,
  } as const;
}

export function nextResidencyInterval(input: ResidencyIntervalInput) {
  assertValidDate(input.settledAt);
  if (input.currentEndsAt !== null) assertValidDate(input.currentEndsAt);
  if (
    !Number.isInteger(input.durationSeconds) ||
    input.durationSeconds < MIN_RESIDENCY_DURATION_SECONDS ||
    input.durationSeconds > MAX_RESIDENCY_DURATION_SECONDS
  ) {
    throw new Error("invalid_duration");
  }

  const startsAt =
    input.currentEndsAt !== null &&
    input.currentEndsAt.getTime() > input.settledAt.getTime()
      ? new Date(input.currentEndsAt.getTime())
      : new Date(input.settledAt.getTime());
  return {
    startsAt,
    endsAt: addMilliseconds(startsAt, input.durationSeconds * 1_000),
  } as const;
}
