import { createHash } from "node:crypto";
import { z } from "zod";
import type { YooKassaClient } from "./client.js";

const providerId = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/u);
const bindingCommon = {
  invoiceId: z.uuid(),
  userId: z.uuid(),
  operationId: z.uuid(),
  refundOperationId: z.uuid(),
  paymentId: providerId,
  refundId: providerId,
  totalMinor: z.string().regex(/^[1-9]\d{0,11}$/u),
  mode: z.enum(["test", "live"]),
};
const bindingSchema = z.union([
  z
    .object({
      ...bindingCommon,
      pricingPolicy: z.literal("wave1_standard_v1"),
      priceKind: z.enum(["discounted", "full_price"]),
    })
    .strict(),
  z
    .object({
      ...bindingCommon,
      pricingPolicy: z.literal("owner_test_10_20_v1"),
      priceKind: z.literal("fixed_test"),
      grantId: z.uuid(),
      mode: z.literal("live"),
      totalMinor: z.literal("3000"),
    })
    .strict(),
]);
const amount = z
  .object({
    value: z.string().regex(/^(0|[1-9]\d*)\.\d{2}$/u),
    currency: z.literal("RUB"),
  })
  .strict();
const refundSchema = z
  .object({
    id: providerId,
    paymentId: providerId,
    status: z.enum(["pending", "succeeded", "canceled"]),
    amount,
    createdAt: z.iso.datetime({ offset: true }),
  })
  .passthrough();
const paymentSchema = z
  .object({
    id: providerId,
    status: z.enum(["pending", "waiting_for_capture", "succeeded", "canceled"]),
    paid: z.boolean(),
    amount,
    test: z.boolean(),
    createdAt: z.iso.datetime({ offset: true }),
    capturedAt: z.iso.datetime({ offset: true }).optional(),
    metadata: z.record(z.string(), z.string()),
  })
  .passthrough();
const minor = (value: string): bigint => {
  const [rubles, kopecks] = value.split(".");
  return BigInt(rubles!) * 100n + BigInt(kopecks!);
};
export type EarlyBirdRefundBinding = z.infer<typeof bindingSchema>;
export function parseEarlyBirdRefundBinding(
  value: unknown,
): EarlyBirdRefundBinding {
  return bindingSchema.parse(value);
}
declare const brand: unique symbol;
export type VerifiedEarlyBirdRefund = Readonly<
  EarlyBirdRefundBinding & {
    amountMinor: string;
    providerCreatedAt: string;
    evidenceDigest: string;
    disposition: "full_refund" | "reconcile";
    readonly [brand]: true;
  }
>;
const proofs = new WeakMap<object, object>();
export function assertVerifiedEarlyBirdRefund(
  value: unknown,
  issuer: object,
): asserts value is VerifiedEarlyBirdRefund {
  if (
    !value ||
    typeof value !== "object" ||
    !proofs.has(value) ||
    proofs.get(value) !== issuer
  )
    throw new Error("early_bird_refund_proof_required");
}
class Mismatch extends Error {
  constructor() {
    super("early_bird_refund_binding_mismatch");
  }
}
/** The provider creation time is not settlement time; the database must record first observation under its own clock. */
export class YooKassaEarlyBirdRefundVerifier {
  constructor(
    private readonly client: Pick<YooKassaClient, "getRefund" | "getPayment">,
    private readonly bindings: {
      findRefundBinding(
        refundId: string,
      ): Promise<EarlyBirdRefundBinding | null>;
    },
  ) {}
  async verify(refundId: string): Promise<VerifiedEarlyBirdRefund | null> {
    try {
      if (!providerId.safeParse(refundId).success) throw new Mismatch();
      const stored = await this.bindings.findRefundBinding(refundId);
      if (!stored) return null;
      const parsed = bindingSchema.safeParse(stored);
      if (!parsed.success || parsed.data.refundId !== refundId)
        throw new Mismatch();
      const binding = parsed.data;
      const [refundRead, paymentRead] = await Promise.all([
        this.client.getRefund(refundId),
        this.client.getPayment(binding.paymentId),
      ]);
      const r = refundSchema.safeParse(refundRead);
      const p = paymentSchema.safeParse(paymentRead);
      if (!r.success || !p.success) throw new Mismatch();
      const refund = r.data;
      const payment = p.data;
      const total = BigInt(binding.totalMinor);
      const refunded = minor(refund.amount.value);
      if (
        refund.id !== refundId ||
        refund.paymentId !== binding.paymentId ||
        payment.id !== binding.paymentId ||
        payment.status !== "succeeded" ||
        !payment.paid ||
        !payment.capturedAt ||
        Date.parse(payment.capturedAt) < Date.parse(payment.createdAt) ||
        Date.parse(refund.createdAt) < Date.parse(payment.capturedAt) ||
        payment.test !== (binding.mode === "test") ||
        minor(payment.amount.value) !== total ||
        refunded <= 0n ||
        refunded > total ||
        payment.metadata.order_id !== binding.invoiceId ||
        payment.metadata.operation_id !== binding.operationId ||
        payment.metadata.user_id !== binding.userId ||
        payment.metadata.purpose !== "combined_early_bird" ||
        payment.metadata.pricing_policy !== binding.pricingPolicy ||
        payment.metadata.price_kind !== binding.priceKind ||
        (binding.pricingPolicy === "owner_test_10_20_v1" &&
          payment.metadata.pricing_grant_id !== binding.grantId)
      )
        throw new Mismatch();
      if (refund.status !== "succeeded") return null;
      const facts = {
        ...binding,
        amountMinor: refunded.toString(),
        providerCreatedAt: refund.createdAt,
        disposition:
          refunded === total
            ? ("full_refund" as const)
            : ("reconcile" as const),
      };
      const proof = Object.freeze({
        ...facts,
        evidenceDigest: `sha256:${createHash("sha256").update(JSON.stringify(facts)).digest("hex")}`,
      }) as VerifiedEarlyBirdRefund;
      proofs.set(proof, this);
      return proof;
    } catch (error) {
      if (error instanceof Mismatch) throw error;
      throw new Error("early_bird_refund_verification_unavailable");
    }
  }
}
