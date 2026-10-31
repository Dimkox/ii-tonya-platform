import { createHash } from "node:crypto";
import { z } from "zod";
import type { YooKassaClient } from "./client.js";
import {
  parseDeferredSnapshot,
  type DeferredSnapshot,
} from "./early-bird-deferred-verifier.js";

const providerId = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/u);
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
    test: z.boolean(),
    amount,
    createdAt: z.iso.datetime({ offset: true }),
    capturedAt: z.iso.datetime({ offset: true }).optional(),
    metadata: z.record(z.string(), z.string()),
  })
  .passthrough();
const minor = (value: string) => {
  const [rubles, kopecks] = value.split(".");
  return BigInt(rubles!) * 100n + BigInt(kopecks!);
};
declare const brand: unique symbol;
export type VerifiedDeferredRefund = Readonly<
  DeferredSnapshot & {
    providerPaymentId: string;
    providerRefundId: string;
    refundAmountMinor: string;
    providerCreatedAt: string;
    status: "pending" | "succeeded" | "canceled";
    evidenceDigest: string;
    readonly [brand]: true;
  }
>;
const proofs = new WeakMap<object, object>();
export function assertVerifiedDeferredRefund(
  value: unknown,
  issuer: object,
): asserts value is VerifiedDeferredRefund {
  if (!value || typeof value !== "object" || proofs.get(value) !== issuer)
    throw new Error("early_bird_deferred_refund_proof_required");
}
/** Independent provider GETs; webhook payloads supply only the refund identifier. */
export class YooKassaDeferredRefundVerifier {
  constructor(
    private readonly client: Pick<YooKassaClient, "getRefund" | "getPayment">,
    private readonly reader: {
      findByProviderPayment(
        providerId: string,
      ): Promise<(DeferredSnapshot & { providerId: string }) | null>;
    },
  ) {}
  async verify(refundId: string): Promise<VerifiedDeferredRefund | null> {
    if (!providerId.safeParse(refundId).success)
      throw new Error("early_bird_deferred_refund_mismatch");
    const refund = refundSchema.parse(await this.client.getRefund(refundId));
    if (refund.id !== refundId)
      throw new Error("early_bird_deferred_refund_mismatch");
    const bound = await this.reader.findByProviderPayment(refund.paymentId);
    if (!bound) return null;
    const { providerId: paymentId, ...raw } = bound,
      snapshot = parseDeferredSnapshot(raw);
    const payment = paymentSchema.parse(
      await this.client.getPayment(paymentId),
    );
    const value = minor(refund.amount.value);
    if (
      paymentId !== refund.paymentId ||
      snapshot.operationId !== snapshot.invoiceId ||
      Date.parse(snapshot.launchAt) !==
        Date.parse("2027-01-11T00:00:00+03:00") ||
      payment.id !== paymentId ||
      payment.status !== "succeeded" ||
      !payment.paid ||
      !payment.capturedAt ||
      Date.parse(payment.capturedAt) < Date.parse(payment.createdAt) ||
      Date.parse(refund.createdAt) < Date.parse(payment.capturedAt) ||
      payment.test !== (snapshot.mode === "test") ||
      minor(payment.amount.value) !== BigInt(snapshot.amountMinor) ||
      value <= 0n ||
      value > BigInt(snapshot.amountMinor) ||
      payment.metadata.order_id !== snapshot.invoiceId ||
      payment.metadata.operation_id !== snapshot.operationId ||
      payment.metadata.user_id !== snapshot.userId ||
      payment.metadata.purpose !== "early_bird_deferred" ||
      payment.metadata.stage !== snapshot.stage ||
      payment.metadata.pricing_policy !== snapshot.policy ||
      (snapshot.grantId &&
        payment.metadata.pricing_grant_id !== snapshot.grantId) ||
      (snapshot.policy === "owner_test_10_20_v1" &&
        (snapshot.mode !== "live" ||
          !snapshot.grantId ||
          snapshot.amountMinor !==
            (snapshot.stage === "onboarding" ? "1000" : "2000"))) ||
      (snapshot.policy === "wave1_standard_v1" &&
        (snapshot.grantId !== null ||
          (snapshot.stage === "onboarding" &&
            snapshot.amountMinor !== "300000")))
    )
      throw new Error("early_bird_deferred_refund_mismatch");
    const stable = {
      ...snapshot,
      providerPaymentId: paymentId,
      providerRefundId: refund.id,
      refundAmountMinor: value.toString(),
      providerCreatedAt: refund.createdAt,
    };
    const proof = Object.freeze({
      ...stable,
      status: refund.status,
      evidenceDigest: `sha256:${createHash("sha256").update(JSON.stringify(stable)).digest("hex")}`,
    }) as VerifiedDeferredRefund;
    proofs.set(proof, this);
    return proof;
  }
}
