import {
  expertResidencyPaymentEventSchema,
  type ExpertResidencyPaymentEvent,
} from "@ii-tonya/contracts";
import type {
  ExpertResidencyVerificationEvidence,
  VerifiedExpertResidencyPaymentEvent,
} from "./verified-event.js";
const verifiedEvents = new WeakSet<object>();
function canonicalEvidence(
  evidence: ExpertResidencyVerificationEvidence,
): ExpertResidencyVerificationEvidence {
  if (
    typeof evidence !== "object" ||
    evidence === null ||
    Object.keys(evidence).length !== 3 ||
    !Object.hasOwn(evidence, "verificationId") ||
    !Object.hasOwn(evidence, "verifierKeyVersion") ||
    !Object.hasOwn(evidence, "verifiedAt") ||
    !/^[A-Za-z0-9_.:-]{1,200}$/u.test(evidence.verificationId) ||
    !/^[A-Za-z0-9_.:-]{1,100}$/u.test(evidence.verifierKeyVersion)
  ) {
    throw new Error("invalid_verification_evidence");
  }
  const verifiedAt = new Date(evidence.verifiedAt);
  if (
    !Number.isFinite(verifiedAt.getTime()) ||
    verifiedAt.toISOString() !== evidence.verifiedAt
  ) {
    throw new Error("invalid_verification_evidence");
  }
  return {
    verificationId: evidence.verificationId,
    verifierKeyVersion: evidence.verifierKeyVersion,
    verifiedAt: evidence.verifiedAt,
  };
}

function brand(
  event: ExpertResidencyPaymentEvent,
  evidence: ExpertResidencyVerificationEvidence,
): VerifiedExpertResidencyPaymentEvent {
  const value = Object.freeze({
    ...event,
    ...evidence,
  }) as VerifiedExpertResidencyPaymentEvent;
  verifiedEvents.add(value);
  return value;
}

export function mintVerifiedExpertResidencyPaymentEvent(
  event: ExpertResidencyPaymentEvent,
  evidence: ExpertResidencyVerificationEvidence,
): VerifiedExpertResidencyPaymentEvent {
  return brand(
    expertResidencyPaymentEventSchema.parse(event),
    canonicalEvidence(evidence),
  );
}
export function isVerifiedExpertResidencyPaymentEvent(
  value: unknown,
): value is VerifiedExpertResidencyPaymentEvent {
  return (
    typeof value === "object" && value !== null && verifiedEvents.has(value)
  );
}
