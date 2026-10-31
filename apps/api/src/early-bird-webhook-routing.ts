import type { YooKassaNotification } from "@ii-tonya/integrations";
import type { YooKassaWebhookDependencies } from "./routes/yookassa-webhook.js";
import { resolveWithEarlyBirdBinding } from "./early-bird-payment-purpose-resolver.js";
/** Explicit composition only: callers must provision isolated trusted capabilities. */
export function createEarlyBirdWebhookRouting(deps: {
  legacy: (
    id: string,
    event: YooKassaNotification["event"],
  ) => Promise<"ONBOARDING_FEE" | "MAIN_SUBSCRIPTION" | null>;
  findInvoice: (id: string) => Promise<string | null>;
  getRefund: (id: string) => Promise<{
    id: string;
    paymentId: string;
    status: "pending" | "succeeded" | "canceled";
  }>;
  exactLegacyRefund: (refundId: string, paymentId: string) => Promise<boolean>;
  paymentHandler: {
    handle(notification: YooKassaNotification): Promise<boolean>;
  };
  refundDiscovery: { handle(refundId: string): Promise<boolean> };
  deferredRefund?: {
    findByProviderPayment(id: string): Promise<unknown | null>;
    handle(notification: YooKassaNotification): Promise<boolean>;
  };
  deferredPaymentHandler?: {
    handle(notification: YooKassaNotification): Promise<boolean>;
  };
  deferredPaymentLookup?: {
    findByProviderPayment(id: string): Promise<unknown | null>;
  };
}): Required<
  Pick<YooKassaWebhookDependencies, "resolvePurpose" | "composite">
> &
  Pick<YooKassaWebhookDependencies, "deferredRefund" | "deferredPayment"> {
  if (
    Boolean(deps.deferredRefund) !== Boolean(deps.deferredPaymentHandler) ||
    Boolean(deps.deferredRefund) !== Boolean(deps.deferredPaymentLookup)
  )
    throw new Error("early_bird_deferred_webhook_incomplete");
  const resolvePurpose = resolveWithEarlyBirdBinding(
    deps.legacy,
    deps.findInvoice,
    deps.getRefund,
    deps.exactLegacyRefund,
    deps.deferredRefund
      ? (id) => deps.deferredRefund!.findByProviderPayment(id)
      : undefined,
    deps.deferredPaymentLookup
      ? (id) => deps.deferredPaymentLookup!.findByProviderPayment(id)
      : undefined,
  );
  return {
    resolvePurpose,
    ...(deps.deferredRefund ? { deferredRefund: deps.deferredRefund } : {}),
    ...(deps.deferredPaymentHandler
      ? { deferredPayment: deps.deferredPaymentHandler }
      : {}),
    composite: {
      handle: async (notification) =>
        notification.event === "refund.succeeded"
          ? deps.refundDiscovery.handle(notification.object.id)
          : deps.paymentHandler.handle(notification),
    },
  };
}
