import {
  assertVerifiedDeferredRefund,
  type YooKassaDeferredRefundVerifier,
  type YooKassaNotification,
} from "@ii-tonya/integrations";
/** A false result keeps the webhook retryable; reconciliation can use the same method. */
export class DeferredRefundWebhookHandler {
  constructor(
    private readonly verifier: Pick<YooKassaDeferredRefundVerifier, "verify">,
    private readonly store: {
      bind(proof: unknown): Promise<void>;
      commit(proof: unknown): Promise<void>;
      cancel(proof: unknown): Promise<void>;
    },
  ) {}
  async handle(notification: YooKassaNotification): Promise<boolean> {
    if (notification.event !== "refund.succeeded") return false;
    const proof = await this.verifier.verify(notification.object.id);
    if (proof === null) return false;
    assertVerifiedDeferredRefund(proof, this.verifier);
    if (proof.providerRefundId !== notification.object.id)
      throw new Error("early_bird_deferred_refund_mismatch");
    if (proof.status === "canceled") {
      await this.store.cancel(proof);
      return false;
    }
    await this.store.bind(proof);
    if (proof.status !== "succeeded") return false;
    await this.store.commit(proof);
    return true;
  }
}
