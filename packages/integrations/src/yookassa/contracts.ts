import { z } from "zod";

export type YooKassaMode = "test" | "live";
export type YooKassaVatCode = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12;

const providerId = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[A-Za-z0-9_-]+$/u);
const amount = z
  .object({
    value: z.string().regex(/^(?:0|[1-9]\d*)\.\d{2}$/u),
    currency: z.literal("RUB"),
  })
  .passthrough();
const metadata = z.record(z.string().min(1).max(64), z.string().max(128));
const confirmation = z
  .object({
    type: z.literal("redirect"),
    confirmation_url: z.string().url().max(2_048),
  })
  .passthrough();

export const yooKassaPaymentSchema = z
  .object({
    id: providerId,
    status: z.enum(["pending", "waiting_for_capture", "succeeded", "canceled"]),
    paid: z.boolean(),
    amount,
    test: z.boolean(),
    created_at: z.iso.datetime({ offset: true }),
    captured_at: z.iso.datetime({ offset: true }).optional(),
    metadata,
    confirmation: confirmation.optional(),
    refundable: z.boolean(),
  })
  .passthrough()
  .transform((value) => ({
    id: value.id,
    status: value.status,
    paid: value.paid,
    amount: { value: value.amount.value, currency: value.amount.currency },
    test: value.test,
    createdAt: value.created_at,
    ...(value.captured_at === undefined
      ? {}
      : { capturedAt: value.captured_at }),
    metadata: value.metadata,
    ...(value.confirmation === undefined
      ? {}
      : {
          confirmation: {
            type: value.confirmation.type,
            url: value.confirmation.confirmation_url,
          },
        }),
    refundable: value.refundable,
  }));

export const yooKassaRefundSchema = z
  .object({
    id: providerId,
    payment_id: providerId,
    status: z.enum(["pending", "succeeded", "canceled"]),
    amount,
    created_at: z.iso.datetime({ offset: true }),
  })
  .passthrough()
  .transform((value) => ({
    id: value.id,
    paymentId: value.payment_id,
    status: value.status,
    amount: { value: value.amount.value, currency: value.amount.currency },
    createdAt: value.created_at,
  }));

export const yooKassaNotificationSchema = z
  .object({
    type: z.literal("notification"),
    event: z.enum([
      "payment.waiting_for_capture",
      "payment.succeeded",
      "payment.canceled",
      "refund.succeeded",
    ]),
    object: z
      .object({ id: providerId })
      .passthrough()
      .transform(({ id }) => ({ id })),
  })
  .strict();

export type YooKassaPayment = z.output<typeof yooKassaPaymentSchema>;
export type YooKassaRefund = z.output<typeof yooKassaRefundSchema>;
export type YooKassaNotification = z.output<typeof yooKassaNotificationSchema>;

export interface YooKassaReceiptCustomer {
  readonly email?: string;
  readonly phone?: string;
}

export interface YooKassaReceiptItem {
  readonly description: string;
  readonly vatCode: YooKassaVatCode;
  readonly paymentSubject: string;
  readonly paymentMode: string;
}

export interface YooKassaReceiptInput {
  readonly customer: YooKassaReceiptCustomer;
  readonly item: YooKassaReceiptItem;
}
