import type { YooKassaNotification } from "@ii-tonya/integrations";
import type { BoundPaymentPurpose } from "./routes/yookassa-webhook.js";
/** Explicit opt-in composition: refund IDs need a distinct trusted refund binding. */
export function resolveWithEarlyBirdBinding(
  legacy: (
    id: string,
    event: YooKassaNotification["event"],
  ) => Promise<"ONBOARDING_FEE" | "MAIN_SUBSCRIPTION" | null>,
  findInvoice: (providerPaymentId: string) => Promise<string | null>,
  getRefund?: (refundId: string) => Promise<{
    id: string;
    paymentId: string;
    status: "pending" | "succeeded" | "canceled";
  }>,
  exactLegacyRefund?: (refundId: string, paymentId: string) => Promise<boolean>,
  findDeferredRefund?: (paymentId: string) => Promise<unknown | null>,
  findDeferredPayment?: (paymentId: string) => Promise<unknown | null>,
): (
  id: string,
  event: YooKassaNotification["event"],
) => Promise<BoundPaymentPurpose | null> {
  return async (id, event) => {
    if (event === "refund.succeeded") {
      if (!getRefund) return null;
      if (!/^[A-Za-z0-9_-]{1,64}$/u.test(id))
        throw new Error("early_bird_refund_route_unverified");
      const refund = await getRefund(id);
      if (
        refund.id !== id ||
        refund.status !== "succeeded" ||
        !/^[A-Za-z0-9_-]{1,64}$/u.test(refund.paymentId)
      )
        throw new Error("early_bird_refund_route_unverified");
      const [legacyRefund, legacyPayment, invoice, deferred, deferredBound] =
        await Promise.all([
          legacy(id, event),
          legacy(refund.paymentId, "payment.succeeded"),
          findInvoice(refund.paymentId),
          findDeferredRefund
            ? findDeferredRefund(refund.paymentId)
            : Promise.resolve(null),
          findDeferredPayment
            ? findDeferredPayment(refund.paymentId)
            : Promise.resolve(null),
        ]);
      if (
        (invoice &&
          (legacyRefund || legacyPayment || deferred || deferredBound)) ||
        ((deferred || deferredBound) && (legacyRefund || legacyPayment)) ||
        (deferred && !deferredBound)
      )
        throw new Error("payment_purpose_ambiguous");
      if (invoice) return "COMBINED_EARLY_BIRD";
      if (deferred && deferredBound) return "DEFERRED_EARLY_BIRD";
      if (deferredBound) return null;
      if (legacyRefund && legacyPayment && legacyRefund !== legacyPayment)
        throw new Error("payment_purpose_ambiguous");
      if (!legacyRefund || legacyRefund !== legacyPayment || !exactLegacyRefund)
        return null;
      return (await exactLegacyRefund(id, refund.paymentId))
        ? legacyRefund
        : null;
    }
    const [previous, invoice, deferred] = await Promise.all([
      legacy(id, event),
      findInvoice(id),
      findDeferredPayment ? findDeferredPayment(id) : Promise.resolve(null),
    ]);
    if ((previous && (invoice || deferred)) || (invoice && deferred))
      throw new Error("payment_purpose_ambiguous");
    return invoice
      ? "COMBINED_EARLY_BIRD"
      : deferred
        ? "DEFERRED_EARLY_BIRD"
        : previous;
  };
}
