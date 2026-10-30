import { sql } from "drizzle-orm";
import type { DrizzleDb } from "../client.js";
import { lockClientConsentSubject } from "./client-consent-authority.js";

type Transaction = Parameters<Parameters<DrizzleDb["transaction"]>[0]>[0];
/** Read-only projection of a bound and captured deferred onboarding payment. */
export class PostgresDeferredOnboardingStatus {
  constructor(private readonly db: DrizzleDb) {}
  async find(userId: string) {
    return this.db.transaction((tx) => this.findLocked(tx, userId));
  }
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
      throw new Error("early_bird_deferred_status_identity");
    await lockClientConsentSubject(tx, userId);
    const rows = (
      await tx.execute<{ baseId: string; amount: string }>(
        sql`select a.base_id as "baseId",a.subscription_minor::text as amount from early_bird_deferred_accounts a join users u on u.id=a.user_id and u.active join expert_sales_bases b on b.id=a.base_id and b.user_id=a.user_id join early_bird_choices c on c.id=a.choice_id and c.user_id=a.user_id and c.base_id=a.base_id join early_bird_deferred_invoices i on i.account_id=a.id and i.user_id=a.user_id and i.stage='onboarding' and i.captured_at is not null join early_bird_deferred_verified_bindings p on p.invoice_id=i.id and p.user_id=i.user_id and p.provider_id=i.provider_id and p.amount_minor=i.amount_minor and p.evidence_digest=i.evidence_digest where a.user_id=${userId}::uuid and c.choice='later' and c.id=(select id from early_bird_choices where base_id=a.base_id order by decision_no desc limit 1) and expert_card_current_messaging_authority(a.user_id,b.consent_version) and early_bird_composite_qualification(a.user_id,a.choice_id) and not exists(select 1 from early_bird_deferred_invoices subscription where subscription.account_id=a.id and subscription.stage='subscription' and subscription.captured_at is not null) and not exists(select 1 from early_bird_deferred_invoices affected join early_bird_deferred_verified_refund_bindings r on r.invoice_id=affected.id and r.user_id=affected.user_id where affected.account_id=a.id and affected.user_id=a.user_id and not exists(select 1 from early_bird_deferred_refund_resolutions resolved where resolved.provider_refund_id=r.provider_refund_id and resolved.invoice_id=r.invoice_id and resolved.user_id=r.user_id)) and not exists(select 1 from expert_sales_erased_cohorts erased where erased.user_id=a.user_id) limit 2 for share of a,u,b,c,i,p`,
      )
    ).rows;
    if (rows.length !== 1 || !/^[1-9][0-9]*$/u.test(rows[0]!.amount))
      return null;
    return {
      status: "ONBOARDING_ONLY",
      baseId: rows[0]!.baseId,
      basePriceMinor: BigInt(rows[0]!.amount),
    };
  }
}
