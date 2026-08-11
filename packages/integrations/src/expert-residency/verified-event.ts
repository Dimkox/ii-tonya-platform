import {
  expertResidencyPaymentEventSchema,
  type ExpertResidencyPaymentEvent,
} from "@ii-tonya/contracts";
declare const verifiedEventBrand: unique symbol;
const verifiedEvents = new WeakSet<object>();
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
function brand(
  event: ExpertResidencyPaymentEvent,
  evidence: ExpertResidencyVerificationEvidence,
): VerifiedExpertResidencyPaymentEvent {
  const canonicalEvent = expertResidencyPaymentEventSchema.parse(event);
  if (
    !/^[A-Za-z0-9_.:-]{1,200}$/u.test(evidence.verificationId) ||
    !/^[A-Za-z0-9_.:-]{1,100}$/u.test(evidence.verifierKeyVersion)
  )
    throw new Error("invalid_verification_evidence");
  const verifiedAt = new Date(evidence.verifiedAt);
  if (
    !Number.isFinite(verifiedAt.getTime()) ||
    verifiedAt.toISOString() !== evidence.verifiedAt
  )
    throw new Error("invalid_verification_evidence");
  const value = Object.freeze({
    ...canonicalEvent,
    ...evidence,
  }) as VerifiedExpertResidencyPaymentEvent;
  verifiedEvents.add(value);
  return value;
}
/** Test-only deterministic constructor; production code must use a verifier. */
export function verifiedEventFixture(
  event: ExpertResidencyPaymentEvent,
  evidence: ExpertResidencyVerificationEvidence,
): VerifiedExpertResidencyPaymentEvent {
  return brand(event, evidence);
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
  if (typeof value !== "object" || value === null || !verifiedEvents.has(value))
    throw new Error("verified_event_required");
}
