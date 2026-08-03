import type { ExpertPrincipal, ForbiddenResult } from "./expert-referral-service.js";

export interface ResidencyQuote { priceMinor: string; creditMinor: string; cashMinor: string; [key: string]: unknown }
export interface ExpertResidencyCommands {
  quote(input: { expertId: string; tariffVersionId: string }): Promise<ResidencyQuote>;
  checkout(input: { expertId: string; tariffVersionId: string; idempotencyKey: string }): Promise<unknown>;
}
export interface ExpertResidencyQueries { ownerUserId(expertId: string): Promise<string | undefined> }
export interface ExpertResidencyReconciliation {
  settle(input: unknown): Promise<unknown>;
  reverse(input: unknown): Promise<unknown>;
  replayHeldReward(expertId: string): Promise<unknown>;
  releaseExpiredOrders(limit: number): Promise<unknown>;
}
export interface ExpertResidencyService {
  quote(principal: ExpertPrincipal, tariffVersionId: string): Promise<ResidencyQuote | ForbiddenResult | { kind: "disabled" }>;
  checkout(principal: ExpertPrincipal, tariffVersionId: string, idempotencyKey: string): Promise<unknown>;
  reconciliation: ExpertResidencyReconciliation;
}

export const createExpertResidencyService = (deps: {
  environmentEnabled: boolean;
  commands: ExpertResidencyCommands;
  queries: ExpertResidencyQueries;
  reconciliation: ExpertResidencyReconciliation;
}): ExpertResidencyService => {
  const owns = async (principal: ExpertPrincipal) =>
    principal.authenticated && (await deps.queries.ownerUserId(principal.expertId)) === principal.userId;
  return {
    async quote(principal, tariffVersionId) {
      if (!(await owns(principal))) return { kind: "forbidden" };
      if (!deps.environmentEnabled) return { kind: "disabled" };
      return deps.commands.quote({ expertId: principal.expertId, tariffVersionId });
    },
    async checkout(principal, tariffVersionId, idempotencyKey) {
      if (!(await owns(principal))) return { kind: "forbidden" };
      if (!deps.environmentEnabled) return { kind: "disabled" };
      return deps.commands.checkout({ expertId: principal.expertId, tariffVersionId, idempotencyKey });
    },
    reconciliation: deps.reconciliation,
  };
};
