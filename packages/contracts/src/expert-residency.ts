import { z } from "zod";

const identifier = z
  .string()
  .min(1)
  .max(200)
  .regex(/^[A-Za-z0-9_.:-]+$/u);
const utcInstant = z.string().datetime({ offset: true });
export const expertResidencyPaymentEventSchema = z
  .object({
    kind: z.enum(["settled", "refunded", "charged_back"]),
    provider: identifier,
    eventId: identifier,
    paymentId: identifier,
    orderId: z.string().uuid(),
    amountMinor: z.string().regex(/^(?:0|[1-9][0-9]{0,11})$/u),
    currency: z.literal("RUB"),
    occurredAt: utcInstant,
    payloadDigest: z.string().regex(/^sha256:[0-9a-f]{64}$/u),
  })
  .strict();
export type ExpertResidencyPaymentEvent = z.infer<
  typeof expertResidencyPaymentEventSchema
>;
export const expertResidencyCheckoutCommandSchema = z
  .object({
    orderId: z.string().uuid(),
    amountMinor: z.string().regex(/^(?:0|[1-9][0-9]{0,11})$/u),
    currency: z.literal("RUB"),
    idempotencyKey: identifier,
  })
  .strict();
export type ExpertResidencyCheckoutCommand = z.infer<
  typeof expertResidencyCheckoutCommandSchema
>;
export interface ExpertResidencyCheckoutOutcome {
  readonly kind: "created";
  readonly paymentId: string;
  readonly checkoutUrl: string;
}
