import type {
  ExpertPrincipal,
  ExpertReferralDependencies,
  ReferralSummary,
} from "./expert-referral-service.js";

export interface ExpertReferralFixture extends ExpertReferralDependencies {
  readonly owner: ExpertPrincipal;
  readonly other: ExpertPrincipal;
  readonly code: string;
  readonly idempotencyKey: string;
  setAuthorized(expertId: string, authorized: boolean): void;
  setNewCommandsEnabled(enabled: boolean): void;
  redemptionCount(): number;
  authorizationCount(expertId: string): number;
  controlReadCount(): number;
}

export const expertReferralFixture = (
  options: { readonly referralEnabled?: boolean } = {},
): ExpertReferralFixture => {
  const owner: ExpertPrincipal = {
    expertId: "00000000-0000-4000-8000-000000000801",
    userId: "00000000-0000-4000-8000-000000000802",
    provider: "telegram",
    externalId: "801",
  };
  const other: ExpertPrincipal = {
    expertId: "00000000-0000-4000-8000-000000000803",
    userId: "00000000-0000-4000-8000-000000000804",
    provider: "telegram",
    externalId: "803",
  };
  const authorization = new Map([
    [owner.expertId, true],
    [other.expertId, false],
  ]);
  const authorizationReads = new Map<string, number>();
  const redemptions: string[] = [];
  let newCommandsEnabled = true;
  let controlReads = 0;
  const summary: ReferralSummary = {
    expertId: owner.expertId,
    spendableBalanceMinor: "100000",
    reservedBalanceMinor: "0",
    debtMinor: "0",
    nearestExpiryAt: new Date("2027-08-03T00:00:00.000Z"),
  };

  return {
    owner,
    other,
    code: "EXR_AAAAAAAAAAAAAAAAAAAAAA",
    idempotencyKey: "referral_redeem_801",
    referralEnabled: options.referralEnabled ?? true,
    identity: {
      async authorize(principal) {
        authorizationReads.set(
          principal.expertId,
          (authorizationReads.get(principal.expertId) ?? 0) + 1,
        );
        return authorization.get(principal.expertId) === true
          ? { ...principal }
          : null;
      },
    },
    controls: {
      async readForCommand() {
        controlReads += 1;
        return {
          version: controlReads,
          newCommandsEnabled,
        };
      },
    },
    commands: {
      async redeem(command) {
        redemptions.push(command.idempotencyKey);
        return { referralId: "00000000-0000-4000-8000-000000000805" };
      },
    },
    queries: {
      async summary(expertId) {
        if (expertId !== owner.expertId) throw new Error("cross_expert_read");
        return summary;
      },
    },
    setAuthorized(expertId, authorized) {
      authorization.set(expertId, authorized);
    },
    setNewCommandsEnabled(enabled) {
      newCommandsEnabled = enabled;
    },
    redemptionCount: () => redemptions.length,
    authorizationCount: (expertId) => authorizationReads.get(expertId) ?? 0,
    controlReadCount: () => controlReads,
  };
};
