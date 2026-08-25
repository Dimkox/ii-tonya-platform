import { z } from "zod";

const boundedIdentifier = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u);
const canonicalMinorUnits = z.string().regex(/^(?:0|[1-9][0-9]*)$/u);
const utcTimestamp = z.iso.datetime({ offset: false });
const payloadDigest = z.string().regex(/^sha256:[0-9a-f]{64}$/u);

export const expertResidencyPaymentEventSchema = z
  .object({
    kind: z.literal("settled"),
    provider: boundedIdentifier.max(64),
    eventId: boundedIdentifier,
    paymentId: boundedIdentifier,
    orderId: z.uuid(),
    amountMinor: canonicalMinorUnits,
    currency: z.string().regex(/^[A-Z]{3}$/u),
    occurredAt: utcTimestamp,
    payloadDigest,
  })
  .strict();

export const expertResidencyCheckoutCommandSchema = z
  .object({
    orderId: z.uuid(),
    idempotencyKey: boundedIdentifier,
    amountMinor: canonicalMinorUnits,
    currency: z.literal("RUB"),
    expiresAt: utcTimestamp,
  })
  .strict();

export const expertResidencyVerificationEvidenceSchema = z
  .object({
    verificationId: boundedIdentifier,
    verifierKeyVersion: boundedIdentifier,
    verifiedAt: utcTimestamp,
    payloadDigest,
  })
  .strict();

export type ExpertResidencyPaymentEvent = z.infer<
  typeof expertResidencyPaymentEventSchema
>;
export type ExpertResidencyCheckoutCommand = z.infer<
  typeof expertResidencyCheckoutCommandSchema
>;
export type ExpertResidencyVerificationEvidence = z.infer<
  typeof expertResidencyVerificationEvidenceSchema
>;

export type ExpertResidencyCheckoutOutcome =
  | Readonly<{
      kind: "created";
      provider: string;
      paymentId: string;
      checkoutUrl: string;
      expiresAt: string;
    }>
  | Readonly<{
      kind: "pending_reconciliation";
      provider: string;
      paymentId: string;
    }>;
