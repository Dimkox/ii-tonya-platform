export interface CreateCheckoutCommand {
  readonly userId: string;
  readonly packageCode: string;
  readonly idempotencyKey: string;
}

export interface PaymentWebhookCommand {
  readonly rawBody: Uint8Array;
  readonly headers: Readonly<
    Record<string, string | readonly string[] | undefined>
  >;
}

export interface RefundCommand {
  readonly externalPaymentId: string;
  readonly idempotencyKey: string;
}

export interface PaymentPort {
  createCheckout(command: CreateCheckoutCommand): Promise<never>;
  acceptWebhook(command: PaymentWebhookCommand): Promise<never>;
  refund(command: RefundCommand): Promise<never>;
}
