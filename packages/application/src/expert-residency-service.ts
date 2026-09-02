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
import {
  safelyRecordExpertReferralLifecycle,
  type ReferralMetricLabels,
} from "@ii-tonya/observability";

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

export type ExpertFinancialTelemetryEffect = Readonly<{
  readonly operation: Exclude<
    ReferralMetricLabels["operation"],
    "duplicate_event"
  >;
  readonly outcome: ReferralMetricLabels["outcome"];
  readonly errorCode: NonNullable<ReferralMetricLabels["errorCode"]>;
}>;

export type ExpertFinancialTelemetry =
  | Readonly<{
      readonly disposition: "applied";
      readonly effects: readonly ExpertFinancialTelemetryEffect[];
    }>
  | Readonly<{
      readonly disposition: "duplicate";
      readonly effects: readonly [];
    }>;

export interface ResidencyCheckoutOrder extends ResidencyQuote {
  readonly orderId: string;
  readonly expertId: string;
  readonly paymentDeadline: Date;
  readonly status: string;
  readonly allocations: readonly {
    readonly grantId: string;
    readonly amountMinor: string;
  }[];
  readonly telemetry: ExpertFinancialTelemetry;
}

export type VerifiedExpertResidencyEvent = Readonly<
  ExpertResidencyPaymentEvent & {
    readonly verification: ExpertResidencyVerificationEvidence;
  }
>;

export type ExpertResidencySettlementResult = Readonly<{
  readonly kind: "settled" | "expired";
  readonly eligibilityStatus?:
    "eligible" | "ineligible" | "pending_feature_hold" | "not_first_settlement";
  readonly rewardEffect?:
    | Readonly<{ kind: "none" }>
    | Readonly<{ kind: "reward_granted"; amountMinor: string }>
    | Readonly<{ kind: "debt_repaid"; amountMinor: string }>;
  readonly telemetry: ExpertFinancialTelemetry;
}>;

export type ExpertResidencyRefundResult = Readonly<{
  readonly kind: "refunded" | "charged_back";
  readonly rewardReversed?: boolean;
  readonly debtMinor?: string;
  readonly telemetry: ExpertFinancialTelemetry;
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
  readonly telemetry: ExpertFinancialTelemetry;
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
  releaseExpiredOrders(command: { readonly orderId: string }): Promise<
    | {
        readonly kind: "settlement_allowed";
        readonly released: false;
        readonly telemetry: ExpertFinancialTelemetry;
      }
    | {
        readonly kind: "expired";
        readonly released: boolean;
        readonly telemetry: ExpertFinancialTelemetry;
      }
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
    readonly telemetry: ExpertFinancialTelemetry;
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
  const identity = await authorizeExpert(dependencies.identity, principal);
  if (!dependencies.billingEnabled) return { kind: "disabled" };
  if (identity === null) return { kind: "forbidden" };
  const control = await dependencies.controls.readForCommand();
  return control.newCommandsEnabled ? identity : { kind: "disabled" };
};

const isDenied = (
  value: ExpertCommandDenied | ExpertPrincipal,
): value is ExpertCommandDenied => "kind" in value;

const financialMetric = (
  operation: ReferralMetricLabels["operation"],
  outcome: ReferralMetricLabels["outcome"],
  errorCode: NonNullable<ReferralMetricLabels["errorCode"]> = "none",
): void => {
  safelyRecordExpertReferralLifecycle({
    module: "expert_residency",
    operation,
    outcome,
    errorCode,
  });
};

const recordFinancialTelemetry = (
  telemetry: ExpertFinancialTelemetry,
): void => {
  try {
    if (telemetry.disposition === "duplicate") {
      financialMetric("duplicate_event", "duplicate");
      return;
    }
    for (const effect of telemetry.effects) {
      financialMetric(effect.operation, effect.outcome, effect.errorCode);
    }
  } catch {
    // Invalid or unavailable telemetry must not alter financial semantics.
  }
};

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
    recordFinancialTelemetry(order.telemetry);
    const payment = await dependencies.payment.createCheckout({
      orderId: order.orderId,
      idempotencyKey: request.idempotencyKey,
      amountMinor: order.cashMinor,
      currency: order.currency,
      expiresAt: order.paymentDeadline.toISOString(),
    });
    return { kind: "checkout_created", order, payment };
  },

  async settle(event) {
    const result = await dependencies.existingState.settle(event);
    recordFinancialTelemetry(result.telemetry);
    return result;
  },
  async refund(event) {
    const result = await dependencies.existingState.refund(event);
    recordFinancialTelemetry(result.telemetry);
    return result;
  },
  async reconcile(paymentId) {
    const event = await dependencies.payment.reconcile(paymentId);
    if (event === null) return null;
    if (event.kind === "settled") {
      const result = await dependencies.existingState.settle(event);
      recordFinancialTelemetry(result.telemetry);
      return result;
    }
    const result = await dependencies.existingState.refund(event);
    recordFinancialTelemetry(result.telemetry);
    return result;
  },
  async releaseExpiredOrder(command) {
    const result = await dependencies.orders.releaseExpiredOrders(command);
    recordFinancialTelemetry(result.telemetry);
    return result;
  },
  async reverseReward(command) {
    const result = await dependencies.orders.reverseRewardGrant(command);
    recordFinancialTelemetry(result.telemetry);
    return result;
  },
  async replayHeldReward(command) {
    const result = await dependencies.existingState.replayHeldReward(command);
    recordFinancialTelemetry(result.telemetry);
    return result;
  },
});
