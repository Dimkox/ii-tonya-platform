import type {
  ExpertResidencyCheckoutCommand,
  ExpertResidencyCheckoutOutcome,
} from "@ii-tonya/contracts";
import type { VerifiedExpertResidencyPaymentEvent } from "./verified-event.js";

export interface ExpertResidencyPaymentPort {
  createCheckout(
    command: ExpertResidencyCheckoutCommand,
  ): Promise<ExpertResidencyCheckoutOutcome>;
  reconcile(
    paymentId: string,
  ): Promise<VerifiedExpertResidencyPaymentEvent | null>;
}

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
