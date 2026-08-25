import type {
  ExpertResidencyPaymentEvent,
  ExpertResidencyVerificationEvidence,
} from "@ii-tonya/contracts";
import type { VerifiedExpertResidencyPaymentEvent } from "@ii-tonya/integrations";
import { verifiedEventFixture as constructVerifiedEvent } from "./verified-event.js";

/** Test-only package-internal entrypoint; intentionally absent from package exports. */
export function verifiedEventFixture(
  event: ExpertResidencyPaymentEvent,
  evidence: ExpertResidencyVerificationEvidence,
): VerifiedExpertResidencyPaymentEvent {
  return constructVerifiedEvent(
    event,
    evidence,
  ) as unknown as VerifiedExpertResidencyPaymentEvent;
}
