import { z } from "zod";

const boundedIdentifier = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u);
const POSTGRES_SIGNED_BIGINT_MAX = "9223372036854775807";
const canonicalPositiveMinorUnits = z
  .string()
  .max(19)
  .regex(/^[1-9][0-9]*$/u)
  .refine(
    (value) =>
      value.length < POSTGRES_SIGNED_BIGINT_MAX.length ||
      (value.length === POSTGRES_SIGNED_BIGINT_MAX.length &&
        value <= POSTGRES_SIGNED_BIGINT_MAX),
  );
const utcTimestamp = z
  .string()
  .regex(/^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$/u)
  .refine((value) => {
    const parsed = new Date(value);
    return Number.isFinite(parsed.getTime()) && parsed.toISOString() === value;
  });
const payloadDigest = z.string().regex(/^sha256:[0-9a-f]{64}$/u);

export const expertResidencyPaymentEventSchema = z
  .object({
    kind: z.literal("settled"),
    provider: boundedIdentifier.max(64),
    eventId: boundedIdentifier,
    paymentId: boundedIdentifier,
    orderId: z.uuid(),
    amountMinor: canonicalPositiveMinorUnits,
    currency: z.string().regex(/^[A-Z]{3}$/u),
    occurredAt: utcTimestamp,
    payloadDigest,
  })
  .strict();

export const expertResidencyCheckoutCommandSchema = z
  .object({
    orderId: z.uuid(),
    idempotencyKey: boundedIdentifier,
    amountMinor: canonicalPositiveMinorUnits,
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
