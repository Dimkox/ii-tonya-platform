import {
  beginScheduledMainCheckout,
  scheduledMainInput,
} from "./expert-scheduled-main-checkout.js";
import {
  lockRenewalBillForMutation,
  acceptMainCardQuote,
} from "./expert-card-main-acceptance.js";
export * from "./expert-card-main-command.js";
import { sql } from "drizzle-orm";
import type { DrizzleDb } from "../client.js";
import {
  PostgresExpertCampaignQuoteRepository,
  ExpertCampaignQuoteError,
} from "./expert-campaign-quote-repository.js";
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
        error instanceof ExpertCampaignQuoteError &&
        error.code === "EXPERT_CAMPAIGN_TERM_UNAVAILABLE"
      )
        throw new CardMainPaymentError("card_main_term_unavailable");
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
        ...(input.renewalBillId ? { renewalBillId: input.renewalBillId } : {}),
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
      if (input.renewalBillId)
        await lockRenewalBillForMutation(
          tx,
          started.userId,
          input.renewalBillId,
        );
      const quote = await new PostgresExpertCampaignQuoteRepository(
        this.db,
      ).createCurrentQuoteInTransaction(tx, {
        userId: started.userId,
        tariffVersionId: input.tariffVersionId,
        termMonths: input.termMonths,
        idempotencyKey: `card-quote:${input.requestKey}`,
      });
      if (input.renewalBillId)
        await tx.execute(
          sql`update expert_residency_renewal_bills set quote_id=${quote.id}::uuid,acceptance_id=null,tariff_version_id=${input.tariffVersionId}::uuid,term_months=${input.termMonths} where id=${input.renewalBillId}::uuid and user_id=${started.userId}::uuid`,
        );
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
        ...(input.renewalBillId ? { renewalBillId: input.renewalBillId } : {}),
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
      const accepted = await acceptMainCardQuote(tx, {
        userId: started.userId,
        quoteId: input.quoteId,
        gate,
        ...(input.renewalBillId ? { renewalBillId: input.renewalBillId } : {}),
      });
      await finishCardRequest(tx, started, accepted!.id);
      // The genuine owner acceptance also authorizes later replacement invoice
      // issuance, never an automatic charge or a fabricated Telegram command.
      if (!input.renewalBillId)
        await tx.execute(sql`insert into expert_offer_schedules(user_id,application_id,tariff_version_id,profile_revision,term_months,source_update_id,consent_version,original_acceptance_id,revision,original_quote_id,review_id,expert_id,public_digest,bot_id,bot_key,chat_id,request_key,request_digest)
          select a.user_id,a.application_id,q.tariff_version_id,q.profile_revision,q.term_months,${input.requestKey},${gate.messagingConsentPolicyVersion},a.id,a.revision,a.quote_id,a.review_id,a.expert_id,a.public_digest,${input.botId},${input.botKey},${input.chatId},${input.requestKey},${input.requestDigest}
          from expert_card_main_acceptances a join expert_campaign_quotes q on q.id=a.quote_id and q.user_id=a.user_id where a.id=${accepted!.id}::uuid and a.user_id=${started.userId}::uuid and q.rule_version='expert_energy_start_v2'
          on conflict(user_id,source_update_id) do nothing`);
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
  async createScheduledMainInvoice(scheduleId: string, quoteId: string) {
    const input = scheduledMainInput(scheduleId, quoteId);
    const order = await new PostgresExpertCampaignOrderRepository(
      this.db,
    ).createScheduledCheckoutOrder(
      input.scheduleId,
      input.quoteId,
      this.policy,
    );
    return {
      orderId: order.id,
      quoteId: order.quoteId,
      priceMinor: order.priceMinor,
      cashMinor: order.cashMinor,
      currency: order.currency,
      status: order.status,
      paymentDeadline: order.paymentDeadline,
      replay: order.replay ?? false,
    };
  }
  async checkoutBindingForSchedule(
    scheduleId: string,
    orderId: string,
  ): Promise<MainCardCheckoutBinding> {
    scheduledMainInput(scheduleId, orderId);
    return this.transaction(async (tx) => {
      const row = (
        await tx.execute<{ quoteId: string }>(
          sql`select m.quote_id as "quoteId" from expert_card_main_orders m join expert_card_main_acceptances a on a.id=m.acceptance_id where m.order_id=${orderId}::uuid and a.offer_schedule_id=${scheduleId}::uuid and a.acceptance_source='schedule'`,
        )
      ).rows[0];
      if (!row) invalid("card_main_checkout_unavailable");
      const admission = await beginScheduledMainCheckout(
        tx,
        { scheduleId, quoteId: row!.quoteId },
        this.policy,
      );
      await assertMainCardPriorOrder(tx, admission, orderId);
      const binding = (
        await tx.execute<{
          orderId: string;
          userId: string;
          expertId: string;
          amountMinor: string;
          currency: "RUB";
          providerMode: "test" | "live";
          paymentDeadline: string | Date;
        }>(
          sql`select o.id as "orderId",m.user_id as "userId",o.expert_id as "expertId",o.cash_minor::text as "amountMinor",o.currency,m.provider_mode as "providerMode",o.payment_deadline as "paymentDeadline" from expert_residency_orders o join expert_card_main_orders m on m.order_id=o.id where o.id=${orderId}::uuid and m.acceptance_id=${admission.acceptance.id}::uuid and m.user_id=${admission.request.userId}::uuid and m.provider_mode=${this.policy.providerMode} and m.purpose='main_residency' and o.status='payment_pending' for update of o,m`,
        )
      ).rows[0];
      const valid =
        binding &&
        (
          await tx.execute<{ valid: boolean }>(
            sql`select payment_deadline>clock_timestamp() as valid from expert_residency_orders where id=${orderId}::uuid and status='payment_pending'`,
          )
        ).rows[0]?.valid;
      if (valid !== true) invalid("card_main_checkout_unavailable");
      return Object.freeze({
        ...binding!,
        paymentDeadline: iso(binding!.paymentDeadline),
        purpose: "main_residency" as const,
        idempotencyKey: `card-main-checkout:${orderId}`,
      });
    });
  }
  async verifyMainCheckoutForSchedule(
    scheduleId: string,
    orderId: string,
    paymentId: string,
  ): Promise<boolean> {
    if (
      typeof paymentId !== "string" ||
      !/^[A-Za-z0-9_-]{1,64}$/u.test(paymentId)
    )
      return false;
    const binding = await this.checkoutBindingForSchedule(scheduleId, orderId);
    return this.transaction(async (tx) => {
      const proof = (
        await tx.execute<{ valid: boolean }>(
          sql`select exists(select 1 from expert_residency_provider_operations p join expert_residency_orders o on o.id=p.order_id where p.order_id=${orderId}::uuid and p.provider='yookassa' and p.operation_kind='create_payment' and p.environment_mode=${binding.providerMode} and p.provider_object_id=${paymentId} and p.amount_minor=${binding.amountMinor}::bigint and p.currency=${binding.currency} and p.status in('pending','unknown_outcome','succeeded') and o.status='payment_pending' and o.payment_deadline>clock_timestamp()) as valid`,
        )
      ).rows[0];
      return proof?.valid === true;
    });
  }
  async acceptRenewalAndCreateInvoice(raw: MainCardAcceptanceCommand) {
    const input = parseMainCardCommand(raw, "accept");
    if (!input.renewalBillId) invalid("card_main_invalid_request");
    const { quoteId, ...frame } = input;
    return this.createMainInvoice({
      ...frame,
      renewalAcceptedQuoteId: quoteId,
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
