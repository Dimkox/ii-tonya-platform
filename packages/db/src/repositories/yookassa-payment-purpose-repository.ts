import { sql } from "drizzle-orm";
import type { DrizzleDb } from "../client.js";
/** Additive product names over immutable legacy financial bindings. Never inspect webhook metadata. */
export type BoundYooKassaPaymentPurpose =
  "ONBOARDING_FEE" | "MAIN_SUBSCRIPTION";
export class PostgresYooKassaPaymentPurposeRepository {
  constructor(private readonly db: DrizzleDb) {}
  async resolvePurpose(
    providerObjectId: string,
    event:
      | "payment.succeeded"
      | "payment.canceled"
      | "payment.waiting_for_capture"
      | "refund.succeeded",
  ): Promise<BoundYooKassaPaymentPurpose | null> {
    if (!/^[A-Za-z0-9_-]{1,64}$/u.test(providerObjectId))
      throw new Error("payment_purpose_invalid");
    const kind =
      event === "refund.succeeded" ? "create_refund" : "create_payment";
    const rows = (
      await this.db.execute<{ purpose: BoundYooKassaPaymentPurpose }>(sql`
      select 'ONBOARDING_FEE'::text as purpose from expert_onboarding_payment_operations op
      join expert_onboarding_invoices i on i.id=op.invoice_id
      where ${kind}='create_payment' and op.provider_object_id=${providerObjectId}
        and i.purpose='onboarding' and i.amount_minor=300000 and i.currency='RUB'
      union all
      select 'MAIN_SUBSCRIPTION'::text as purpose from expert_residency_provider_operations op
      join expert_residency_orders o on o.id=op.order_id
      where op.provider='yookassa' and op.provider_object_id=${providerObjectId} and op.operation_kind=${kind}
        and op.currency='RUB' and op.amount_minor>0
    `)
    ).rows;
    if (rows.length > 1) throw new Error("payment_purpose_ambiguous");
    return rows[0]?.purpose ?? null;
  }
}
