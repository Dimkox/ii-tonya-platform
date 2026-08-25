import type {
  ExpertResidencyPaymentEvent,
  ExpertResidencyVerificationEvidence,
} from "@ii-tonya/contracts";
import {
  expertResidencyPaymentEventSchema,
  expertResidencyVerificationEvidenceSchema,
} from "@ii-tonya/contracts";
import type { ExpertResidencyPaymentEventVerifier } from "./payment-port.js";

const verifiedEventBrand: unique symbol = Symbol(
  "VerifiedExpertResidencyPaymentEvent",
);
const verifiedEvents = new WeakSet<object>();

export type VerifiedExpertResidencyPaymentEvent = Readonly<
  ExpertResidencyPaymentEvent & {
    verification: ExpertResidencyVerificationEvidence;
    [verifiedEventBrand]: true;
  }
>;

export function isVerifiedExpertResidencyPaymentEvent(
  input: unknown,
): input is VerifiedExpertResidencyPaymentEvent {
  return (
    typeof input === "object" && input !== null && verifiedEvents.has(input)
  );
}

export function requireVerifiedExpertResidencyPaymentEvent(
  input: unknown,
): VerifiedExpertResidencyPaymentEvent {
  if (!isVerifiedExpertResidencyPaymentEvent(input)) {
    throw new Error("verified_event_required");
  }
  return input;
}

/** Test-only factory. This module is not a package export subpath. */
export function verifiedEventFixture(
  event: ExpertResidencyPaymentEvent,
  evidence: ExpertResidencyVerificationEvidence,
): VerifiedExpertResidencyPaymentEvent {
  const parsedEvent = expertResidencyPaymentEventSchema.parse(event);
  const parsedEvidence =
    expertResidencyVerificationEvidenceSchema.parse(evidence);
  if (parsedEvent.payloadDigest !== parsedEvidence.payloadDigest) {
    throw new Error("verification_digest_mismatch");
  }
  if (
    new Date(parsedEvidence.verifiedAt).getTime() <
    new Date(parsedEvent.occurredAt).getTime()
  ) {
    throw new Error("verification_precedes_event");
  }
  const verified = Object.freeze(
    Object.defineProperty(
      { ...parsedEvent, verification: Object.freeze(parsedEvidence) },
      verifiedEventBrand,
      { value: true, enumerable: false, configurable: false, writable: false },
    ),
  ) as VerifiedExpertResidencyPaymentEvent;
  verifiedEvents.add(verified);
  return verified;
}

export class DisabledExpertResidencyPaymentEventVerifier implements ExpertResidencyPaymentEventVerifier {
  async verify(
    input: Readonly<{
      rawBody: Uint8Array;
      headers: Readonly<Record<string, string>>;
    }>,
  ): Promise<{ kind: "rejected" }> {
    void input;
    return { kind: "rejected" };
  }
}
