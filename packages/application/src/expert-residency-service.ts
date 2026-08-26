import type {
  ExpertResidencyCheckoutCommand,
  ExpertResidencyCheckoutOutcome,
  ExpertResidencyPaymentEvent,
  ExpertResidencyVerificationEvidence,
} from "@ii-tonya/contracts";
import {
  authorizeExpert,
  type ExpertCommandDenied,
  type ExpertIdentityAuthorizationPort,
  type ExpertPrincipal,
  type ExpertReferralControlPort,
} from "./expert-referral-service.js";

export interface ResidencyQuote {
  readonly tariffVersionId: string;
  readonly displayName: string;
  readonly description: string;
  readonly priceMinor: string;
  readonly currency: "RUB";
  readonly durationSeconds: number;
  readonly creditMinor: string;
  readonly cashMinor: string;
}

export interface ResidencyCheckoutOrder extends ResidencyQuote {
  readonly orderId: string;
  readonly expertId: string;
  readonly paymentDeadline: Date;
  readonly status: string;
  readonly allocations: readonly {
    readonly grantId: string;
    readonly amountMinor: string;
  }[];
}

export type VerifiedExpertResidencyEvent = Readonly<
  ExpertResidencyPaymentEvent & {
    readonly verification: ExpertResidencyVerificationEvidence;
  }
>;

export type ExpertResidencySettlementResult = Readonly<{
  readonly kind: "settled" | "expired";
}>;

export type ExpertResidencyRefundResult = Readonly<{
  readonly kind: "refunded" | "charged_back";
}>;

export type HeldRewardReplayResult = Readonly<{
  readonly kind:
    | "still_held"
    | "cancelled_by_refund"
    | "ineligible"
    | "terminated_after_grant"
    | "reward_granted"
    | "debt_repaid";
  readonly amountMinor?: string;
  readonly reason?: string;
}>;

export interface ExpertResidencyOrderPort {
  quote(command: {
    readonly expertId: string;
    readonly tariffKey: string;
  }): Promise<ResidencyQuote>;
  createCheckoutOrder(command: {
    readonly expertId: string;
    readonly tariffKey: string;
    readonly providerDeadline: Date;
    readonly idempotencyKey: string;
  }): Promise<ResidencyCheckoutOrder>;
  releaseExpiredOrders(command: {
    readonly orderId: string;
  }): Promise<
    | { readonly kind: "settlement_allowed"; readonly released: false }
    | { readonly kind: "expired"; readonly released: boolean }
  >;
  reverseRewardGrant(command: {
    readonly grantId: string;
    readonly inviterExpertId: string;
    readonly reversedAt: Date;
  }): Promise<{
    readonly rewardReversed: boolean;
    readonly removedCreditMinor: bigint;
    readonly cancelledReservationMinor: bigint;
    readonly debtMinor: bigint;
  }>;
}

export interface ExpertResidencyPaymentPort {
  createCheckout(
    command: ExpertResidencyCheckoutCommand,
  ): Promise<ExpertResidencyCheckoutOutcome>;
  reconcile(paymentId: string): Promise<VerifiedExpertResidencyEvent | null>;
}

export interface ExpertResidencyExistingStatePort {
  settle(
    event: VerifiedExpertResidencyEvent,
  ): Promise<ExpertResidencySettlementResult>;
  refund(
    event: VerifiedExpertResidencyEvent,
  ): Promise<ExpertResidencyRefundResult>;
  replayHeldReward(command: {
    readonly expertId: string;
    readonly qualifyingOrderId: string;
  }): Promise<HeldRewardReplayResult>;
}

export interface ExpertResidencyDependencies {
  readonly billingEnabled: boolean;
  readonly identity: ExpertIdentityAuthorizationPort;
  readonly controls: ExpertReferralControlPort;
  readonly orders: ExpertResidencyOrderPort;
  readonly payment: ExpertResidencyPaymentPort;
  readonly existingState: ExpertResidencyExistingStatePort;
}

export interface ExpertResidencyCheckoutRequest {
  readonly tariffKey: string;
  readonly idempotencyKey: string;
  readonly providerDeadline: Date;
}

export type ResidencyCheckoutResult =
  | ExpertCommandDenied
  | {
      readonly kind: "checkout_created";
      readonly order: ResidencyCheckoutOrder;
      readonly payment: ExpertResidencyCheckoutOutcome;
    };

export interface ExpertResidencyService {
  quote(
    principal: ExpertPrincipal,
    tariffKey: string,
  ): Promise<ExpertCommandDenied | ResidencyQuote>;
  checkout(
    principal: ExpertPrincipal,
    request: ExpertResidencyCheckoutRequest,
  ): Promise<ResidencyCheckoutResult>;
  settle(
    event: VerifiedExpertResidencyEvent,
  ): Promise<ExpertResidencySettlementResult>;
  refund(
    event: VerifiedExpertResidencyEvent,
  ): Promise<ExpertResidencyRefundResult>;
  reconcile(
    paymentId: string,
  ): Promise<
    ExpertResidencySettlementResult | ExpertResidencyRefundResult | null
  >;
  releaseExpiredOrder(command: {
    readonly orderId: string;
  }): ReturnType<ExpertResidencyOrderPort["releaseExpiredOrders"]>;
  reverseReward(command: {
    readonly grantId: string;
    readonly inviterExpertId: string;
    readonly reversedAt: Date;
  }): ReturnType<ExpertResidencyOrderPort["reverseRewardGrant"]>;
  replayHeldReward(command: {
    readonly expertId: string;
    readonly qualifyingOrderId: string;
  }): ReturnType<ExpertResidencyExistingStatePort["replayHeldReward"]>;
}

const commandIdentity = async (
  dependencies: ExpertResidencyDependencies,
  principal: ExpertPrincipal,
): Promise<ExpertCommandDenied | ExpertPrincipal> => {
  if (!dependencies.billingEnabled) return { kind: "disabled" };
  const identity = await authorizeExpert(dependencies.identity, principal);
  if (identity === null) return { kind: "forbidden" };
  const control = await dependencies.controls.readForCommand();
  return control.newCommandsEnabled ? identity : { kind: "disabled" };
};

const isDenied = (
  value: ExpertCommandDenied | ExpertPrincipal,
): value is ExpertCommandDenied => "kind" in value;

export const createExpertResidencyService = (
  dependencies: ExpertResidencyDependencies,
): ExpertResidencyService => ({
  async quote(principal, tariffKey) {
    const identity = await commandIdentity(dependencies, principal);
    if (isDenied(identity)) return identity;
    return dependencies.orders.quote({
      expertId: identity.expertId,
      tariffKey,
    });
  },

  async checkout(principal, request) {
    const identity = await commandIdentity(dependencies, principal);
    if (isDenied(identity)) return identity;
    const order = await dependencies.orders.createCheckoutOrder({
      expertId: identity.expertId,
      tariffKey: request.tariffKey,
      providerDeadline: request.providerDeadline,
      idempotencyKey: request.idempotencyKey,
    });
    if (order.expertId !== identity.expertId) {
      throw new Error("expert_residency_order_ownership_mismatch");
    }
    const payment = await dependencies.payment.createCheckout({
      orderId: order.orderId,
      idempotencyKey: request.idempotencyKey,
      amountMinor: order.cashMinor,
      currency: order.currency,
      expiresAt: order.paymentDeadline.toISOString(),
    });
    return { kind: "checkout_created", order, payment };
  },

  settle: (event) => dependencies.existingState.settle(event),
  refund: (event) => dependencies.existingState.refund(event),
  async reconcile(paymentId) {
    const event = await dependencies.payment.reconcile(paymentId);
    if (event === null) return null;
    return event.kind === "settled"
      ? dependencies.existingState.settle(event)
      : dependencies.existingState.refund(event);
  },
  releaseExpiredOrder: (command) =>
    dependencies.orders.releaseExpiredOrders(command),
  reverseReward: (command) => dependencies.orders.reverseRewardGrant(command),
  replayHeldReward: (command) =>
    dependencies.existingState.replayHeldReward(command),
});
