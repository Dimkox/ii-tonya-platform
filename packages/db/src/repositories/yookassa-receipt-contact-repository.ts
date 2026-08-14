import { sql } from "drizzle-orm";
import type {
  EncryptedYooKassaReceiptContact,
  YooKassaReceiptContactAuthority,
} from "@ii-tonya/integrations";
import type { DrizzleDb } from "../client.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const CONFIG_VALUE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;

interface StoredContact extends Record<string, unknown> {
  contactId: string;
  contactKind: "email" | "phone";
  ciphertext: string;
  keyReference: string;
  consentDecision: "granted" | "denied";
  consentPurpose: string;
  policyVersion: string;
  verifiedAt: Date | null;
  revokedAt: Date | null;
}

export class PostgresYooKassaReceiptContactAuthority implements YooKassaReceiptContactAuthority {
  constructor(private readonly db: Pick<DrizzleDb, "execute">) {}

  async latestForOrder(
    orderId: string,
    consentPurpose: string,
    policyVersion: string,
  ): Promise<EncryptedYooKassaReceiptContact | null> {
    if (
      !UUID.test(orderId) ||
      !CONFIG_VALUE.test(consentPurpose) ||
      !CONFIG_VALUE.test(policyVersion)
    ) return null;
    const result = await this.db.execute<StoredContact>(sql`
      select contact.id::text as "contactId",
        contact.contact_kind as "contactKind",
        contact.ciphertext,
        contact.key_reference as "keyReference",
        contact.consent_decision as "consentDecision",
        contact.consent_purpose as "consentPurpose",
        contact.policy_version as "policyVersion",
        contact.verified_at as "verifiedAt",
        contact.revoked_at as "revokedAt"
      from expert_residency_orders residency_order
      join experts expert on expert.id = residency_order.expert_id
      join expert_residency_receipt_contacts contact on contact.user_id = expert.user_id
      where residency_order.id = ${orderId}::uuid
        and contact.consent_purpose = ${consentPurpose}
        and contact.policy_version = ${policyVersion}
      order by contact.created_at desc, contact.id desc
      limit 1
    `);
    const row = result.rows[0];
    return row === undefined ? null : {
      ...row,
      verifiedAt: row.verifiedAt?.toISOString() ?? null,
      revokedAt: row.revokedAt?.toISOString() ?? null,
    };
  }
}
