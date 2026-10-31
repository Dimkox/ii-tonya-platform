import type { EarlyBirdDeferredRecovery } from "./expert-early-bird-deferred-recovery.js";
import {
  PostgresDeferredSendAdmission,
  PostgresDeferredRequestStore,
  deferredRequestAuthenticator,
  type DrizzleDb,
  type DeferredReceiptScope,
} from "@ii-tonya/db";
import {
  EarlyBirdDeferredCheckoutSender,
  type YooKassaDeferredVerifier,
  type VerifiedDeferredPayment,
} from "@ii-tonya/integrations";

type SenderOptions = ConstructorParameters<
  typeof EarlyBirdDeferredCheckoutSender
>[0];
/** Draft-only; enabled=false by default and no runtime wires this composition yet. */
export class EarlyBirdDeferredComposition {
  readonly strictFirstSendCancellation = false as const;
  constructor(
    private readonly options: {
      enabled?: boolean;
      requests: Pick<PostgresDeferredRequestStore, "prepare">;
      recovery: EarlyBirdDeferredRecovery;
      sendDb: DrizzleDb;
      senderLogin: string;
      requestKey: Buffer;
      keyReference: string;
      gateway: SenderOptions["gateway"];
      verifier: YooKassaDeferredVerifier;
      binding: { bind(proof: VerifiedDeferredPayment): Promise<void> };
      client: SenderOptions["client"];
    },
  ) {}
  async checkout(
    scope: DeferredReceiptScope,
    invoiceId: string,
    receiptContactId: string,
  ) {
    if (this.options.enabled !== true) return { kind: "unavailable" as const };
    const recovered = await this.options.recovery.find(scope, invoiceId);
    if (recovered) return recovered;
    const material = await this.options.requests.prepare(
      scope,
      invoiceId,
      receiptContactId,
    );
    const admission = new PostgresDeferredSendAdmission(
      this.options.sendDb,
      this.options.senderLogin,
      deferredRequestAuthenticator(
        material,
        receiptContactId,
        this.options.requestKey,
        this.options.keyReference,
      ),
    );
    const sender = new EarlyBirdDeferredCheckoutSender({
      enabled: true,
      admission,
      gateway: this.options.gateway,
      verifier: this.options.verifier,
      binding: this.options.binding,
      client: this.options.client,
    });
    return sender.createOrRecover({
      userId: material.snapshot.userId,
      invoiceId,
      receiptContactId,
    });
  }
}
