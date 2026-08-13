import type { ExpertResidencyPaymentEvent } from "@ii-tonya/contracts";
import type {
  CanonicalExpertResidencyPaymentEventVerifier,
  VerifiedExpertResidencyPaymentEvent,
} from "@ii-tonya/integrations";
import type { SandboxProviderEvent } from "./contracts.js";
import { isRepositoryOwnedSandboxEvent } from "./repository.js";

export const SANDBOX_PROVIDER = "ii_tonya_sandbox" as const;

export interface SandboxEventVerifier {
  verify(event: SandboxProviderEvent): VerifiedExpertResidencyPaymentEvent;
}

export function createSandboxEventVerifier(
  canonicalVerifier: CanonicalExpertResidencyPaymentEventVerifier,
): SandboxEventVerifier {
  return Object.freeze({
    verify(event: SandboxProviderEvent): VerifiedExpertResidencyPaymentEvent {
      if (!isRepositoryOwnedSandboxEvent(event)) {
        throw new Error("sandbox_repository_event_required");
      }
      const canonicalEvent: ExpertResidencyPaymentEvent = {
        kind: event.kind,
        provider: SANDBOX_PROVIDER,
        eventId: event.eventId,
        paymentId: event.paymentId,
        orderId: event.orderId,
        amountMinor: event.amountMinor,
        currency: event.currency,
        occurredAt: event.occurredAt,
        payloadDigest: event.payloadDigest,
      };
      return canonicalVerifier.verifyCanonical(canonicalEvent, {
        verificationId: `event:${event.eventId}`,
        verifierKeyVersion: "ii_tonya_sandbox:v1",
        verifiedAt: event.occurredAt,
      });
    },
  });
}
