import {
  assertVerifiedDeferredPayment,
  type YooKassaDeferredVerifier,
  type YooKassaNotification,
} from "@ii-tonya/integrations";
/** Handler relies on a stored provider binding and fresh provider GET before settlement. */
export class DeferredPaymentWebhookHandler {
  constructor(
    private readonly reader: {
      findByProviderPayment(
        providerId: string,
      ): Promise<{ invoiceId: string; providerId: string } | null>;
    },
    private readonly verifier: Pick<YooKassaDeferredVerifier, "verify">,
    private readonly store: {
      bind(proof: unknown): Promise<void>;
      commit(proof: unknown): Promise<void>;
    },
  ) {}
  async handle(notification: YooKassaNotification): Promise<boolean> {
    if (notification.event !== "payment.succeeded") return false;
    const bound = await this.reader.findByProviderPayment(
      notification.object.id,
    );
    if (!bound) return false;
    if (bound.providerId !== notification.object.id)
      throw new Error("early_bird_deferred_binding_mismatch");
    const proof = await this.verifier.verify(bound.invoiceId, bound.providerId);
    assertVerifiedDeferredPayment(proof, this.verifier);
    if (
      proof.invoiceId !== bound.invoiceId ||
      proof.providerId !== bound.providerId
    )
      throw new Error("early_bird_deferred_binding_mismatch");
    await this.store.bind(proof);
    if (proof.status !== "succeeded") return false;
    await this.store.commit(proof);
    return true;
  }
}
