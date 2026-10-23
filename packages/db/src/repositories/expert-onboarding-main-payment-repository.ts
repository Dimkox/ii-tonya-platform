export * from "./expert-card-main-command.js";
import { sql } from "drizzle-orm";
import type { DrizzleDb } from "../client.js";
import { PostgresExpertCampaignQuoteRepository } from "./expert-campaign-quote-repository.js";
import { PostgresExpertCampaignOrderRepository } from "./expert-campaign-order-repository.js";
import {
  beginCardRequest,
  finishCardRequest,
  type ExpertCardTransaction,
} from "./expert-card-repository.js";
import {
  parseMainCardCommand,
  CardMainPaymentError,
  type MainCardQuoteCommand,
  type MainCardAcceptanceCommand,
  type MainCardCheckoutCommand,
} from "./expert-card-main-command.js";
const invalid = (code: string): never => {
  throw new CardMainPaymentError(code);
};
function iso(value: string | Date) {
  return value instanceof Date
    ? value.toISOString()
    : new Date(value).toISOString();
}
import {
  beginMainCardCheckout,
  assertMainCardPriorOrder,
  finishMainCardCheckout,
  lockMainFrameGate,
} from "./expert-card-main-gates.js";
/** A snapshot of stored owner/order facts, never a lease for an external send. */
export interface MainCardCheckoutBinding {
  readonly orderId: string;
  readonly userId: string;
  readonly expertId: string;
  readonly amountMinor: string;
  readonly currency: "RUB";
  readonly providerMode: "test" | "live";
  readonly purpose: "main_residency";
  readonly paymentDeadline: string;
  readonly idempotencyKey: string;
}
const uuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
export class PostgresExpertOnboardingMainPaymentRepository {
  private readonly policy: Readonly<{
    messagingConsentPolicyVersion: string;
    providerMode: "test" | "live";
  }>;
  constructor(
    private readonly db: DrizzleDb,
    policy: {
      messagingConsentPolicyVersion: string;
      providerMode: "test" | "live";
    },
  ) {
    if (
      !policy ||
      !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(
        policy.messagingConsentPolicyVersion,
      ) ||
      (policy.providerMode !== "test" && policy.providerMode !== "live")
    )
      invalid("card_main_configuration_invalid");
    this.policy = Object.freeze({ ...policy });
  }
  private async transaction<T>(
    work: (tx: ExpertCardTransaction) => Promise<T>,
  ): Promise<T> {
    try {
      return await this.db.transaction(async (tx) => {
        await tx.execute(sql`set local statement_timeout='3000ms'`);
        await tx.execute(sql`set local lock_timeout='500ms'`);
        return work(tx);
      });
    } catch (error) {
      if (error instanceof CardMainPaymentError) throw error;
      if (
        error instanceof Error &&
        "code" in error &&
        typeof error.code === "string" &&
        ["card_forbidden", "card_idempotency_conflict"].includes(error.code)
      )
        throw error;
      throw new CardMainPaymentError("card_main_storage_unavailable");
    }
  }
  async quoteMain(raw: MainCardQuoteCommand) {
    const input = parseMainCardCommand(raw, "quote");
    return this.transaction(async (tx) => {
      const started = await beginCardRequest(tx, input, "main_quote", {
        tariffVersionId: input.tariffVersionId,
        termMonths: input.termMonths,
        revision: input.revision,
      });
      const gate = await lockMainFrameGate(
        tx,
        started.userId,
        input,
        input.revision,
      );
      if (
        gate.messagingConsentPolicyVersion !==
        this.policy.messagingConsentPolicyVersion
      )
        invalid("card_main_forbidden");
      if (started.replay) {
        const prior = (
          await tx.execute<{
            id: string;
            priceMinor: string;
            currency: "RUB";
            termMonths: 1 | 3;
            expiresAt: string | Date;
          }>(
            sql`select id,price_minor::text as "priceMinor",currency,term_months as "termMonths",expires_at as "expiresAt" from expert_campaign_quotes where id=${started.resultId ?? null}::uuid and user_id=${started.userId}::uuid`,
          )
        ).rows[0];
        if (!prior) invalid("card_main_replay_unavailable");
        return {
          ...prior!,
          expiresAt: iso(prior!.expiresAt),
          revision: gate.revision,
          replay: true,
        };
      }
      const quote = await new PostgresExpertCampaignQuoteRepository(
        this.db,
      ).createQuoteInTransaction(tx, {
        userId: started.userId,
        tariffVersionId: input.tariffVersionId,
        termMonths: input.termMonths,
        idempotencyKey: `card-quote:${input.requestKey}`,
      });
      await finishCardRequest(tx, started, quote.id);
      return {
        id: quote.id,
        priceMinor: quote.priceMinor,
        currency: quote.currency,
        termMonths: quote.termMonths,
        expiresAt: quote.expiresAt,
        revision: gate.revision,
        replay: false,
      };
    });
  }
  async acceptMain(raw: MainCardAcceptanceCommand) {
    const input = parseMainCardCommand(raw, "accept");
    return this.transaction(async (tx) => {
      const started = await beginCardRequest(tx, input, "main_accept", {
        quoteId: input.quoteId,
        revision: input.revision,
      });
      const gate = await lockMainFrameGate(
        tx,
        started.userId,
        input,
        input.revision,
      );
      if (
        gate.messagingConsentPolicyVersion !==
        this.policy.messagingConsentPolicyVersion
      )
        invalid("card_main_forbidden");
      if (started.replay) {
        const prior = (
          await tx.execute<{
            acceptanceId: string;
            quoteId: string;
            revision: number;
          }>(
            sql`select id as "acceptanceId",quote_id as "quoteId",revision from expert_card_main_acceptances where id=${started.resultId ?? null}::uuid and user_id=${started.userId}::uuid`,
          )
        ).rows[0];
        if (!prior) invalid("card_main_replay_unavailable");
        return { ...prior!, replay: true };
      }
      const quote = (
        await tx.execute<{ id: string }>(
          sql`select id from expert_campaign_quotes where id=${input.quoteId}::uuid and user_id=${started.userId}::uuid for share`,
        )
      ).rows[0];
      const valid =
        quote &&
        (
          await tx.execute<{ valid: boolean }>(
            sql`select quoted_at<=clock_timestamp() and expires_at>clock_timestamp() as valid from expert_campaign_quotes where id=${quote.id}::uuid`,
          )
        ).rows[0]?.valid;
      if (valid !== true) invalid("card_main_quote_expired_or_unavailable");
      // Creating a private inactive expert identity grants no API or paid access.
      await tx.execute(
        sql`insert into experts(user_id,active,verified) values(${started.userId}::uuid,false,false) on conflict(user_id) do nothing`,
      );
      const expert = (
        await tx.execute<{ id: string }>(
          sql`select id from experts where user_id=${started.userId}::uuid for update`,
        )
      ).rows[0];
      if (!expert) invalid("card_main_forbidden");
      const accepted =
        (
          await tx.execute<{ id: string }>(
            sql`insert into expert_card_main_acceptances(application_id,application_audit_id,user_id,expert_id,review_id,review_audit_id,revision,public_digest,quote_id,created_at) values(${gate.applicationId}::uuid,${gate.applicationId}::uuid,${started.userId}::uuid,${expert!.id}::uuid,${gate.reviewId}::uuid,${gate.reviewId}::uuid,${gate.revision},${gate.publicDigest},${input.quoteId}::uuid,clock_timestamp()) on conflict(user_id,review_audit_id,quote_id) do nothing returning id`,
          )
        ).rows[0] ??
        (
          await tx.execute<{ id: string }>(
            sql`select id from expert_card_main_acceptances where user_id=${started.userId}::uuid and review_audit_id=${gate.reviewId}::uuid and quote_id=${input.quoteId}::uuid`,
          )
        ).rows[0];
      if (!accepted) invalid("card_main_storage_unavailable");
      await finishCardRequest(tx, started, accepted!.id);
      return {
        acceptanceId: accepted!.id,
        quoteId: input.quoteId,
        revision: gate.revision,
        replay: false,
      };
    });
  }
  private async checkoutBinding(
    tx: ExpertCardTransaction,
    input: MainCardCheckoutCommand,
    orderId: string,
  ): Promise<MainCardCheckoutBinding> {
    const admission = await beginMainCardCheckout(tx, input, this.policy);
    await assertMainCardPriorOrder(tx, admission, orderId);
    const row = (
      await tx.execute<{
        orderId: string;
        userId: string;
        expertId: string;
        amountMinor: string;
        currency: "RUB";
        providerMode: "test" | "live";
        paymentDeadline: string | Date;
      }>(
        sql`select o.id as "orderId",m.user_id as "userId",o.expert_id as "expertId",o.cash_minor::text as "amountMinor",o.currency,m.provider_mode as "providerMode",o.payment_deadline as "paymentDeadline" from expert_residency_orders o join expert_card_main_orders m on m.order_id=o.id where o.id=${orderId}::uuid and m.user_id=${admission.request.userId}::uuid and m.acceptance_id=${admission.acceptance.id}::uuid and m.purpose='main_residency' and m.provider_mode=${this.policy.providerMode} and o.status='payment_pending' for update of o,m`,
      )
    ).rows[0];
    // Compare after all owner/card/order locks, preserving PostgreSQL precision.
    const valid =
      row &&
      (
        await tx.execute<{ valid: boolean }>(
          sql`select payment_deadline>clock_timestamp() as valid from expert_residency_orders where id=${orderId}::uuid and status='payment_pending'`,
        )
      ).rows[0]?.valid;
    if (valid !== true) invalid("card_main_checkout_unavailable");
    await finishMainCardCheckout(tx, admission, orderId);
    return Object.freeze({
      ...row!,
      paymentDeadline: iso(row!.paymentDeadline),
      purpose: "main_residency" as const,
      idempotencyKey: `card-main-checkout:${orderId}`,
    });
  }
  async checkoutBindingForOwner(
    raw: MainCardCheckoutCommand,
    orderId: string,
  ): Promise<MainCardCheckoutBinding> {
    const input = parseMainCardCommand(raw, "checkout");
    if (typeof orderId !== "string" || !uuid.test(orderId))
      invalid("card_main_invalid_request");
    const storedOrderId = orderId.toLowerCase();
    return this.transaction((tx) =>
      this.checkoutBinding(tx, input, storedOrderId),
    );
  }
  async verifyMainCheckoutForOwner(
    raw: MainCardCheckoutCommand,
    orderId: string,
    paymentId: string,
  ): Promise<boolean> {
    const input = parseMainCardCommand(raw, "checkout");
    if (typeof orderId !== "string" || !uuid.test(orderId))
      invalid("card_main_invalid_request");
    if (
      typeof paymentId !== "string" ||
      !/^[A-Za-z0-9_-]{1,64}$/u.test(paymentId)
    )
      return false;
    const storedOrderId = orderId.toLowerCase();
    return this.transaction(async (tx) => {
      const binding = await this.checkoutBinding(tx, input, storedOrderId);
      const operation = (
        await tx.execute<{ id: string }>(
          sql`select id from expert_residency_provider_operations where order_id=${binding.orderId}::uuid and provider='yookassa' and operation_kind='create_payment' and environment_mode=${binding.providerMode} and provider_object_id=${paymentId} and amount_minor=${binding.amountMinor}::bigint and currency=${binding.currency} and status in('pending','unknown_outcome','succeeded') for share`,
        )
      ).rows[0];
      // Provider lookup can itself wait: a link is never returned after expiry.
      const valid = (
        await tx.execute<{ valid: boolean }>(
          sql`select payment_deadline>clock_timestamp() as valid from expert_residency_orders where id=${binding.orderId}::uuid and status='payment_pending'`,
        )
      ).rows[0]?.valid;
      return !!operation && valid === true;
    });
  }
  async createMainInvoice(raw: MainCardCheckoutCommand) {
    const input = parseMainCardCommand(raw, "checkout");
    const order = await new PostgresExpertCampaignOrderRepository(
      this.db,
    ).createOnboardingCheckoutOrder(input, this.policy);
    return {
      orderId: order.id,
      quoteId: order.quoteId,
      revision: order.revision,
      priceMinor: order.priceMinor,
      cashMinor: order.cashMinor,
      currency: order.currency,
      status: order.status,
      paymentDeadline: order.paymentDeadline,
      replay: order.replay,
    };
  }
}
