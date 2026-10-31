import {
  assertVerifiedEarlyBirdCandidate,
  type VerifiedEarlyBirdCandidate,
  type YooKassaEarlyBirdCandidateVerifier,
} from "@ii-tonya/integrations";

/** The store must independently lock and recheck the immutable DB intent. */
export class EarlyBirdCandidateBindingBoundary {
  constructor(
    private readonly verifier: YooKassaEarlyBirdCandidateVerifier,
    private readonly storage: {
      bind(proof: VerifiedEarlyBirdCandidate): Promise<void>;
    },
  ) {}
  async bind(proof: unknown): Promise<void> {
    assertVerifiedEarlyBirdCandidate(proof, this.verifier);
    await this.storage.bind(proof);
  }
}
