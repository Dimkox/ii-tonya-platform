import { createHash } from "node:crypto";
import { z } from "zod";
import type { YooKassaClient } from "./client.js";

const id = z.uuid();
const minor = z.string().regex(/^(0|[1-9]\d{0,11})$/u);
const bindingCommon = {
  invoiceId: id,
  userId: id,
  operationId: id,
  providerObjectId: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/u),
  onboardingMinor: minor,
  subscriptionMinor: minor,
  totalMinor: minor,
  mode: z.enum(["test", "live"]),
  baseOfferShownAt: z.iso.datetime({ offset: true }),
  launchAt: z.iso.datetime({ offset: true }),
  expiresAt: z.iso.datetime({ offset: true }),
};
const bindingSchema = z.union([
  z
    .object({
      ...bindingCommon,
      pricingPolicy: z.literal("wave1_standard_v1"),
      priceKind: z.enum(["discounted", "full_price"]),
      onboardingMinor: z.literal("300000"),
    })
    .strict(),
  z
    .object({
      ...bindingCommon,
      pricingPolicy: z.literal("owner_test_10_20_v1"),
      priceKind: z.literal("fixed_test"),
      mode: z.literal("live"),
      grantId: id,
      onboardingMinor: z.literal("1000"),
      subscriptionMinor: z.literal("2000"),
      totalMinor: z.literal("3000"),
    })
    .strict(),
]);
const paymentSchema = z
  .object({
    id: z.string(),
    status: z.enum(["pending", "waiting_for_capture", "succeeded", "canceled"]),
    paid: z.boolean(),
    amount: z
      .object({
        value: z.string().regex(/^(0|[1-9]\d*)\.\d{2}$/u),
        currency: z.literal("RUB"),
      })
      .strict(),
    test: z.boolean(),
    createdAt: z.iso.datetime({ offset: true }),
    capturedAt: z.iso.datetime({ offset: true }).optional(),
    metadata: z.record(z.string(), z.string()),
  })
  .passthrough();
export type EarlyBirdPaymentBinding = z.infer<typeof bindingSchema>;
export function parseEarlyBirdPaymentBinding(
  value: unknown,
): EarlyBirdPaymentBinding {
  return bindingSchema.parse(value);
}
declare const proofBrand: unique symbol;
export type VerifiedEarlyBirdPayment = Readonly<
  EarlyBirdPaymentBinding & {
    capturedAt: string;
    eventId: string;
    evidenceDigest: string;
    disposition: "eligible" | "reconcile";
    readonly [proofBrand]: true;
  }
>;
const proofs = new WeakMap<object, object>();
export function assertVerifiedEarlyBirdPayment(
  value: unknown,
  issuer: object,
): asserts value is VerifiedEarlyBirdPayment {
  if (
    !value ||
    typeof value !== "object" ||
    !proofs.has(value) ||
    proofs.get(value) !== issuer
  )
    throw new Error("early_bird_payment_proof_required");
}
class Mismatch extends Error {
  constructor() {
    super("early_bird_payment_binding_mismatch");
  }
}
/** A fresh provider GET is mandatory; late captured payments must be reconciled, never silently discarded. */
export class YooKassaEarlyBirdVerifier {
  constructor(
    private readonly client: Pick<YooKassaClient, "getPayment">,
    private readonly bindings: {
      findEarlyBirdBinding(
        invoiceId: string,
      ): Promise<EarlyBirdPaymentBinding | null>;
    },
  ) {}
  async verify(invoiceId: string): Promise<VerifiedEarlyBirdPayment | null> {
    try {
      if (!id.safeParse(invoiceId).success) throw new Mismatch();
      const stored = await this.bindings.findEarlyBirdBinding(invoiceId);
      if (!stored) return null;
      const parsed = bindingSchema.safeParse(stored);
      if (!parsed.success) throw new Mismatch();
      const binding = parsed.data;
      if (
        binding.invoiceId !== invoiceId ||
        Date.parse(binding.launchAt) !==
          Date.parse("2027-01-11T00:00:00+03:00") ||
        Date.parse(binding.expiresAt) !==
          Date.parse(binding.baseOfferShownAt) + 240 * 60 * 60 * 1000 ||
        (binding.pricingPolicy === "wave1_standard_v1" &&
          BigInt(binding.subscriptionMinor) < 500000n) ||
        BigInt(binding.totalMinor) !==
          BigInt(binding.onboardingMinor) + BigInt(binding.subscriptionMinor)
      )
        throw new Mismatch();
      const observed = paymentSchema.safeParse(
        await this.client.getPayment(binding.providerObjectId),
      );
      if (!observed.success) throw new Mismatch();
      const p = observed.data;
      const [rubles, kopecks] = p.amount.value.split(".");
      if (
        p.id !== binding.providerObjectId ||
        Date.parse(p.createdAt) < Date.parse(binding.baseOfferShownAt) ||
        p.test !== (binding.mode === "test") ||
        BigInt(rubles!) * 100n + BigInt(kopecks!) !==
          BigInt(binding.totalMinor) ||
        p.metadata.order_id !== invoiceId ||
        p.metadata.operation_id !== binding.operationId ||
        p.metadata.user_id !== binding.userId ||
        p.metadata.purpose !== "combined_early_bird" ||
        p.metadata.price_kind !== binding.priceKind ||
        p.metadata.pricing_policy !== binding.pricingPolicy ||
        (binding.pricingPolicy === "owner_test_10_20_v1" &&
          p.metadata.pricing_grant_id !== binding.grantId)
      )
        throw new Mismatch();
      if (p.status !== "succeeded") {
        if (
          (p.status === "canceled" && p.paid) ||
          (p.status === "pending" && p.paid)
        )
          throw new Mismatch();
        return null;
      }
      if (
        !p.paid ||
        !p.capturedAt ||
        Date.parse(p.capturedAt) < Date.parse(p.createdAt)
      )
        throw new Mismatch();
      const facts = {
        ...binding,
        capturedAt: p.capturedAt,
        eventId: `yookassa:early-bird:${p.id}:succeeded`,
        disposition:
          (binding.priceKind !== "discounted" ||
            Date.parse(p.capturedAt) < Date.parse(binding.expiresAt)) &&
          Date.parse(p.capturedAt) < Date.parse(binding.launchAt)
            ? ("eligible" as const)
            : ("reconcile" as const),
      };
      const proof = Object.freeze({
        ...facts,
        evidenceDigest: `sha256:${createHash("sha256").update(JSON.stringify(facts)).digest("hex")}`,
      }) as VerifiedEarlyBirdPayment;
      proofs.set(proof, this);
      return proof;
    } catch (error) {
      if (error instanceof Mismatch) throw error;
      throw new Error("early_bird_payment_verification_unavailable");
    }
  }
}
