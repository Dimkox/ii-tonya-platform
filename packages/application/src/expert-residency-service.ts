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
  recordExpertReferralLifecycle,
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
  readonly eligibilityStatus?:
    "eligible" | "ineligible" | "pending_feature_hold" | "not_first_settlement";
  readonly rewardEffect?:
    | Readonly<{ kind: "none" }>
    | Readonly<{ kind: "reward_granted"; amountMinor: string }>
    | Readonly<{ kind: "debt_repaid"; amountMinor: string }>;
}>;

export type ExpertResidencyRefundResult = Readonly<{
  readonly kind: "refunded" | "charged_back";
  readonly rewardReversed?: boolean;
  readonly debtMinor?: string;
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
  recordExpertReferralLifecycle({
    module: "expert_residency",
    operation,
    outcome,
    errorCode,
  });
};

const positiveDecimal = (value: string | undefined): boolean =>
  value !== undefined && /^(?:[1-9][0-9]*)$/u.test(value);

const recordSettlementMetrics = (
  result: ExpertResidencySettlementResult,
): void => {
  financialMetric(
    "first_payment_qualification",
    result.kind === "expired"
      ? "expired"
      : (result.eligibilityStatus ?? "not_first_settlement"),
  );
  if (result.kind !== "settled") return;
  financialMetric("credit_spend", "spent");
  const rewardOutcome =
    result.rewardEffect?.kind === "reward_granted"
      ? "granted"
      : result.rewardEffect?.kind === "debt_repaid"
        ? "debt_repaid"
        : result.eligibilityStatus === "pending_feature_hold"
          ? "pending_feature_hold"
          : "not_granted";
  financialMetric("reward_grant", rewardOutcome);
  if (result.rewardEffect?.kind === "debt_repaid") {
    financialMetric("debt", "debt_repaid");
  }
};

const recordRefundMetrics = (result: ExpertResidencyRefundResult): void => {
  financialMetric("refund", result.kind);
  financialMetric(
    "reversal",
    result.rewardReversed === true ? "reversed" : "not_reversed",
  );
  financialMetric(
    "debt",
    positiveDecimal(result.debtMinor) ? "debt_created" : "unchanged",
  );
};

const heldReplayOutcome = (
  kind: HeldRewardReplayResult["kind"],
): ReferralMetricLabels["outcome"] => {
  switch (kind) {
    case "reward_granted":
      return "granted";
    case "debt_repaid":
      return "debt_repaid";
    case "cancelled_by_refund":
      return "cancelled";
    case "still_held":
      return "still_held";
    case "ineligible":
    case "terminated_after_grant":
      return "ineligible";
  }
};

export const createExpertResidencyService = (
  dependencies: ExpertResidencyDependencies,
): ExpertResidencyService => ({
  async quote(principal, tariffKey) {
    try {
      const identity = await commandIdentity(dependencies, principal);
      if (isDenied(identity)) return identity;
      const result = await dependencies.orders.quote({
        expertId: identity.expertId,
        tariffKey,
      });
      financialMetric(
        "bonus_share",
        result.creditMinor === "0" ? "not_applied" : "applied",
      );
      return result;
    } catch (error) {
      financialMetric("bonus_share", "failed", "unknown");
      throw error;
    }
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

  async settle(event) {
    try {
      const result = await dependencies.existingState.settle(event);
      recordSettlementMetrics(result);
      return result;
    } catch (error) {
      financialMetric("first_payment_qualification", "failed", "unknown");
      throw error;
    }
  },
  async refund(event) {
    try {
      const result = await dependencies.existingState.refund(event);
      recordRefundMetrics(result);
      return result;
    } catch (error) {
      financialMetric("refund", "failed", "unknown");
      throw error;
    }
  },
  async reconcile(paymentId) {
    const event = await dependencies.payment.reconcile(paymentId);
    if (event === null) return null;
    if (event.kind === "settled") {
      const result = await dependencies.existingState.settle(event);
      recordSettlementMetrics(result);
      return result;
    }
    const result = await dependencies.existingState.refund(event);
    recordRefundMetrics(result);
    return result;
  },
  async releaseExpiredOrder(command) {
    try {
      const result = await dependencies.orders.releaseExpiredOrders(command);
      financialMetric(
        "credit_expiry",
        result.kind === "expired" ? "expired" : "unchanged",
      );
      return result;
    } catch (error) {
      financialMetric("credit_expiry", "failed", "unknown");
      throw error;
    }
  },
  async reverseReward(command) {
    try {
      const result = await dependencies.orders.reverseRewardGrant(command);
      financialMetric(
        "reversal",
        result.rewardReversed ? "reversed" : "not_reversed",
      );
      financialMetric(
        "debt",
        result.debtMinor > 0n ? "debt_created" : "unchanged",
      );
      return result;
    } catch (error) {
      financialMetric("reversal", "failed", "unknown");
      throw error;
    }
  },
  async replayHeldReward(command) {
    try {
      const result = await dependencies.existingState.replayHeldReward(command);
      financialMetric("held_replay", heldReplayOutcome(result.kind));
      if (result.kind === "reward_granted") {
        financialMetric("reward_grant", "granted");
      } else if (result.kind === "debt_repaid") {
        financialMetric("reward_grant", "debt_repaid");
        financialMetric("debt", "debt_repaid");
      }
      return result;
    } catch (error) {
      financialMetric("held_replay", "failed", "unknown");
      throw error;
    }
  },
});
