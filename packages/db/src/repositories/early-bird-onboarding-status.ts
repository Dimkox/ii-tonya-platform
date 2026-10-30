import { sql } from "drizzle-orm";
import type { DrizzleDb } from "../client.js";
import { lockClientConsentSubject } from "./client-consent-authority.js";

type Transaction = Parameters<Parameters<DrizzleDb["transaction"]>[0]>[0];

/** Read-only projection of already verified facts. It neither issues invoices nor grants access. */
export class PostgresEarlyBirdOnboardingStatus {
  constructor(private readonly db: DrizzleDb) {}

  async find(userId: string): Promise<{
    status: "ONBOARDING_ONLY";
    baseId: string;
    basePriceMinor: bigint;
  } | null> {
    return this.db.transaction((tx) => this.findLocked(tx, userId));
  }

  /** Caller must retain the transaction through admission; finance writers must share the subject lock. */
  async findLocked(
    tx: Transaction,
    userId: string,
  ): Promise<{
    status: "ONBOARDING_ONLY";
    baseId: string;
    basePriceMinor: bigint;
  } | null> {
    if (
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u.test(
        userId,
      )
    )
      throw new Error("early_bird_status_identity");
    await lockClientConsentSubject(tx, userId);
    const rows = (
      await tx.execute<{ base_id: string; base_price: string }>(sql`
      select b.id as base_id, b.base_tariff_amount::text as base_price
      from expert_sales_bases b
      join users u on u.id=b.user_id and u.active
      join lateral (
        select c.choice,c.chosen_at from early_bird_choices c
        where c.base_id=b.id and c.user_id=b.user_id
        order by c.decision_no desc limit 1
      ) c on c.choice='later'
      join expert_sales_paid_locks l on l.user_id=b.user_id
      join expert_sales_selections s on s.id=l.selection_id and s.user_id=b.user_id and s.base_id=b.id
      join expert_onboarding_invoices i on i.id=l.invoice_id and i.user_id=b.user_id and i.status='settled' and i.created_at>=c.chosen_at
      join expert_onboarding_payment_facts f on f.invoice_id=i.id and f.user_id=b.user_id and f.admission='interview'
      join expert_onboarding_applications a on a.id=i.application_id and a.user_id=b.user_id and a.verification_status='approved' and a.archived_at is null and a.archive_until_date is null
      where b.user_id=${userId}::uuid
        and expert_card_current_messaging_authority(b.user_id,b.consent_version)
        and not s.promo_accepted_flag and s.term_months=1 and l.term_months=1
        and s.selected_total_minor=b.base_tariff_amount and l.final_locked_price=b.base_tariff_amount
        and not exists (select 1 from expert_residency_orders o join experts e on e.id=o.expert_id where e.user_id=b.user_id and o.status='settled')
      limit 2
      for share of u,b,l,s,i,f,a
    `)
    ).rows;
    if (rows.length !== 1 || !/^[1-9][0-9]*$/u.test(rows[0]!.base_price))
      return null;
    return {
      status: "ONBOARDING_ONLY",
      baseId: rows[0]!.base_id,
      basePriceMinor: BigInt(rows[0]!.base_price),
    };
  }
}
