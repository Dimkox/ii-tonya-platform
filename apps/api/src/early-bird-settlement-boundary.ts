import {
  assertVerifiedEarlyBirdPayment,
  type VerifiedEarlyBirdPayment,
  type YooKassaEarlyBirdVerifier,
} from "@ii-tonya/integrations";

/** Application boundary only. The storage implementation must still validate its
 * locked immutable invoice and enforce atomic idempotency in PostgreSQL. */
export class EarlyBirdSettlementBoundary {
  constructor(
    private readonly verifier: YooKassaEarlyBirdVerifier,
    private readonly storage: {
      settle(proof: VerifiedEarlyBirdPayment): Promise<void>;
      reconcile(proof: VerifiedEarlyBirdPayment): Promise<void>;
    },
  ) {}
  async apply(proof: unknown): Promise<void> {
    assertVerifiedEarlyBirdPayment(proof, this.verifier);
    if (proof.disposition === "eligible") await this.storage.settle(proof);
    else await this.storage.reconcile(proof);
  }
}
