import { sql } from "drizzle-orm";
import type { DrizzleDb } from "../client.js";
/** Legacy routing evidence only; the provider verifier still performs fresh GETs. */
export class PostgresYooKassaRefundParentBinding {
  constructor(private readonly db: DrizzleDb) {}
  async matches(refundId: string, paymentId: string): Promise<boolean> {
    const valid = /^[A-Za-z0-9_-]{1,64}$/u;
    if (!valid.test(refundId) || !valid.test(paymentId)) return false;
    const rows = (
      await this.db.execute<{ matches: boolean }>(
        sql`select exists(select 1 from expert_residency_provider_operations r join expert_residency_provider_operations p on p.order_id=r.order_id and p.provider=r.provider and p.operation_kind='create_payment' and p.provider_object_id=r.parent_payment_id and p.currency=r.currency and p.amount_minor>=r.amount_minor where r.provider='yookassa' and r.operation_kind='create_refund' and r.provider_object_id=${refundId} and r.parent_payment_id=${paymentId} and r.currency='RUB' and r.amount_minor>0) as matches`,
      )
    ).rows;
    return rows[0]?.matches === true;
  }
}
