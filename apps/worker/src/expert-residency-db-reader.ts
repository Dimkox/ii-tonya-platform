import { sql, type DrizzleDb } from "@ii-tonya/db";

export type ExpertResidencyObservedStatus =
  "settled" | "refunded" | "charged_back";

export interface ExpertResidencyObservedPaymentQuery {
  readonly provider: string;
  readonly paymentId: string;
}

export interface ExpertResidencyObservedPayment {
  readonly provider: string;
  readonly paymentId: string;
  readonly amountMinor: string;
  readonly currency: "RUB";
  readonly status: ExpertResidencyObservedStatus;
}

const MAX_BATCH = 1_000;
const money = /^(?:0|[1-9][0-9]{0,11})$/u;

/**
 * Reads provider-side truth for expert residency payments from our own DB:
 * only authenticated, identity-bound (identity_version >= 1), processed
 * provider events in expert_residency_provider_event_inbox count.
 * Status precedence: charged_back > refunded > settled. Amount is the
 * settled amount. Any ambiguity throws (fail-closed); payments without an
 * authenticated settled event are omitted and reconcile as "missing".
 */
export class PostgresExpertResidencyProviderReader {
  constructor(private readonly db: DrizzleDb) {}

  async readPayments(command: {
    readonly now: Date;
    readonly payments: readonly ExpertResidencyObservedPaymentQuery[];
  }): Promise<{
    readonly kind: "available";
    readonly payments: readonly ExpertResidencyObservedPayment[];
  }> {
    if (
      !Number.isFinite(command.now.getTime()) ||
      command.payments.length > MAX_BATCH
    ) {
      throw new Error("invalid_expert_residency_provider_read");
    }
    if (command.payments.length === 0)
      return { kind: "available", payments: [] };
    const pairs = JSON.stringify(
      command.payments.map((p) => ({
        provider: p.provider,
        paymentId: p.paymentId,
      })),
    );
    const result = await this.db.execute<{
      provider: string;
      paymentId: string;
      settledAmounts: string[] | null;
      currencies: string[] | null;
      kinds: string[];
    }>(sql`
      select
        e.provider,
        e.payment_id as "paymentId",
        array_agg(distinct e.amount_minor::text)
          filter (where e.event_kind = 'settled') as "settledAmounts",
        array_agg(distinct coalesce(e.currency, ''))
          filter (where e.event_kind = 'settled') as "currencies",
        array_agg(distinct e.event_kind) as kinds
      from expert_residency_provider_event_inbox e
      join (
        select distinct provider, "paymentId"
        from jsonb_to_recordset(${pairs}::jsonb) as r(provider text, "paymentId" text)
      ) q on q.provider = e.provider and q."paymentId" = e.payment_id
      where e.authenticated = true
        and e.identity_version >= 1
        and e.status = 'processed'
        and e.event_kind in ('settled', 'refunded', 'charged_back')
        and coalesce(e.occurred_at, e.received_at) <= ${command.now}
      group by e.provider, e.payment_id
    `);
    const payments: ExpertResidencyObservedPayment[] = [];
    for (const row of result.rows) {
      const amounts = row.settledAmounts ?? [];
      if (amounts.length === 0) continue;
      if (amounts.length !== 1 || !money.test(amounts[0]!)) {
        throw new Error("ambiguous_expert_residency_provider_amount");
      }
      const currencies = row.currencies ?? [];
      if (currencies.length !== 1 || currencies[0] !== "RUB") {
        throw new Error("invalid_expert_residency_provider_currency");
      }
      const status: ExpertResidencyObservedStatus = row.kinds.includes(
        "charged_back",
      )
        ? "charged_back"
        : row.kinds.includes("refunded")
          ? "refunded"
          : "settled";
      payments.push({
        provider: row.provider,
        paymentId: row.paymentId,
        amountMinor: amounts[0]!,
        currency: "RUB",
        status,
      });
    }
    return { kind: "available", payments };
  }
}
