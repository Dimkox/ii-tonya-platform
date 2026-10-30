import { deferredId } from "./expert-early-bird-deferred-id.js";
import type { ResidentFormInput } from "@ii-tonya/application";
import {
  type PostgresDeferredScopeSource,
  type PostgresDeferredReceiptContact,
  type PostgresEarlyBirdDeferredPayments,
} from "@ii-tonya/db";
import type {
  EarlyBirdSalesAuthority,
  WaveInvoice,
} from "./expert-early-bird-service.js";
import type { EarlyBirdPrepareAuthority } from "./expert-early-bird-prepare-hook.js";
import type { EarlyBirdDeferredComposition } from "./expert-early-bird-deferred-composition.js";
import type { EarlyBirdDeferredStatus } from "./expert-early-bird-deferred-status.js";

type Choice = Parameters<EarlyBirdSalesAuthority["choose"]>[0];
/** Trusted composition is default-off upstream; identity key rotation requires preserving the old key until reconciliation. */
export class EarlyBirdDeferredAuthority implements EarlyBirdPrepareAuthority {
  private readonly key: Buffer;
  constructor(
    private readonly options: {
      scope: PostgresDeferredScopeSource;
      contacts: PostgresDeferredReceiptContact;
      payments: PostgresEarlyBirdDeferredPayments;
      checkout: EarlyBirdDeferredComposition;
      status: EarlyBirdDeferredStatus;
      engagement: { recordEngagementForUser(userId: string): Promise<unknown> };
      identityKey: Buffer;
      clientStartMs: number;
    },
  ) {
    if (
      !Buffer.isBuffer(options.identityKey) ||
      options.identityKey.length !== 32 ||
      options.clientStartMs !== Date.parse("2027-01-11T00:00:00+03:00")
    )
      throw new Error("early_bird_deferred_config_invalid");
    this.key = Buffer.from(options.identityKey);
  }
  private id(kind: string, userId: string, choiceId: string): string {
    return deferredId(this.key, kind, userId, choiceId);
  }
  async prepare(
    input: Parameters<EarlyBirdPrepareAuthority["prepare"]>[0],
  ): Promise<{ kind: "prepared" | "unavailable" }> {
    if (input.choice !== "later") return { kind: "unavailable" };
    const scoped = await this.options.scope.resolveQualified(input);
    if (!scoped) return { kind: "unavailable" };
    await this.options.payments.prepare({
      accountId: this.id("account", scoped.userId, scoped.choiceId),
      userId: scoped.userId,
      baseId: scoped.baseId,
      choiceId: scoped.choiceId,
      configId: scoped.configId,
    });
    return { kind: "prepared" };
  }
  async captureReceipt(
    input: ResidentFormInput,
    email: string,
  ): Promise<boolean | WaveInvoice> {
    if (!Number.isSafeInteger(input.updateId) || input.updateId < 0)
      return false;
    const scope = await this.options.scope.resolveCurrent(input);
    if (!scope) return false;
    await this.options.contacts.capture(
      scope,
      email,
      `wave-receipt:${input.botId}:${input.updateId}`,
    );
    const current = await this.options.status.current(input);
    const result = await this.choose({
      ...input,
      offerId: scope.offerId,
      revision: scope.revision,
      choice: current?.status === "ONBOARDING_ONLY" ? "subscription" : "later",
    });
    return result?.kind === "invoice" ? result : true;
  }
  current(input: ResidentFormInput) {
    return this.options.status.current(input);
  }
  async choose(input: Choice): ReturnType<EarlyBirdSalesAuthority["choose"]> {
    if (input.choice !== "later" && input.choice !== "subscription")
      return null;
    const scope = await this.options.scope.resolveCurrent(input);
    if (
      !scope ||
      scope.offerId !== input.offerId ||
      scope.revision !== input.revision
    )
      return null;
    const identity = await this.options.scope.resolve(scope);
    if (!identity) return null;
    const current = await this.options.status.current(input);
    if (
      input.choice === "subscription" &&
      (!current ||
        current.id !== input.offerId ||
        current.revision !== input.revision)
    )
      return null;
    if (input.choice === "subscription")
      await this.options.engagement.recordEngagementForUser(identity.userId);
    const contact = await this.options.contacts.active(scope);
    if (!contact) return { kind: "pending" };
    const stage = input.choice === "later" ? "onboarding" : "subscription";
    const invoiceId = this.id(
      `${stage}-invoice`,
      identity.userId,
      scope.choiceId,
    );
    const amount = await this.options.payments.invoice({
      accountId: scope.accountId,
      userId: identity.userId,
      invoiceId,
      idempotencyKey: this.id(
        `${stage}-idempotency`,
        identity.userId,
        scope.choiceId,
      ),
      stage,
    });
    const result = await this.options.checkout.checkout(
      scope,
      invoiceId,
      contact.id,
    );
    if (result.kind !== "ready") return { kind: "pending" };
    return {
      kind: "invoice",
      purpose: stage,
      url: result.confirmationUrl,
      totalMinor: amount.toString(),
      onboardingMinor: stage === "onboarding" ? amount.toString() : "0",
      subscriptionMinor: stage === "subscription" ? amount.toString() : "0",
      clientStart: new Date(this.options.clientStartMs).toISOString(),
    };
  }
}
