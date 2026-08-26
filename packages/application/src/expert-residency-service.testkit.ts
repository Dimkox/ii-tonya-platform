import type {
  ExpertResidencyDependencies,
  VerifiedExpertResidencyEvent,
} from "./expert-residency-service.js";
import type { ExpertPrincipal } from "./expert-referral-service.js";

export interface ExpertResidencyFixture extends ExpertResidencyDependencies {
  readonly owner: ExpertPrincipal;
  readonly other: ExpertPrincipal;
  readonly settledEvent: VerifiedExpertResidencyEvent;
  readonly refundEvent: VerifiedExpertResidencyEvent;
  setAuthorized(expertId: string, authorized: boolean): void;
  setNewCommandsEnabled(enabled: boolean): void;
  controlReadCount(): number;
  quoteCount(): number;
  checkoutCount(): number;
  existingStateOperations(): readonly string[];
}

export const expertResidencyFixture = (
  options: { readonly billingEnabled?: boolean } = {},
): ExpertResidencyFixture => {
  const owner: ExpertPrincipal = {
    expertId: "00000000-0000-4000-8000-000000000811",
    userId: "00000000-0000-4000-8000-000000000812",
    provider: "telegram",
    externalId: "811",
  };
  const other: ExpertPrincipal = {
    expertId: "00000000-0000-4000-8000-000000000813",
    userId: "00000000-0000-4000-8000-000000000814",
    provider: "telegram",
    externalId: "813",
  };
  const authorization = new Map([
    [owner.expertId, true],
    [other.expertId, false],
  ]);
  const operations: string[] = [];
  let newCommandsEnabled = true;
  let controlReads = 0;
  let quotes = 0;
  let checkouts = 0;
  const payloadDigest = `sha256:${"a".repeat(64)}`;
  const verification = {
    verificationId: "verify_811",
    verifierKeyVersion: "sandbox-v1",
    verifiedAt: "2026-08-03T00:00:01.000Z",
    payloadDigest,
  };
  const settledEvent: VerifiedExpertResidencyEvent = {
    kind: "settled",
    provider: "sandbox",
    eventId: "evt_settled_811",
    paymentId: "pay_811",
    orderId: "00000000-0000-4000-8000-000000000815",
    amountMinor: "100000",
    currency: "RUB",
    occurredAt: "2026-08-03T00:00:00.000Z",
    payloadDigest,
    verification,
  };
  const refundEvent: VerifiedExpertResidencyEvent = {
    kind: "refunded",
    provider: "sandbox",
    eventId: "evt_refund_811",
    paymentId: "pay_811",
    orderId: "00000000-0000-4000-8000-000000000815",
    amountMinor: "100000",
    currency: "RUB",
    occurredAt: "2026-08-03T00:00:00.000Z",
    payloadDigest,
    terminatesResidency: true,
    verification,
  };

  return {
    owner,
    other,
    settledEvent,
    refundEvent,
    billingEnabled: options.billingEnabled ?? true,
    identity: {
      async authorize(principal) {
        return authorization.get(principal.expertId) === true
          ? { ...principal }
          : null;
      },
    },
    controls: {
      async readForCommand() {
        controlReads += 1;
        return { version: controlReads, newCommandsEnabled };
      },
    },
    orders: {
      async quote(command) {
        quotes += 1;
        if (command.expertId !== owner.expertId)
          throw new Error("cross_expert_quote");
        return {
          tariffVersionId: command.tariffKey,
          displayName: "Expert residency",
          description: "One year",
          priceMinor: "200000",
          currency: "RUB" as const,
          durationSeconds: 31_536_000,
          creditMinor: "100000",
          cashMinor: "100000",
        };
      },
      async createCheckoutOrder(command) {
        checkouts += 1;
        return {
          orderId: "00000000-0000-4000-8000-000000000815",
          expertId: command.expertId,
          tariffVersionId: command.tariffKey,
          displayName: "Expert residency",
          description: "One year",
          priceMinor: "200000",
          currency: "RUB" as const,
          durationSeconds: 31_536_000,
          creditMinor: "100000",
          cashMinor: "100000",
          paymentDeadline: new Date("2026-08-03T00:30:00.000Z"),
          status: "quoted" as const,
          allocations: [],
        };
      },
      async releaseExpiredOrders() {
        operations.push("release");
        return { kind: "expired" as const, released: true };
      },
      async reverseRewardGrant() {
        operations.push("reverse");
        return {
          rewardReversed: true,
          removedCreditMinor: 50_000n,
          cancelledReservationMinor: 0n,
          debtMinor: 0n,
        };
      },
    },
    payment: {
      async createCheckout(command) {
        operations.push(`payment:${command.amountMinor}`);
        return {
          kind: "created" as const,
          provider: "sandbox",
          paymentId: "pay_811",
          checkoutUrl: "https://sandbox.invalid/checkout/pay_811",
          expiresAt: command.expiresAt,
        };
      },
      async reconcile(paymentId) {
        operations.push(`reconcile:${paymentId}`);
        return settledEvent;
      },
    },
    existingState: {
      async settle() {
        operations.push("settle");
        return { kind: "settled" as const };
      },
      async refund() {
        operations.push("refund");
        return { kind: "refunded" as const };
      },
      async replayHeldReward() {
        operations.push("replay");
        return { kind: "reward_granted" as const, amountMinor: "100000" };
      },
    },
    setAuthorized(expertId, authorized) {
      authorization.set(expertId, authorized);
    },
    setNewCommandsEnabled(enabled) {
      newCommandsEnabled = enabled;
    },
    controlReadCount: () => controlReads,
    quoteCount: () => quotes,
    checkoutCount: () => checkouts,
    existingStateOperations: () => [...operations],
  };
};
