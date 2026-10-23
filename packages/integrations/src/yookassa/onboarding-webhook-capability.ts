import {
  yooKassaNotificationSchema,
  type YooKassaNotification,
} from "./contracts.js";
import {
  assertVerifiedOnboardingPayment,
  type VerifiedOnboardingPayment,
} from "./onboarding-verifier.js";
class OnboardingWebhookError extends Error {}
/** Routes only durably bound onboarding objects. Checkout enablement cannot block
 * reconciliation of a payment that already exists. The HTTP caller owns webhook
 * authentication, durable inbox claims, and bounded retry scheduling.
 * Supported payment.succeeded events require GET proof; bound waiting/canceled
 * payments remain manual-review work. Refund notifications carry refund IDs,
 * never payment IDs: leave them to legacy refund lookup, whose unmatched path
 * retains retry rather than acknowledging an unknown onboarding refund. */
export class YooKassaOnboardingWebhookCapability {
  constructor(
    private readonly bindings: {
      findOnboardingInvoiceByProviderObjectId(
        paymentId: string,
      ): Promise<string | null>;
    },
    private readonly verifier: {
      verify(invoiceId: string): Promise<VerifiedOnboardingPayment | null>;
    },
    private readonly settlements: {
      settleVerified(proof: VerifiedOnboardingPayment): Promise<unknown>;
    },
  ) {}
  async handle(notification: YooKassaNotification): Promise<boolean> {
    try {
      const parsed = yooKassaNotificationSchema.safeParse(notification);
      if (!parsed.success)
        throw new OnboardingWebhookError("onboarding_webhook_invalid");
      const event = parsed.data;
      if (event.event === "refund.succeeded") return false;
      const invoiceId =
        await this.bindings.findOnboardingInvoiceByProviderObjectId(
          event.object.id,
        );
      if (invoiceId === null) return false;
      if (event.event !== "payment.succeeded")
        throw new OnboardingWebhookError(
          "onboarding_payment_manual_review_required",
        );
      const proof = await this.verifier.verify(invoiceId);
      if (proof === null)
        throw new OnboardingWebhookError("onboarding_payment_not_final");
      assertVerifiedOnboardingPayment(proof);
      if (
        proof.invoiceId !== invoiceId ||
        proof.providerObjectId !== event.object.id
      )
        throw new OnboardingWebhookError("onboarding_webhook_binding_mismatch");
      await this.settlements.settleVerified(proof);
      return true;
    } catch (error) {
      if (error instanceof OnboardingWebhookError) throw error;
      throw new Error("onboarding_webhook_unavailable");
    }
  }
}
