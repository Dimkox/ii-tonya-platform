import {
  assertVerifiedEarlyBirdRefund,
  type VerifiedEarlyBirdRefund,
  type YooKassaEarlyBirdRefundVerifier,
} from "./early-bird-refund-verifier.js";
import type { YooKassaNotification } from "./contracts.js";
import {
  assertVerifiedEarlyBirdPayment,
  type VerifiedEarlyBirdPayment,
  type YooKassaEarlyBirdVerifier,
} from "./early-bird-verifier.js";

/** The store must commit proofs idempotently, including reconciliation cases. */
export class YooKassaEarlyBirdWebhookCapability {
  constructor(
    private readonly store: {
      findInvoiceByProviderObject(
        providerObjectId: string,
      ): Promise<string | null>;
      commit(proof: VerifiedEarlyBirdPayment): Promise<void>;
    },
    private readonly verifier: Pick<YooKassaEarlyBirdVerifier, "verify">,
    private readonly refund?: {
      verifier: Pick<YooKassaEarlyBirdRefundVerifier, "verify">;
      commit(proof: VerifiedEarlyBirdRefund): Promise<void>;
    },
  ) {}

  async handle(notification: YooKassaNotification): Promise<boolean> {
    if (notification.event === "refund.succeeded") {
      if (!this.refund) return false;
      const proof = await this.refund.verifier.verify(notification.object.id);
      if (proof === null) return false;
      assertVerifiedEarlyBirdRefund(proof, this.refund.verifier);
      if (proof.refundId !== notification.object.id)
        throw new Error("early_bird_refund_binding_mismatch");
      await this.refund.commit(proof);
      return true;
    }
    if (notification.event !== "payment.succeeded") return false;
    const invoiceId = await this.store.findInvoiceByProviderObject(
      notification.object.id,
    );
    if (invoiceId === null) return false;
    const proof = await this.verifier.verify(invoiceId);
    if (proof === null) return false;
    assertVerifiedEarlyBirdPayment(proof, this.verifier);
    if (
      proof.invoiceId !== invoiceId ||
      proof.providerObjectId !== notification.object.id
    )
      throw new Error("early_bird_payment_binding_mismatch");
    await this.store.commit(proof);
    return true;
  }
}
