import { sql } from "drizzle-orm";
import type {
  EncryptedYooKassaReceiptContact,
  YooKassaReceiptContactAuthority,
} from "@ii-tonya/integrations";
import type { DrizzleDb } from "../client.js";
import { currentConsentGrantedSql } from "./consent-current.js";

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const CONFIG_VALUE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;

interface StoredContact extends Record<string, unknown> {
  contactId: string;
  contactKind: "email" | "phone";
  ciphertext: string;
  keyReference: string;
  consentDecision: "granted" | "denied";
  consentPurpose: string;
  policyVersion: string;
  verifiedAt: Date | string | null;
  revokedAt: Date | string | null;
}

export class PostgresYooKassaReceiptContactAuthority implements YooKassaReceiptContactAuthority {
  constructor(private readonly db: Pick<DrizzleDb, "execute">) {}

  async latestForOrder(
    orderId: string,
    consentPurpose: string,
    policyVersion: string,
  ): Promise<EncryptedYooKassaReceiptContact | null> {
    if (
      typeof orderId !== "string" ||
      UUID.exec(orderId)?.[0] !== orderId ||
      typeof consentPurpose !== "string" ||
      CONFIG_VALUE.exec(consentPurpose)?.[0] !== consentPurpose ||
      typeof policyVersion !== "string" ||
      CONFIG_VALUE.exec(policyVersion)?.[0] !== policyVersion
    )
      return null;
    const result = await this.db.execute<StoredContact>(sql`
      select contact.id::text as "contactId",
        contact.contact_kind as "contactKind",
        contact.ciphertext,
        contact.key_reference as "keyReference",
        consent.decision as "consentDecision",
        consent.consent_type as "consentPurpose",
        consent.policy_version as "policyVersion",
        contact.verified_at as "verifiedAt",
        contact.revoked_at as "revokedAt"
      from expert_residency_orders residency_order
      join experts expert on expert.id = residency_order.expert_id
      left join expert_campaign_quotes quote
        on residency_order.commercial_policy_version = 'expert_campaign_v1'
        and quote.id = residency_order.campaign_quote_id
        and row(residency_order.tariff_version_id, residency_order.campaign_term_months,
          residency_order.snapshot_display_name, residency_order.price_minor,
          residency_order.currency, residency_order.duration_seconds,
          residency_order.credit_cap_bps, residency_order.individual_services_enabled,
          residency_order.group_event_limit, residency_order.statistics_level,
          residency_order.support_priority, residency_order.provider_deadline)
        = row(quote.tariff_version_id, quote.term_months, quote.display_name,
          quote.price_minor, quote.currency, quote.duration_seconds, quote.credit_cap_bps,
          quote.individual_services_enabled, quote.group_event_limit,
          quote.statistics_level, quote.support_priority, quote.expires_at)
      -- Campaign payer identity belongs to the immutable quote. Never coalesce
      -- a missing/mismatched quote to the expert's mutable current owner.
      -- Historical policies lack this snapshot and retain their legacy lookup.
      join users subject on subject.id = case
        when residency_order.commercial_policy_version = 'expert_campaign_v1'
          then quote.user_id
        else expert.user_id
      end and subject.active = true
      -- Select the latest purpose contact BEFORE validating its evidence. A bad
      -- or denied newest row must not uncover an older eligible contact.
      join lateral (
        select candidate.* from expert_residency_receipt_contacts candidate
        where candidate.user_id = subject.id
          and candidate.consent_purpose = ${consentPurpose}
        order by candidate.created_at desc, candidate.id desc
        limit 1
      ) contact on true
      join consents consent on consent.id = contact.consent_id
        and consent.user_id = contact.user_id
        and consent.decision = contact.consent_decision
        and consent.consent_type = contact.consent_purpose
        and consent.policy_version = contact.policy_version
      where residency_order.id = ${orderId}::uuid
        and consent.consent_type = ${consentPurpose}
        and consent.policy_version = ${policyVersion}
        and consent.decision = 'granted'
        and contact.verified_at is not null
        and contact.revoked_at is null
        and consent.created_at = (
          select max(candidate.created_at) from consents candidate
          where candidate.user_id = subject.id
            and candidate.consent_type = ${consentPurpose}
        )
        and ${currentConsentGrantedSql({
          userExpression: sql`subject.id`,
          purpose: consentPurpose,
          policyVersion: sql`${policyVersion}`,
        })}
    `);
    const row = result.rows[0];
    return row === undefined
      ? null
      : {
          ...row,
          verifiedAt:
            row.verifiedAt === null
              ? null
              : new Date(row.verifiedAt).toISOString(),
          revokedAt:
            row.revokedAt === null
              ? null
              : new Date(row.revokedAt).toISOString(),
        };
  }
}
