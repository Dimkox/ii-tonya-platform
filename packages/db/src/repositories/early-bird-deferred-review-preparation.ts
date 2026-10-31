import type { PostgresDeferredReviewSource } from "./early-bird-deferred-review-source.js";
import type { PostgresEarlyBirdDeferredPayments } from "./early-bird-deferred-payments.js";
import { deferredId } from "./early-bird-deferred-id.js";
/** After approval, materialize the account; no provider call or messaging happens here. */
export class EarlyBirdDeferredReviewPreparation {
  private readonly key: Buffer;
  constructor(
    private readonly source: Pick<PostgresDeferredReviewSource, "resolve">,
    private readonly payments: Pick<
      PostgresEarlyBirdDeferredPayments,
      "prepare"
    >,
    key: Buffer,
  ) {
    if (!Buffer.isBuffer(key) || key.length !== 32)
      throw new Error("early_bird_deferred_identity_invalid");
    this.key = Buffer.from(key);
  }
  async afterApproval(event: {
    applicationId: string;
    eventId: string;
  }): Promise<void> {
    const scoped = await this.source.resolve(event);
    if (!scoped) return;
    await this.payments.prepare({
      accountId: deferredId(
        this.key,
        "account",
        scoped.userId,
        scoped.choiceId,
      ),
      userId: scoped.userId,
      baseId: scoped.baseId,
      choiceId: scoped.choiceId,
      configId: scoped.configId,
    });
  }
}
