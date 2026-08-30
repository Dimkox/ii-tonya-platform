export type PartnerParticipantKind = "EXPERT" | "CENTER" | "ORGANIZER";
export type PartnerTier = "STANDARD" | "REFERRED_6_9" | "REFERRED_10_PLUS";
export type ParticipantOnboardingState = "PENDING" | "ACTIVE" | "SUSPENDED" | "REJECTED";

export interface PartnerParticipantPrincipal {
  readonly participantId: string;
  readonly kind: PartnerParticipantKind;
  readonly onboardingState: ParticipantOnboardingState;
}

export interface PartnerPolicySnapshot {
  readonly policyVersionId: string;
  readonly policyVersion: number;
  readonly kind: "CENTER" | "ORGANIZER";
  readonly standardPriceMinor: number;
  readonly referredSixPriceMinor: number;
  readonly referredTenPriceMinor: number;
  readonly onlineOnlySurchargeMinor: 300_000;
  readonly cityMillionPlusSurchargeMinor: 500_000;
  readonly currency: "RUB";
  readonly durationSeconds: 2_592_000;
  readonly eventEntitlements: readonly { readonly capacity: number; readonly count: number }[];
  readonly residentCommissionBps: 1000;
  readonly nonresidentCommissionBps: 1500;
  readonly nonresidentCardFeeMinor: 450_000;
}

export interface PartnerShadowQuote {
  readonly policyVersionId: string;
  readonly policyVersion: number;
  readonly kind: "CENTER" | "ORGANIZER";
  readonly qualifiedExpertCount: number;
  readonly tier: PartnerTier;
  readonly basePriceMinor: number;
  readonly onlineOnlySurchargeMinor: number;
  readonly cityMillionPlusSurchargeMinor: number;
  readonly finalPriceMinor: number;
  readonly currency: "RUB";
  readonly durationSeconds: 2_592_000;
  readonly eventEntitlements: readonly { readonly capacity: number; readonly count: number }[];
  readonly residentCommissionBps: 1000;
  readonly nonresidentCommissionBps: 1500;
  readonly nonresidentCardFeeMinor: 450_000;
}

type QuoteInput = {
  readonly kind: PartnerParticipantKind;
  readonly qualifiedExpertCount: number;
  readonly onlineOnly: boolean;
  readonly cityMillionPlus: boolean;
  readonly policy: PartnerPolicySnapshot;
};

const invalid = (): never => { throw new Error("partner_pricing_invalid"); };

export function calculatePartnerShadowQuote(input: QuoteInput): PartnerShadowQuote {
  const { policy } = input;
  if (input.kind !== "CENTER" && input.kind !== "ORGANIZER") invalid();
  const kind = input.kind as "CENTER" | "ORGANIZER";
  if (!Number.isSafeInteger(input.qualifiedExpertCount) || input.qualifiedExpertCount < 0) invalid();
  if (policy.kind !== kind || policy.currency !== "RUB" || policy.durationSeconds !== 2_592_000) invalid();
  if (policy.onlineOnlySurchargeMinor !== 300_000 || policy.cityMillionPlusSurchargeMinor !== 500_000) invalid();
  if (policy.residentCommissionBps !== 1000 || policy.nonresidentCommissionBps !== 1500 || policy.nonresidentCardFeeMinor !== 450_000) invalid();
  if (policy.referredTenPriceMinor > policy.referredSixPriceMinor || policy.referredSixPriceMinor > policy.standardPriceMinor) invalid();
  for (const entitlement of policy.eventEntitlements) {
    if (!Number.isSafeInteger(entitlement.capacity) || !Number.isSafeInteger(entitlement.count) || entitlement.capacity < 0 || entitlement.count < 0) invalid();
  }
  const tier: PartnerTier = input.qualifiedExpertCount >= 10 ? "REFERRED_10_PLUS" : input.qualifiedExpertCount >= 6 ? "REFERRED_6_9" : "STANDARD";
  const basePriceMinor = tier === "REFERRED_10_PLUS" ? policy.referredTenPriceMinor : tier === "REFERRED_6_9" ? policy.referredSixPriceMinor : policy.standardPriceMinor;
  const onlineOnlySurchargeMinor = input.onlineOnly ? policy.onlineOnlySurchargeMinor : 0;
  const cityMillionPlusSurchargeMinor = input.cityMillionPlus ? policy.cityMillionPlusSurchargeMinor : 0;
  const finalPriceMinor = basePriceMinor + onlineOnlySurchargeMinor + cityMillionPlusSurchargeMinor;
  if (![basePriceMinor, onlineOnlySurchargeMinor, cityMillionPlusSurchargeMinor, finalPriceMinor].every(Number.isSafeInteger)) invalid();
  return Object.freeze({ policyVersionId: policy.policyVersionId, policyVersion: policy.policyVersion, kind, qualifiedExpertCount: input.qualifiedExpertCount, tier, basePriceMinor, onlineOnlySurchargeMinor, cityMillionPlusSurchargeMinor, finalPriceMinor, currency: policy.currency, durationSeconds: policy.durationSeconds, eventEntitlements: policy.eventEntitlements, residentCommissionBps: policy.residentCommissionBps, nonresidentCommissionBps: policy.nonresidentCommissionBps, nonresidentCardFeeMinor: policy.nonresidentCardFeeMinor });
}
