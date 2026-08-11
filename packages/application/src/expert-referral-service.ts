export interface ExpertPrincipal {
  authenticated: boolean;
  userId: string;
  expertId: string;
}

export type ForbiddenResult = { kind: "forbidden" };
export type RedeemResult =
  | ForbiddenResult
  | { kind: "redeemed"; referralId: string }
  | { kind: "disabled" };
export interface ReferralSummary {
  availableMinor: string;
  reservedMinor: string;
  debtMinor: string;
  nearestExpiry: string | null;
}

export interface ExpertReferralCommands {
  redeem(input: {
    principal: ExpertPrincipal;
    code: string;
    idempotencyKey: string;
  }): Promise<RedeemResult>;
}
export interface ExpertReferralQueries {
  ownerUserId(expertId: string): Promise<string | undefined>;
  summary(expertId: string): Promise<ReferralSummary>;
}
export interface ExpertReferralService {
  redeemCode(
    principal: ExpertPrincipal,
    code: string,
    idempotencyKey: string,
  ): Promise<RedeemResult>;
  summary(
    principal: ExpertPrincipal,
  ): Promise<ReferralSummary | ForbiddenResult>;
}

export const createExpertReferralService = (deps: {
  environmentEnabled: boolean;
  commands: ExpertReferralCommands;
  queries: ExpertReferralQueries;
}): ExpertReferralService => {
  const owns = async (principal: ExpertPrincipal) =>
    principal.authenticated &&
    (await deps.queries.ownerUserId(principal.expertId)) === principal.userId;
  return {
    async redeemCode(principal, code, idempotencyKey) {
      if (!(await owns(principal))) return { kind: "forbidden" };
      if (!deps.environmentEnabled) return { kind: "disabled" };
      return deps.commands.redeem({ principal, code, idempotencyKey });
    },
    async summary(principal) {
      if (!(await owns(principal))) return { kind: "forbidden" };
      return deps.queries.summary(principal.expertId);
    },
  };
};
