import { createHash } from "node:crypto";
import { z } from "zod";
import type { YooKassaClient } from "./client.js";

export interface OnboardingPaymentBinding {
  readonly invoiceId: string;
  readonly applicationId: string;
  readonly userId: string;
  readonly operationId: string;
  readonly providerObjectId: string;
  readonly purpose: "onboarding";
  readonly amountMinor: "300000";
  readonly currency: "RUB";
  readonly mode: "test" | "live";
}
declare const verifiedOnboardingBrand: unique symbol;
export type VerifiedOnboardingPayment = Readonly<
  OnboardingPaymentBinding & {
    readonly provider: "yookassa";
    readonly capturedAt: string;
    readonly eventId: string;
    readonly evidenceDigest: string;
    readonly [verifiedOnboardingBrand]: true;
  }
>;
const verifiedProofs = new WeakSet<object>();
export function assertVerifiedOnboardingPayment(
  value: unknown,
): asserts value is VerifiedOnboardingPayment {
  if (!value || typeof value !== "object" || !verifiedProofs.has(value))
    throw new Error("onboarding_payment_proof_required");
}
const providerId = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/u);
const bindingSchema = z
  .object({
    invoiceId: z.uuid(),
    applicationId: z.uuid(),
    userId: z.uuid(),
    operationId: z.uuid(),
    providerObjectId: providerId,
    purpose: z.literal("onboarding"),
    amountMinor: z.literal("300000"),
    currency: z.literal("RUB"),
    mode: z.enum(["test", "live"]),
  })
  .strict();
// Validate the decoded client shape again so injected capabilities cannot bypass
// the authority boundary with malformed timestamps, amounts or untyped values.
const paymentSchema = z
  .object({
    id: providerId,
    status: z.enum(["pending", "waiting_for_capture", "succeeded", "canceled"]),
    paid: z.boolean(),
    amount: z
      .object({
        value: z.string().regex(/^(?:0|[1-9]\d*)\.\d{2}$/u),
        currency: z.literal("RUB"),
      })
      .strict(),
    test: z.boolean(),
    createdAt: z.iso.datetime({ offset: true }),
    capturedAt: z.iso.datetime({ offset: true }).optional(),
    metadata: z.record(z.string().min(1).max(64), z.string().max(128)),
  })
  .passthrough();
class BindingMismatch extends Error {
  constructor() {
    super("onboarding_payment_binding_mismatch");
  }
}
export class YooKassaOnboardingPaymentVerifier {
  constructor(
    private readonly client: Pick<YooKassaClient, "getPayment">,
    private readonly bindings: {
      findOnboardingPaymentBinding(
        invoiceId: string,
      ): Promise<OnboardingPaymentBinding | null>;
    },
  ) {}

  async verify(invoiceId: string): Promise<VerifiedOnboardingPayment | null> {
    try {
      if (!z.uuid().safeParse(invoiceId).success) throw new BindingMismatch();
      const stored =
        await this.bindings.findOnboardingPaymentBinding(invoiceId);
      if (stored === null) return null;
      const parsedBinding = bindingSchema.safeParse(stored);
      if (!parsedBinding.success || parsedBinding.data.invoiceId !== invoiceId)
        throw new BindingMismatch();
      // Zod creates an independent snapshot before the provider await.
      const binding = parsedBinding.data;
      const parsedPayment = paymentSchema.safeParse(
        await this.client.getPayment(binding.providerObjectId),
      );
      if (!parsedPayment.success) throw new BindingMismatch();
      const payment = parsedPayment.data;
      if (
        payment.id !== binding.providerObjectId ||
        payment.metadata.order_id !== binding.invoiceId ||
        payment.test !== (binding.mode === "test") ||
        payment.amount.value !== "3000.00" ||
        payment.amount.currency !== binding.currency ||
        (payment.metadata.user_id !== undefined &&
          payment.metadata.user_id !== binding.userId) ||
        (payment.metadata.purpose !== undefined &&
          payment.metadata.purpose !== binding.purpose) ||
        (payment.metadata.operation_id !== undefined &&
          payment.metadata.operation_id !== binding.operationId)
      )
        throw new BindingMismatch();
      if (payment.status !== "succeeded") {
        if (payment.status === "canceled" && payment.paid)
          throw new BindingMismatch();
        return null;
      }
      if (
        !payment.paid ||
        payment.capturedAt === undefined ||
        !Number.isFinite(Date.parse(payment.capturedAt)) ||
        Date.parse(payment.capturedAt) < Date.parse(payment.createdAt)
      )
        throw new BindingMismatch();
      const facts = {
        ...binding,
        provider: "yookassa" as const,
        capturedAt: payment.capturedAt,
        eventId: `yookassa:onboarding:${payment.id}:succeeded`,
      };
      const evidenceDigest = `sha256:${createHash("sha256").update(JSON.stringify(facts)).digest("hex")}`;
      const proof = Object.freeze({
        ...facts,
        evidenceDigest,
      }) as VerifiedOnboardingPayment;
      verifiedProofs.add(proof);
      return proof;
    } catch (error) {
      if (error instanceof BindingMismatch) throw error;
      throw new Error("onboarding_payment_verification_unavailable");
    }
  }
}
