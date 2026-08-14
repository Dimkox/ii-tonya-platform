import type {
  ExpertPrincipal,
  ForbiddenResult,
} from "./expert-referral-service.js";

export interface ResidencyQuote {
  tariffVersionId?: string;
  displayName?: string;
  priceMinor: string;
  currency?: "RUB";
  durationSeconds?: number;
  creditMinor: string;
  cashMinor: string;
}
export interface ResidencyCheckoutOrder extends ResidencyQuote {
  id: string;
  status: "payment_pending" | "expired";
}
export interface ResidencyTariff {
  readonly tariffVersionId: string;
  readonly displayName: string;
  readonly priceMinor: string;
  readonly currency: "RUB";
  readonly durationSeconds: number;
}
export interface ResidencyCheckoutProvider {
  createCheckout(input: {
    orderId: string;
    amountMinor: string;
    currency: "RUB";
    idempotencyKey: string;
  }): Promise<{
    kind: "created";
    paymentId: string;
    checkoutUrl: string;
  }>;
}
export interface ExpertResidencyCommands {
  listActiveTariffs(input: {
    expertId: string;
    limit: 20;
  }): Promise<readonly ResidencyTariff[]>;
  quote(input: {
    expertId: string;
    tariffVersionId: string;
  }): Promise<ResidencyQuote>;
  checkout(input: {
    expertId: string;
    tariffVersionId: string;
    idempotencyKey: string;
  }): Promise<ResidencyCheckoutOrder>;
}
export interface ExpertResidencyQueries {
  ownerUserId(expertId: string): Promise<string | undefined>;
}
export interface ExpertResidencyReconciliation {
  settle(input: unknown): Promise<unknown>;
  reverse(input: unknown): Promise<unknown>;
  replayHeldReward(expertId: string): Promise<unknown>;
  releaseExpiredOrders(limit: number): Promise<unknown>;
}
export interface ExpertResidencyService {
  listActiveTariffs(
    principal: ExpertPrincipal,
  ): Promise<
    readonly ResidencyTariff[] | ForbiddenResult | { kind: "disabled" }
  >;
  quote(
    principal: ExpertPrincipal,
    tariffVersionId: string,
  ): Promise<ResidencyQuote | ForbiddenResult | { kind: "disabled" }>;
  checkout(
    principal: ExpertPrincipal,
    tariffVersionId: string,
    idempotencyKey: string,
  ): Promise<
    | ForbiddenResult
    | { kind: "disabled" }
    | {
        id: string;
        status: "payment_pending" | "expired";
        payment?: {
          kind: "created";
          paymentId: string;
          checkoutUrl: string;
        };
      }
  >;
  reconciliation: ExpertResidencyReconciliation;
}

export const createExpertResidencyService = (deps: {
  environmentEnabled: boolean;
  commands: ExpertResidencyCommands;
  queries: ExpertResidencyQueries;
  reconciliation: ExpertResidencyReconciliation;
  checkoutProvider?: ResidencyCheckoutProvider;
}): ExpertResidencyService => {
  const owns = async (principal: ExpertPrincipal) =>
    principal.authenticated &&
    (await deps.queries.ownerUserId(principal.expertId)) === principal.userId;
  return {
    async listActiveTariffs(principal) {
      if (!(await owns(principal))) return { kind: "forbidden" };
      if (!deps.environmentEnabled) return { kind: "disabled" };
      return deps.commands.listActiveTariffs({
        expertId: principal.expertId,
        limit: 20,
      });
    },
    async quote(principal, tariffVersionId) {
      if (!(await owns(principal))) return { kind: "forbidden" };
      if (!deps.environmentEnabled) return { kind: "disabled" };
      return deps.commands.quote({
        expertId: principal.expertId,
        tariffVersionId,
      });
    },
    async checkout(principal, tariffVersionId, idempotencyKey) {
      if (!(await owns(principal))) return { kind: "forbidden" };
      if (!deps.environmentEnabled) return { kind: "disabled" };
      const order = await deps.commands.checkout({
        expertId: principal.expertId,
        tariffVersionId,
        idempotencyKey,
      });
      if (
        order.status !== "payment_pending" ||
        deps.checkoutProvider === undefined
      ) {
        return { id: order.id, status: order.status };
      }
      const payment = await deps.checkoutProvider.createCheckout({
        orderId: order.id,
        amountMinor: order.cashMinor,
        currency: "RUB",
        idempotencyKey,
      });
      return { id: order.id, status: order.status, payment };
    },
    reconciliation: deps.reconciliation,
  };
};
