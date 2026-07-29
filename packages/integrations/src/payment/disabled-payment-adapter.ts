import type {
  CreateCheckoutCommand,
  PaymentPort,
  PaymentWebhookCommand,
  RefundCommand,
} from "./payment-port.js";

export class PaymentsDisabledError extends Error {
  readonly code = "PAYMENTS_DISABLED" as const;

  constructor() {
    super(
      "Live payments are disabled until a provider and commercial policy are approved",
    );
    this.name = "PaymentsDisabledError";
  }
}

export class DisabledPaymentAdapter implements PaymentPort {
  async createCheckout(command: CreateCheckoutCommand): Promise<never> {
    void command;
    throw new PaymentsDisabledError();
  }

  async acceptWebhook(command: PaymentWebhookCommand): Promise<never> {
    void command;
    throw new PaymentsDisabledError();
  }

  async refund(command: RefundCommand): Promise<never> {
    void command;
    throw new PaymentsDisabledError();
  }
}
