import type { DrizzleDb } from "../client.js";
import { sql } from "drizzle-orm";
import { quoteResidency } from "@ii-tonya/domain";
import { lockClientConsentSubject } from "./client-consent-authority.js";
import { expireLockedExpertResidencyOrder } from "./expert-residency-repository.js";
import { PostgresExpertReferralControlRepository } from "./expert-referral-control-repository.js";
import type { PayerReceiptVault } from "@ii-tonya/integrations";
import {
  lockPayerReceiptSelection,
  PayerReceiptError,
} from "./payer-receipt-contact-repository.js";

export interface CreateExpertCampaignOrder {
  userId: string;
  expertId: string;
  quoteId: string;
  idempotencyKey: string;
}
export interface ExpertCampaignOrder {
  id: string;
  expertId: string;
  quoteId: string;
  tariffVersionId: string;
  displayName: string;
  priceMinor: string;
  creditMinor: string;
  cashMinor: string;
  currency: "RUB";
  commercialPolicyVersion: "expert_campaign_v1";
  termMonths: 1 | 3;
  durationSeconds: number;
  creditCapBps: number;
  individualServicesEnabled: boolean;
  groupEventLimit: number;
  statisticsLevel: "basic" | "expanded";
  supportPriority: "standard" | "priority";
  status:
    | "quoted"
    | "payment_pending"
    | "settled"
    | "failed"
    | "expired"
    | "refunded"
    | "charged_back";
  createdAt: string;
  paymentDeadline: string;
  providerDeadline: string;
  allocations: readonly { grantId: string; amountMinor: string }[];
}
export type ExpertCampaignOrderErrorCode =
  | "EXPERT_CAMPAIGN_INVALID_INPUT"
  | "EXPERT_CAMPAIGN_DISABLED"
  | "EXPERT_CAMPAIGN_OWNER_INELIGIBLE"
  | "EXPERT_CAMPAIGN_IDEMPOTENCY_CONFLICT"
  | "QUOTE_ALREADY_USED"
  | "EXPERT_CAMPAIGN_QUOTE_UNAVAILABLE"
  | "EXPERT_CAMPAIGN_QUOTE_EXPIRED"
  | "EXPERT_CAMPAIGN_TARIFF_INACTIVE"
  | "EXPERT_CAMPAIGN_CONTENTION"
  | "EXPERT_CAMPAIGN_STORAGE";
export class ExpertCampaignOrderError extends Error {
  constructor(readonly code: ExpertCampaignOrderErrorCode) {
    super(code);
    this.name = "ExpertCampaignOrderError";
  }
}
export class PostgresExpertCampaignOrderRepository {
  constructor(
    private readonly db: DrizzleDb,
    private readonly receiptVault?: PayerReceiptVault,
  ) {}
  async createCheckoutOrder(
    input: CreateExpertCampaignOrder,
  ): Promise<ExpertCampaignOrder> {
    const command = parseCommand(input);
    return this.createOrder(command);
  }
  async createCheckoutOrderWithReceipt(
    input: CreateExpertCampaignOrder & { receiptContactId: string },
  ): Promise<ExpertCampaignOrder> {
    if (
      !input ||
      typeof input !== "object" ||
      Array.isArray(input) ||
      typeof input.receiptContactId !== "string" ||
      input.receiptContactId.length !== 36 ||
      !uuid.test(input.receiptContactId)
    )
      throw new ExpertCampaignOrderError("EXPERT_CAMPAIGN_INVALID_INPUT");
    const { receiptContactId, ...base } = input;
    return this.createOrder(parseCommand(base), receiptContactId.toLowerCase());
  }
  private async createOrder(
    command: CreateExpertCampaignOrder,
    receiptContactId?: string,
  ): Promise<ExpertCampaignOrder> {
    // Only this branch retries lock/deadlock failures. Every attempt owns a new
    // transaction, snapshot and all locks, including implicit FK row locks.
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        return await this.db.transaction(
          async (tx) => {
            await tx.execute(sql`set local lock_timeout = '250ms'`);
            await lockClientConsentSubject(tx, command.userId);
            const user = (
              await tx.execute<{ active: boolean }>(
                sql`select active from users where id=${command.userId}::uuid for share`,
              )
            ).rows[0];
            if (!user?.active)
              throw new ExpertCampaignOrderError(
                "EXPERT_CAMPAIGN_OWNER_INELIGIBLE",
              );
            const control = await new PostgresExpertReferralControlRepository(
              this.db,
            ).lockFeatureControl(tx);
            if (!control.newCommandsEnabled)
              throw new ExpertCampaignOrderError("EXPERT_CAMPAIGN_DISABLED");
            // Same canonical namespace and control -> expert order as V1/V2.
            await tx.execute(
              sql`select pg_advisory_xact_lock(hashtextextended(${command.expertId},0))`,
            );
            const expert = (
              await tx.execute<{
                userId: string;
                active: boolean;
                verified: boolean;
              }>(
                sql`select user_id as "userId",active,verified from experts where id=${command.expertId}::uuid for update`,
              )
            ).rows[0];
            if (
              !expert?.active ||
              !expert.verified ||
              expert.userId !== command.userId
            )
              throw new ExpertCampaignOrderError(
                "EXPERT_CAMPAIGN_OWNER_INELIGIBLE",
              );
            const prior = (
              await tx.execute<OrderRow>(
                sql`select ${orderColumns} from expert_residency_orders where expert_id=${command.expertId}::uuid and idempotency_key=${command.idempotencyKey} for update`,
              )
            ).rows[0];
            if (prior) {
              if (
                prior.commercialPolicyVersion !== "expert_campaign_v1" ||
                prior.quoteId !== command.quoteId
              )
                throw new ExpertCampaignOrderError(
                  "EXPERT_CAMPAIGN_IDEMPOTENCY_CONFLICT",
                );
              // Expert ownership can change independently of the immutable
              // quote. Current expert eligibility alone does not authorize a
              // different user to replay the original owner's purchase.
              const quoteOwner = (
                await tx.execute<{ userId: string }>(
                  sql`select user_id as "userId" from expert_campaign_quotes where id=${command.quoteId}::uuid for share`,
                )
              ).rows[0];
              if (quoteOwner?.userId !== command.userId)
                throw new ExpertCampaignOrderError(
                  "EXPERT_CAMPAIGN_QUOTE_UNAVAILABLE",
                );
              if (receiptContactId !== undefined) {
                const selected = (
                  await tx.execute<{ contactId: string }>(
                    sql`select contact_id as "contactId" from payer_receipt_order_bindings where order_id=${prior.id}::uuid and user_id=${command.userId}::uuid and quote_id=${command.quoteId}::uuid`,
                  )
                ).rows[0];
                if (selected?.contactId !== receiptContactId)
                  throw new ExpertCampaignOrderError(
                    "EXPERT_CAMPAIGN_IDEMPOTENCY_CONFLICT",
                  );
                // Replaying this immutable selection does not disclose it.
                // Fresh orders still require a live, decryptable contact below.
              }
              // Return the committed expiry, never throw after the release and undo it.
              if (
                await expireLockedExpertResidencyOrder(
                  tx,
                  prior,
                  sql`clock_timestamp()`,
                )
              )
                prior.status = "expired";
              return hydrate(tx, prior);
            }
            const used = (
              await tx.execute<{ id: string }>(
                sql`select id from expert_residency_orders where campaign_quote_id=${command.quoteId}::uuid`,
              )
            ).rows[0];
            const quote = (
              await tx.execute<QuoteRow>(
                sql`select id,user_id as "userId",tariff_version_id as "tariffVersionId",expires_at as "expiresAt",quoted_at as "quotedAt",term_months as "termMonths",duration_seconds as "durationSeconds",price_minor::text as "priceMinor",currency,display_name as "displayName",credit_cap_bps as "creditCapBps",individual_services_enabled as "individualServicesEnabled",group_event_limit as "groupEventLimit",statistics_level as "statisticsLevel",support_priority as "supportPriority" from expert_campaign_quotes where id=${command.quoteId}::uuid for share`,
              )
            ).rows[0];
            if (!quote || quote.userId !== command.userId)
              throw new ExpertCampaignOrderError(
                "EXPERT_CAMPAIGN_QUOTE_UNAVAILABLE",
              );
            if (used) throw new ExpertCampaignOrderError("QUOTE_ALREADY_USED");
            if (receiptContactId !== undefined)
              await lockPayerReceiptSelection(
                tx,
                { ...command, receiptContactId },
                this.receiptVault,
              );
            const tariff = (
              await tx.execute<{
                policy: string;
                activeFrom: string;
                activeTo: string;
              }>(
                sql`select commercial_policy_version policy,active_from as "activeFrom",active_to as "activeTo" from expert_residency_tariff_versions where id=${quote.tariffVersionId}::uuid for share`,
              )
            ).rows[0];
            // Do not filter by transaction_timestamp before a possible wait. All
            // grants are locked first; only a fresh post-lock clock selects credit.
            const grants = (
              await tx.execute<{
                id: string;
                expiresAt: string;
                remainingMinor: string;
              }>(
                sql`select g.id,g.expires_at as "expiresAt",coalesce((select sum(a.amount_minor) from expert_referral_ledger_allocations a where a.reward_grant_id=g.id),0)::bigint::text as "remainingMinor" from expert_referral_reward_grants g where g.expert_id=${command.expertId}::uuid order by g.expires_at,g.granted_at,g.id for update of g`,
              )
            ).rows;
            const clock = (
              await tx.execute<{
                now: string;
                quoteValid: boolean;
                tariffValid: boolean;
              }>(
                sql`with clock as materialized (select clock_timestamp() now) select clock.now as now, q.quoted_at<=clock.now and clock.now<q.expires_at as "quoteValid",t.active_from<=clock.now and clock.now<t.active_to as "tariffValid" from clock,expert_campaign_quotes q,expert_residency_tariff_versions t where q.id=${quote.id}::uuid and t.id=${quote.tariffVersionId}::uuid`,
              )
            ).rows[0];
            if (!clock)
              throw new ExpertCampaignOrderError("EXPERT_CAMPAIGN_STORAGE");
            if (!clock.quoteValid)
              throw new ExpertCampaignOrderError(
                "EXPERT_CAMPAIGN_QUOTE_EXPIRED",
              );
            if (
              !tariff ||
              tariff.policy !== "expert_residency_v2" ||
              !clock.tariffValid
            )
              throw new ExpertCampaignOrderError(
                "EXPERT_CAMPAIGN_TARIFF_INACTIVE",
              );
            const createdAt = new Date(clock.now);
            // Preserve PostgreSQL microseconds for credit expiry and persisted
            // deadlines; Date is only the millisecond DTO/creation convention.
            const liveIds = new Set(
              (
                await tx.execute<{ id: string }>(
                  sql`select id from expert_referral_reward_grants where expert_id=${command.expertId}::uuid and expires_at > ${clock.now}::timestamptz`,
                )
              ).rows.map((g) => g.id),
            );
            const liveGrants = grants.filter(
              (g) => liveIds.has(g.id) && BigInt(g.remainingMinor) > 0n,
            );
            const amounts = quoteResidency(
              BigInt(quote.priceMinor),
              liveGrants.reduce((n, g) => n + BigInt(g.remainingMinor), 0n),
              quote.creditCapBps,
            );
            let remaining = amounts.creditMinor;
            const allocations: { grantId: string; amountMinor: bigint }[] = [];
            for (const grant of liveGrants) {
              if (remaining === 0n) break;
              const amount =
                BigInt(grant.remainingMinor) < remaining
                  ? BigInt(grant.remainingMinor)
                  : remaining;
              allocations.push({ grantId: grant.id, amountMinor: amount });
              remaining -= amount;
            }
            const deadline =
              allocations.length === 0
                ? sql`${quote.expiresAt}::timestamptz`
                : sql`(select least(${quote.expiresAt}::timestamptz,min(expires_at)) from expert_referral_reward_grants where id in (${sql.join(
                    allocations.map((a) => sql`${a.grantId}::uuid`),
                    sql`, `,
                  )}))`;
            const saved = (
              await tx.execute<{ id: string }>(
                sql`insert into expert_residency_orders (expert_id,tariff_version_id,campaign_quote_id,campaign_term_months,snapshot_display_name,price_minor,currency,duration_seconds,credit_minor,cash_minor,commercial_policy_version,credit_cap_bps,individual_services_enabled,group_event_limit,statistics_level,support_priority,payment_deadline,provider_deadline,status,idempotency_key,created_at,updated_at) values (${command.expertId}::uuid,${quote.tariffVersionId}::uuid,${quote.id}::uuid,${quote.termMonths},${quote.displayName},${quote.priceMinor}::bigint,${quote.currency},${quote.durationSeconds},${amounts.creditMinor},${amounts.cashMinor},'expert_campaign_v1',${quote.creditCapBps},${quote.individualServicesEnabled},${quote.groupEventLimit},${quote.statisticsLevel},${quote.supportPriority},${deadline},${quote.expiresAt}::timestamptz,'payment_pending',${command.idempotencyKey},${createdAt.toISOString()}::timestamptz,${createdAt.toISOString()}::timestamptz) returning id`,
              )
            ).rows[0];
            if (!saved)
              throw new ExpertCampaignOrderError("EXPERT_CAMPAIGN_STORAGE");
            if (receiptContactId !== undefined)
              await tx.execute(
                sql`insert into payer_receipt_order_bindings(order_id,contact_id,quote_id,user_id) values(${saved.id}::uuid,${receiptContactId}::uuid,${command.quoteId}::uuid,${command.userId}::uuid)`,
              );
            if (amounts.creditMinor > 0n) {
              const entry = (
                await tx.execute<{ id: string }>(
                  sql`insert into expert_referral_ledger_entries(expert_id,entry_kind,amount_minor,order_id,source_type,source_id,idempotency_key) values(${command.expertId}::uuid,'reservation',${-amounts.creditMinor},${saved.id}::uuid,'residency_order',${saved.id}::uuid,${`checkout:${command.expertId}:${command.idempotencyKey}`}) returning id`,
                )
              ).rows[0];
              if (!entry)
                throw new ExpertCampaignOrderError("EXPERT_CAMPAIGN_STORAGE");
              for (const allocation of allocations)
                await tx.execute(
                  sql`insert into expert_referral_ledger_allocations(ledger_entry_id,reward_grant_id,expert_id,amount_minor) values(${entry.id}::uuid,${allocation.grantId}::uuid,${command.expertId}::uuid,${-allocation.amountMinor})`,
                );
            }
            const row = (
              await tx.execute<OrderRow>(
                sql`select ${orderColumns} from expert_residency_orders where id=${saved.id}::uuid`,
              )
            ).rows[0];
            if (!row)
              throw new ExpertCampaignOrderError("EXPERT_CAMPAIGN_STORAGE");
            return hydrate(tx, row);
          },
          { isolationLevel: "serializable" },
        );
      } catch (error) {
        if (error instanceof ExpertCampaignOrderError) throw error;
        if (error instanceof PayerReceiptError)
          throw new ExpertCampaignOrderError(
            "EXPERT_CAMPAIGN_QUOTE_UNAVAILABLE",
          );
        const pg = pgFailure(error);
        if (["40001", "55P03", "40P01"].includes(pg?.code ?? "")) {
          if (attempt < 2) continue;
          throw new ExpertCampaignOrderError("EXPERT_CAMPAIGN_CONTENTION");
        }
        if (pg?.constraint === "expert_campaign_order_quote_unique")
          throw new ExpertCampaignOrderError("QUOTE_ALREADY_USED");
        if (pg?.constraint === "expert_orders_expert_idempotency_unique")
          throw new ExpertCampaignOrderError(
            "EXPERT_CAMPAIGN_IDEMPOTENCY_CONFLICT",
          );
        if (pg?.constraint === "expert_campaign_order_expired")
          throw new ExpertCampaignOrderError("EXPERT_CAMPAIGN_QUOTE_EXPIRED");
        // No driver message, SQL, input or cause crosses the repository boundary.
        throw new ExpertCampaignOrderError("EXPERT_CAMPAIGN_STORAGE");
      }
    }
    throw new ExpertCampaignOrderError("EXPERT_CAMPAIGN_CONTENTION");
  }
}

const uuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
function parseCommand(
  input: CreateExpertCampaignOrder,
): CreateExpertCampaignOrder {
  const keys = ["userId", "expertId", "quoteId", "idempotencyKey"];
  if (
    !input ||
    typeof input !== "object" ||
    Array.isArray(input) ||
    Object.keys(input).length !== 4 ||
    Object.keys(input).some((k) => !keys.includes(k)) ||
    [input.userId, input.expertId, input.quoteId].some(
      (v) => typeof v !== "string" || v.length !== 36 || !uuid.test(v),
    ) ||
    typeof input.idempotencyKey !== "string" ||
    !/^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/u.test(input.idempotencyKey) ||
    input.idempotencyKey.trim() !== input.idempotencyKey
  )
    throw new ExpertCampaignOrderError("EXPERT_CAMPAIGN_INVALID_INPUT");
  return {
    userId: input.userId.toLowerCase(),
    expertId: input.expertId.toLowerCase(),
    quoteId: input.quoteId.toLowerCase(),
    idempotencyKey: input.idempotencyKey,
  };
}
function pgFailure(
  error: unknown,
): { code: string; constraint?: string } | undefined {
  if (typeof error !== "object" || !error) return;
  if ("code" in error && typeof error.code === "string")
    return {
      code: error.code,
      ...("constraint" in error && typeof error.constraint === "string"
        ? { constraint: error.constraint }
        : {}),
    };
  return "cause" in error ? pgFailure(error.cause) : undefined;
}
type OrderRow = Omit<ExpertCampaignOrder, "allocations"> &
  Record<string, unknown>;
type QuoteRow = Pick<
  ExpertCampaignOrder,
  | "tariffVersionId"
  | "termMonths"
  | "durationSeconds"
  | "priceMinor"
  | "currency"
  | "displayName"
  | "creditCapBps"
  | "individualServicesEnabled"
  | "groupEventLimit"
  | "statisticsLevel"
  | "supportPriority"
> & {
  id: string;
  userId: string;
  expiresAt: string;
  quotedAt: string;
} & Record<string, unknown>;
const orderColumns = sql`id,expert_id as "expertId",campaign_quote_id as "quoteId",tariff_version_id as "tariffVersionId",campaign_term_months as "termMonths",snapshot_display_name as "displayName",price_minor::text as "priceMinor",credit_minor::text as "creditMinor",cash_minor::text as "cashMinor",currency,duration_seconds as "durationSeconds",commercial_policy_version as "commercialPolicyVersion",credit_cap_bps as "creditCapBps",individual_services_enabled as "individualServicesEnabled",group_event_limit as "groupEventLimit",statistics_level as "statisticsLevel",support_priority as "supportPriority",status,payment_deadline as "paymentDeadline",provider_deadline as "providerDeadline",created_at as "createdAt"`;
async function hydrate(
  tx: Pick<DrizzleDb, "execute">,
  row: OrderRow,
): Promise<ExpertCampaignOrder> {
  const allocations = (
    await tx.execute<{ grantId: string; amountMinor: string }>(
      sql`select a.reward_grant_id as "grantId",(-a.amount_minor)::text as "amountMinor" from expert_referral_ledger_entries e join expert_referral_ledger_allocations a on a.ledger_entry_id=e.id join expert_referral_reward_grants g on g.id=a.reward_grant_id where e.order_id=${row.id}::uuid and e.entry_kind='reservation' order by g.expires_at,g.granted_at,g.id`,
    )
  ).rows;
  return {
    ...row,
    createdAt: new Date(row.createdAt).toISOString(),
    paymentDeadline: new Date(row.paymentDeadline).toISOString(),
    providerDeadline: new Date(row.providerDeadline).toISOString(),
    allocations,
  };
}
