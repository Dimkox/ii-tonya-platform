import { z } from "zod";
import { expertResidencyCheckoutCommandSchema } from "@ii-tonya/contracts";

const sandboxPaymentIdSchema = z
  .string()
  .regex(/^sandbox_payment_[A-Za-z0-9_-]{22,128}$/u);
const sandboxEventIdSchema = z
  .string()
  .regex(/^sandbox_event_[A-Za-z0-9_-]{22,128}$/u);
const boundedIdentifierSchema = z
  .string()
  .min(1)
  .max(200)
  .regex(/^[A-Za-z0-9_.:-]+$/u);
const positiveAmountMinorSchema = z.string().regex(/^[1-9][0-9]{0,11}$/u);
const utcInstantSchema = z.string().datetime({ offset: true });

export type SandboxPaymentState = "created" | "settled" | "refunded";

export interface CreateSandboxCheckoutCommand {
  orderId: string;
  amountMinor: string;
  currency: "RUB";
  idempotencyKey: string;
}

export const createSandboxCheckoutCommandSchema =
  expertResidencyCheckoutCommandSchema
    .extend({ amountMinor: positiveAmountMinorSchema })
    .strict();

export interface SandboxCheckout {
  kind: "created";
  paymentId: string;
  checkoutUrl: string;
  state: SandboxPaymentState;
  version: number;
}

export const sandboxCheckoutSchema = z
  .object({
    kind: z.literal("created"),
    paymentId: sandboxPaymentIdSchema,
    checkoutUrl: z
      .string()
      .url()
      .refine((value) => {
        const protocol = new URL(value).protocol;
        return protocol === "http:" || protocol === "https:";
      }),
    state: z.enum(["created", "settled", "refunded"]),
    version: z.number().int().min(0).max(2_147_483_646),
  })
  .strict();

export interface TransitionSandboxPaymentCommand {
  paymentId: string;
  transition: "settled" | "refunded";
  expectedVersion: number;
  idempotencyKey: string;
  correlationId: string;
}

export const transitionSandboxPaymentCommandSchema = z
  .object({
    paymentId: sandboxPaymentIdSchema,
    transition: z.enum(["settled", "refunded"]),
    expectedVersion: z.number().int().min(0).max(2_147_483_646),
    idempotencyKey: boundedIdentifierSchema,
    correlationId: boundedIdentifierSchema,
  })
  .strict();

export interface SandboxProviderEvent {
  provider: "ii_tonya_sandbox";
  eventId: string;
  kind: "settled" | "refunded";
  paymentId: string;
  orderId: string;
  amountMinor: string;
  currency: "RUB";
  occurredAt: string;
  payloadDigest: string;
  correlationId: string;
  state: SandboxPaymentState;
  version: number;
}

export const sandboxProviderEventSchema = z
  .object({
    provider: z.literal("ii_tonya_sandbox"),
    eventId: sandboxEventIdSchema,
    kind: z.enum(["settled", "refunded"]),
    paymentId: sandboxPaymentIdSchema,
    orderId: z.string().uuid(),
    amountMinor: positiveAmountMinorSchema,
    currency: z.literal("RUB"),
    occurredAt: utcInstantSchema,
    payloadDigest: z.string().regex(/^sha256:[0-9a-f]{64}$/u),
    correlationId: boundedIdentifierSchema,
    state: z.enum(["settled", "refunded"]),
    version: z.number().int().positive().max(2_147_483_647),
  })
  .strict();

export class SandboxPaymentConflictError extends Error {
  readonly code = "SANDBOX_PAYMENT_CONFLICT";

  constructor(message = "Sandbox payment command conflicts with stored state") {
    super(message);
    this.name = "SandboxPaymentConflictError";
  }
}
