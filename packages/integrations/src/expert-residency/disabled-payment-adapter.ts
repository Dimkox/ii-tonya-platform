import type { ExpertResidencyCheckoutCommand } from "@ii-tonya/contracts";
import type { ExpertResidencyPaymentPort } from "./payment-port.js";
export class DisabledExpertResidencyPaymentAdapter implements ExpertResidencyPaymentPort {
  async createCheckout(
    command: ExpertResidencyCheckoutCommand,
  ): Promise<never> {
    void command;
    throw new Error("expert_residency_payments_disabled");
  }
  async reconcile(paymentId: string): Promise<null> {
    void paymentId;
    return null;
  }
  async refund(): Promise<never> {
    throw new Error("expert_residency_payments_disabled");
  }
}
