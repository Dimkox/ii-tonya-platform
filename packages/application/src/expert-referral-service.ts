import { safelyRecordExpertReferralLifecycle } from "@ii-tonya/observability";

export interface ExpertPrincipal {
  readonly expertId: string;
  readonly userId: string;
  readonly provider: string;
  readonly externalId: string;
}

export interface ReferralSummary {
  readonly expertId: string;
  readonly spendableBalanceMinor: string;
  readonly reservedBalanceMinor: string;
  readonly debtMinor: string;
  readonly nearestExpiryAt: Date | null;
}

export interface ExpertIdentityAuthorizationPort {
  authorize(principal: ExpertPrincipal): Promise<ExpertPrincipal | null>;
}

export interface ExpertReferralControlPort {
  readForCommand(): Promise<{
    readonly version: number;
    readonly newCommandsEnabled: boolean;
  }>;
}

export interface ExpertReferralCommandPort {
  redeem(command: {
    readonly plaintext: string;
    readonly inviteeExpertId: string;
    readonly provider: string;
    readonly externalId: string;
    readonly idempotencyKey: string;
  }): Promise<{ readonly referralId: string }>;
}

export interface ExpertReferralQueryPort {
  summary(expertId: string): Promise<ReferralSummary>;
}

export interface ExpertReferralDependencies {
  readonly referralEnabled: boolean;
  readonly identity: ExpertIdentityAuthorizationPort;
  readonly controls: ExpertReferralControlPort;
  readonly commands: ExpertReferralCommandPort;
  readonly queries: ExpertReferralQueryPort;
}

export type ExpertCommandDenied =
  { readonly kind: "disabled" } | { readonly kind: "forbidden" };

export type RedeemResult =
  | ExpertCommandDenied
  | { readonly kind: "redeemed"; readonly referralId: string };

export type ReferralSummaryResult =
  { readonly kind: "forbidden" } | ReferralSummary;

export interface ExpertReferralService {
  redeemCode(
    principal: ExpertPrincipal,
    code: string,
    idempotencyKey: string,
  ): Promise<RedeemResult>;
  summary(principal: ExpertPrincipal): Promise<ReferralSummaryResult>;
}

const sameIdentity = (
  requested: ExpertPrincipal,
  resolved: ExpertPrincipal,
): boolean =>
  requested.expertId === resolved.expertId &&
  requested.userId === resolved.userId &&
  requested.provider === resolved.provider &&
  requested.externalId === resolved.externalId;

export const authorizeExpert = async (
  identity: ExpertIdentityAuthorizationPort,
  principal: ExpertPrincipal,
): Promise<ExpertPrincipal | null> => {
  const resolved = await identity.authorize(principal);
  return resolved !== null && sameIdentity(principal, resolved)
    ? resolved
    : null;
};

export const createExpertReferralService = (
  dependencies: ExpertReferralDependencies,
): ExpertReferralService => ({
  async redeemCode(principal, code, idempotencyKey) {
    try {
      const identity = await authorizeExpert(dependencies.identity, principal);
      if (!dependencies.referralEnabled) {
        safelyRecordExpertReferralLifecycle({
          module: "expert_referral",
          operation: "redemption",
          outcome: "rejected",
          errorCode: "invalid_state",
        });
        return { kind: "disabled" };
      }
      if (identity === null) {
        safelyRecordExpertReferralLifecycle({
          module: "expert_referral",
          operation: "redemption",
          outcome: "rejected",
          errorCode: "invalid_state",
        });
        return { kind: "forbidden" };
      }
      const control = await dependencies.controls.readForCommand();
      if (!control.newCommandsEnabled) {
        safelyRecordExpertReferralLifecycle({
          module: "expert_referral",
          operation: "redemption",
          outcome: "rejected",
          errorCode: "invalid_state",
        });
        return { kind: "disabled" };
      }
      const redeemed = await dependencies.commands.redeem({
        plaintext: code,
        inviteeExpertId: identity.expertId,
        provider: identity.provider,
        externalId: identity.externalId,
        idempotencyKey,
      });
      safelyRecordExpertReferralLifecycle({
        module: "expert_referral",
        operation: "redemption",
        outcome: "redeemed",
        errorCode: "none",
      });
      safelyRecordExpertReferralLifecycle({
        module: "expert_referral",
        operation: "code_lifecycle",
        outcome: "redeemed",
        errorCode: "none",
      });
      return { kind: "redeemed", referralId: redeemed.referralId };
    } catch (error) {
      safelyRecordExpertReferralLifecycle({
        module: "expert_referral",
        operation: "redemption",
        outcome: "failed",
        errorCode: "unknown",
      });
      throw error;
    }
  },

  async summary(principal) {
    const identity = await authorizeExpert(dependencies.identity, principal);
    if (identity === null) return { kind: "forbidden" };
    const summary = await dependencies.queries.summary(identity.expertId);
    if (summary.expertId !== identity.expertId) {
      throw new Error("expert_referral_summary_ownership_mismatch");
    }
    return summary;
  },
});
