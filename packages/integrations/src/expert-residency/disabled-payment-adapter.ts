import type {
  ExpertResidencyCheckoutCommand,
  ExpertResidencyCheckoutOutcome,
} from "@ii-tonya/contracts";
import type { ExpertResidencyPaymentPort } from "./payment-port.js";
import type { VerifiedExpertResidencyPaymentEvent } from "./verified-event.js";

export class DisabledExpertResidencyPaymentAdapter implements ExpertResidencyPaymentPort {
  async createCheckout(
    command: ExpertResidencyCheckoutCommand,
  ): Promise<ExpertResidencyCheckoutOutcome> {
    void command;
    throw new Error("expert_residency_payments_disabled");
  }

  async reconcile(
    paymentId: string,
  ): Promise<VerifiedExpertResidencyPaymentEvent | null> {
    void paymentId;
    return null;
  }
}
