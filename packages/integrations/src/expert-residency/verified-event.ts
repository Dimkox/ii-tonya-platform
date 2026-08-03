import type { ExpertResidencyPaymentEvent } from "@ii-tonya/contracts";
const verifiedEventBrand: unique symbol = Symbol.for(
  "ii-tonya.verified-expert-residency-payment-event",
);
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
  return Object.freeze({
    ...event,
    ...evidence,
    [verifiedEventBrand]: true as const,
  });
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
  if (
    typeof value !== "object" ||
    value === null ||
    (value as Record<PropertyKey, unknown>)[verifiedEventBrand] !== true
  )
    throw new Error("verified_event_required");
}
