export type PartnerParticipantKind = "EXPERT" | "CENTER" | "ORGANIZER";
export type PartnerTier = "STANDARD" | "REFERRED_6_9" | "REFERRED_10_PLUS";
export type ParticipantOnboardingState = "started" | "kind_selected" | "profile_incomplete" | "profile_ready" | "offer_available";

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
  if (input === null || typeof input !== "object") invalid();
  const { policy } = input;
  if (input.kind !== "CENTER" && input.kind !== "ORGANIZER") invalid();
  const kind = input.kind as "CENTER" | "ORGANIZER";
  if (!Number.isSafeInteger(input.qualifiedExpertCount) || input.qualifiedExpertCount < 0) invalid();
  if (typeof input.onlineOnly !== "boolean" || typeof input.cityMillionPlus !== "boolean") invalid();
  if (policy === null || typeof policy !== "object" || Array.isArray(policy)) invalid();
  if (typeof policy.policyVersionId !== "string" || policy.policyVersionId.length === 0 || policy.policyVersionId.length > 128) invalid();
  if (!Number.isSafeInteger(policy.policyVersion) || policy.policyVersion <= 0) invalid();
  if (policy.kind !== kind || policy.currency !== "RUB" || policy.durationSeconds !== 2_592_000) invalid();
  if (![policy.standardPriceMinor, policy.referredSixPriceMinor, policy.referredTenPriceMinor].every((value) => Number.isSafeInteger(value) && value > 0)) invalid();
  if (policy.onlineOnlySurchargeMinor !== 300_000 || policy.cityMillionPlusSurchargeMinor !== 500_000) invalid();
  if (policy.residentCommissionBps !== 1000 || policy.nonresidentCommissionBps !== 1500 || policy.nonresidentCardFeeMinor !== 450_000) invalid();
  if (policy.referredTenPriceMinor > policy.referredSixPriceMinor || policy.referredSixPriceMinor > policy.standardPriceMinor) invalid();
  const expectedEntitlements = kind === "CENTER" ? [{ capacity: 30, count: 10 }] : [{ capacity: 50, count: 5 }, { capacity: 100, count: 3 }, { capacity: 500, count: 1 }];
  if (!Array.isArray(policy.eventEntitlements) || policy.eventEntitlements.length !== expectedEntitlements.length) invalid();
  for (const [index, entitlement] of policy.eventEntitlements.entries()) {
    if (entitlement === null || typeof entitlement !== "object" || Array.isArray(entitlement) || Object.keys(entitlement).sort().join() !== "capacity,count" || !Number.isSafeInteger(entitlement.capacity) || !Number.isSafeInteger(entitlement.count) || entitlement.capacity <= 0 || entitlement.count <= 0 || entitlement.capacity !== expectedEntitlements[index]?.capacity || entitlement.count !== expectedEntitlements[index]?.count) invalid();
  }
  const tier: PartnerTier = input.qualifiedExpertCount >= 10 ? "REFERRED_10_PLUS" : input.qualifiedExpertCount >= 6 ? "REFERRED_6_9" : "STANDARD";
  const basePriceMinor = tier === "REFERRED_10_PLUS" ? policy.referredTenPriceMinor : tier === "REFERRED_6_9" ? policy.referredSixPriceMinor : policy.standardPriceMinor;
  const onlineOnlySurchargeMinor = input.onlineOnly ? policy.onlineOnlySurchargeMinor : 0;
  const cityMillionPlusSurchargeMinor = input.cityMillionPlus ? policy.cityMillionPlusSurchargeMinor : 0;
  const finalPriceMinor = basePriceMinor + onlineOnlySurchargeMinor + cityMillionPlusSurchargeMinor;
  if (![basePriceMinor, onlineOnlySurchargeMinor, cityMillionPlusSurchargeMinor, finalPriceMinor].every(Number.isSafeInteger)) invalid();
  const copiedEntitlements = Object.freeze(policy.eventEntitlements.map((entry) => Object.freeze({ capacity: entry.capacity, count: entry.count })));
  return Object.freeze({ policyVersionId: policy.policyVersionId, policyVersion: policy.policyVersion, kind, qualifiedExpertCount: input.qualifiedExpertCount, tier, basePriceMinor, onlineOnlySurchargeMinor, cityMillionPlusSurchargeMinor, finalPriceMinor, currency: policy.currency, durationSeconds: policy.durationSeconds, eventEntitlements: copiedEntitlements, residentCommissionBps: policy.residentCommissionBps, nonresidentCommissionBps: policy.nonresidentCommissionBps, nonresidentCardFeeMinor: policy.nonresidentCardFeeMinor });
}
