import {
  mintVerifiedExpertResidencyPaymentEvent,
  isVerifiedExpertResidencyPaymentEvent,
} from "./verified-event-internal.js";
import { type ExpertResidencyPaymentEvent } from "@ii-tonya/contracts";
declare const verifiedEventBrand: unique symbol;

export interface ExpertResidencyVerificationEvidence {
  readonly verificationId: string;
  readonly verifierKeyVersion: string;
  readonly verifiedAt: string;
}
export type VerifiedExpertResidencyPaymentEvent = Readonly<
  ExpertResidencyPaymentEvent &
    ExpertResidencyVerificationEvidence & {
      readonly [verifiedEventBrand]: true;
    }
>;
export interface ExpertResidencyPaymentEventVerifier {
  verify(
    input: Readonly<{
      rawBody: Uint8Array;
      headers: Readonly<Record<string, string>>;
    }>,
  ): Promise<
    | { kind: "verified"; event: VerifiedExpertResidencyPaymentEvent }
    | { kind: "rejected" }
  >;
}
export interface CanonicalExpertResidencyPaymentEventVerifier {
  verifyCanonical(
    event: ExpertResidencyPaymentEvent,
    evidence: ExpertResidencyVerificationEvidence,
  ): VerifiedExpertResidencyPaymentEvent;
}

export function createCanonicalExpertResidencyPaymentEventVerifier(): CanonicalExpertResidencyPaymentEventVerifier {
  return Object.freeze({
    verifyCanonical(
      event: ExpertResidencyPaymentEvent,
      evidence: ExpertResidencyVerificationEvidence,
    ): VerifiedExpertResidencyPaymentEvent {
      return mintVerifiedExpertResidencyPaymentEvent(event, evidence);
    },
  });
}
/** Test-only deterministic constructor; production code must use a verifier. */
export function verifiedEventFixture(
  event: ExpertResidencyPaymentEvent,
  evidence: ExpertResidencyVerificationEvidence,
): VerifiedExpertResidencyPaymentEvent {
  return mintVerifiedExpertResidencyPaymentEvent(event, evidence);
}
export const disabledExpertResidencyPaymentEventVerifier: ExpertResidencyPaymentEventVerifier =
  {
    async verify() {
      return { kind: "rejected" };
    },
  };
export function assertVerifiedExpertResidencyPaymentEvent(
  value: unknown,
): asserts value is VerifiedExpertResidencyPaymentEvent {
  if (!isVerifiedExpertResidencyPaymentEvent(value))
    throw new Error("verified_event_required");
}
