import { randomUUID } from "node:crypto";
import type { YooKassaClient } from "./client.js";
import type { EarlyBirdPaymentBinding } from "./early-bird-verifier.js";
import {
  YooKassaEarlyBirdRefundVerifier,
  type EarlyBirdRefundBinding,
  type VerifiedEarlyBirdRefund,
} from "./early-bird-refund-verifier.js";
/** Default-off. Both binding and settlement sinks must independently check the issuing verifier. */
export class YooKassaEarlyBirdRefundDiscovery {
  private readonly candidates = new Map<string, EarlyBirdRefundBinding>();
  private readonly inFlight = new Set<string>();
  private readonly verifier: YooKassaEarlyBirdRefundVerifier;
  private readonly sinks: {
    bind(proof: VerifiedEarlyBirdRefund): Promise<void>;
    settle(proof: VerifiedEarlyBirdRefund): Promise<void>;
  };
  constructor(
    private readonly client: Pick<YooKassaClient, "getRefund" | "getPayment">,
    private readonly payments: {
      findInvoiceByProviderObject(id: string): Promise<string | null>;
      findEarlyBirdBinding(id: string): Promise<EarlyBirdPaymentBinding | null>;
    },
    private readonly refunds: {
      findRefundBinding(id: string): Promise<EarlyBirdRefundBinding | null>;
    },
    createSinks: (issuer: YooKassaEarlyBirdRefundVerifier) => {
      bind(proof: VerifiedEarlyBirdRefund): Promise<void>;
      settle(proof: VerifiedEarlyBirdRefund): Promise<void>;
    },
  ) {
    this.verifier = new YooKassaEarlyBirdRefundVerifier(this.client, {
      findRefundBinding: async (id) => this.candidates.get(id) ?? null,
    });
    this.sinks = createSinks(this.verifier);
  }
  async handle(refundId: string): Promise<boolean> {
    if (!/^[A-Za-z0-9_-]{1,64}$/u.test(refundId))
      throw new Error("early_bird_refund_discovery_invalid");
    if (this.inFlight.has(refundId)) return false;
    this.inFlight.add(refundId);
    try {
      const refund = await this.client.getRefund(refundId);
      if (
        refund.id !== refundId ||
        !/^[A-Za-z0-9_-]{1,64}$/u.test(refund.paymentId)
      )
        throw new Error("early_bird_refund_discovery_mismatch");
      if (refund.status !== "succeeded") return false;
      const invoice = await this.payments.findInvoiceByProviderObject(
        refund.paymentId,
      );
      if (invoice === null) return false;
      const payment = await this.payments.findEarlyBirdBinding(invoice);
      if (
        !payment ||
        payment.invoiceId !== invoice ||
        payment.providerObjectId !== refund.paymentId
      )
        throw new Error("early_bird_refund_discovery_mismatch");
      const existing = await this.refunds.findRefundBinding(refundId);
      const common = {
        invoiceId: payment.invoiceId,
        userId: payment.userId,
        operationId: payment.operationId,
        refundOperationId: existing?.refundOperationId ?? randomUUID(),
        paymentId: payment.providerObjectId,
        refundId,
        totalMinor: payment.totalMinor,
        mode: payment.mode,
      };
      const candidate: EarlyBirdRefundBinding =
        payment.pricingPolicy === "owner_test_10_20_v1"
          ? {
              ...common,
              pricingPolicy: payment.pricingPolicy,
              priceKind: payment.priceKind,
              grantId: payment.grantId,
              mode: payment.mode,
              totalMinor: payment.totalMinor,
            }
          : {
              ...common,
              pricingPolicy: payment.pricingPolicy,
              priceKind: payment.priceKind,
            };
      if (existing && JSON.stringify(existing) !== JSON.stringify(candidate)) {
        // Compare keys without relying on property insertion order.
        const keys = Object.keys(candidate) as (keyof EarlyBirdRefundBinding)[];
        if (
          Object.keys(existing).length !== keys.length ||
          keys.some((key) => existing[key] !== candidate[key])
        )
          throw new Error("early_bird_refund_discovery_mismatch");
      }
      this.candidates.set(refundId, candidate);
      const proof = await this.verifier.verify(refundId);
      if (proof === null) return false;
      await this.sinks.bind(proof);
      await this.sinks.settle(proof);
      return true;
    } finally {
      this.candidates.delete(refundId);
      this.inFlight.delete(refundId);
    }
  }
}
