import type {
  ExpertResidencyCheckoutCommand,
  ExpertResidencyCheckoutOutcome,
} from "@ii-tonya/contracts";
import type { VerifiedExpertResidencyPaymentEvent } from "./verified-event.js";
export interface ExpertResidencyRefundCommand {
  readonly orderId: string;
  readonly paymentId: string;
  readonly amountMinor: string;
  readonly currency: "RUB";
  readonly idempotencyKey: string;
}
export interface ExpertResidencyPaymentPort {
  createCheckout(
    command: ExpertResidencyCheckoutCommand,
  ): Promise<ExpertResidencyCheckoutOutcome>;
  refund(command: ExpertResidencyRefundCommand): Promise<{
    readonly kind: "pending";
    readonly refundId: string;
  }>;
  reconcile(
    paymentId: string,
  ): Promise<VerifiedExpertResidencyPaymentEvent | null>;
}
