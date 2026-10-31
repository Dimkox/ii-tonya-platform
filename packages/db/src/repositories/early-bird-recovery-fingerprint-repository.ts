import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import type { DrizzleDb } from "../client.js";
import { lockClientConsentSubject } from "./client-consent-authority.js";
type RecoveryFingerprint = {
  operationId: string;
  invoiceId: string;
  userIdSha256: string;
  grantIdSha256?: string;
  pricingPolicy: "owner_test_10_20_v1" | "wave1_standard_v1";
  priceKind: "fixed_test" | "discounted" | "full_price";
  totalMinor: string;
  mode: "test" | "live";
  createdFrom: string;
  createdBefore: string;
};
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;
const hash = (s: string) =>
  createHash("sha256").update(s, "utf8").digest("hex");
/** Read-only discovery material for an active subject. It never binds or settles payment. */
export class PostgresEarlyBirdRecoveryFingerprintRepository {
  constructor(private readonly db: DrizzleDb) {}
  async read(intentId: string): Promise<RecoveryFingerprint | null> {
    if (!uuid.test(intentId)) throw new Error("early_bird_recovery_invalid");
    return this.db.transaction(async (tx) => {
      const first = (
        await tx.execute<{ user_id: string }>(
          sql`select user_id::text from early_bird_composite_intents where id=${intentId}::uuid and status='unknown'`,
        )
      ).rows[0];
      if (!first) return null;
      await lockClientConsentSubject(tx, first.user_id);
      const row = (
        await tx.execute<{
          invoice_id: string;
          user_id: string;
          grant_id: string | null;
          policy: "owner_test_10_20_v1" | "wave1_standard_v1";
          kind: "fixed_test" | "discounted" | "full_price";
          amount: string;
          mode: "test" | "live";
          marked: string;
        }>(
          sql`select i.invoice_id::text,i.user_id::text,i.grant_id::text,i.pricing_policy as policy,i.price_kind as kind,i.total_minor::text as amount,i.provider_mode as mode,i.dispatch_marked_at::text as marked from early_bird_composite_intents i join users u on u.id=i.user_id and u.active join expert_sales_bases b on b.id=i.base_id and b.user_id=i.user_id where i.id=${intentId}::uuid and i.user_id=${first.user_id}::uuid and i.status='unknown' and i.dispatch_marked_at is not null and expert_card_current_messaging_authority(i.user_id,b.consent_version) and not exists(select 1 from expert_sales_erased_cohorts where user_id=i.user_id) for share of i,u,b`,
        )
      ).rows[0];
      if (!row) return null;
      // The immutable first-dispatch timestamp survives receipt/body TTL cleanup.
      // One POST only: provider discovery is bounded to the following day and
      // cannot itself mint another send permission. No erased archive is read.
      const marked = Date.parse(row.marked),
        from = marked - 300000,
        before = marked + 86400000 - 300000;
      if (
        !Number.isFinite(marked) ||
        before <= from ||
        before - from > 86400000
      )
        return null;
      return {
        operationId: intentId,
        invoiceId: row.invoice_id,
        userIdSha256: hash(row.user_id),
        ...(row.grant_id ? { grantIdSha256: hash(row.grant_id) } : {}),
        pricingPolicy: row.policy,
        priceKind: row.kind,
        totalMinor: row.amount,
        mode: row.mode,
        createdFrom: new Date(from).toISOString(),
        createdBefore: new Date(before).toISOString(),
      };
    });
  }
}
