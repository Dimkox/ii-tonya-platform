import { sql } from "drizzle-orm";
import {
  sealDeferredRequest,
  openDeferredRequest,
  parseDeferredSnapshot,
  type DeferredRequestSource,
  type PayerReceiptBinding,
  type PayerReceiptVault,
} from "@ii-tonya/integrations";
import type { DrizzleDb } from "../client.js";
import { lockClientConsentSubject } from "./client-consent-authority.js";
import type {
  AuthenticatedSource,
  DeferredReceiptScope,
} from "./early-bird-deferred-receipt-contact.js";

type Material = {
  invoiceId: string;
  userId: string;
  operationId: string;
  grantId: string | null;
  policy: "wave1_standard_v1" | "owner_test_10_20_v1";
  stage: "onboarding" | "subscription";
  amountMinor: string;
  launchAt: string;
  idempotencyKey: string;
  receiptContactId: string;
  choiceId: string;
  capturedAt: string;
  expiresAt: string;
  keyId: string;
  ciphertext: string;
};
/** Draft-only: prepares one immutable encrypted body, with no provider I/O. */
export class PostgresDeferredRequestStore {
  constructor(
    private readonly db: DrizzleDb,
    private readonly source: AuthenticatedSource,
    private readonly vault: PayerReceiptVault,
    private readonly requestKey: Buffer,
    private readonly keyReference: string,
    private readonly fiscal: DeferredRequestSource["fiscal"],
    private readonly returnUrl: string,
  ) {}
  async prepare(
    scope: DeferredReceiptScope,
    invoiceId: string,
    contactId: string,
  ): Promise<DeferredRequestSource> {
    const resolved = await this.source.resolve(scope);
    if (!resolved) throw new Error("early_bird_deferred_request_unavailable");
    return this.db.transaction(
      async (tx) => {
        await lockClientConsentSubject(tx, resolved.userId);
        const rows = (
          await tx.execute<Material>(
            sql`select i.id as "invoiceId",i.user_id as "userId",i.id as "operationId",a.grant_id as "grantId",a.policy_version as policy,i.stage,i.amount_minor::text as "amountMinor",a.launch_at as "launchAt",i.idempotency_key as "idempotencyKey",c.id as "receiptContactId",a.choice_id as "choiceId",c.captured_at as "capturedAt",c.expires_at as "expiresAt",c.key_id as "keyId",c.ciphertext from early_bird_deferred_invoices i join early_bird_deferred_accounts a on a.id=i.account_id and a.user_id=i.user_id join early_bird_deferred_receipt_contacts c on c.account_id=a.id and c.user_id=a.user_id join expert_sales_bases b on b.id=a.base_id and b.user_id=a.user_id join early_bird_choices ch on ch.id=a.choice_id and ch.user_id=a.user_id join users u on u.id=a.user_id and u.active where i.id=${invoiceId}::uuid and i.user_id=${resolved.userId}::uuid and a.id=${scope.accountId}::uuid and a.base_id=${scope.offerId}::uuid and a.choice_id=${scope.choiceId}::uuid and c.id=${contactId}::uuid and c.expires_at>clock_timestamp() and i.dispatch_started_at is null and ch.choice='later' and ch.id=(select id from early_bird_choices where base_id=a.base_id order by decision_no desc limit 1) and early_bird_wave_active(early_bird_current_time()) and early_bird_composite_qualification(a.user_id,a.choice_id) and expert_card_current_messaging_authority(a.user_id,b.consent_version) for share of i,a,c,b,ch,u`,
          )
        ).rows;
        if (rows.length !== 1)
          throw new Error("early_bird_deferred_request_unavailable");
        const r = rows[0]!;
        const binding: PayerReceiptBinding = {
          id: r.receiptContactId,
          userId: r.userId,
          quoteId: r.choiceId,
          kind: "email",
          basis: "fiscal_payment_dec_plt_004_v1",
          capturedAt: new Date(r.capturedAt).toISOString(),
          expiresAt: new Date(r.expiresAt).toISOString(),
        };
        const email = this.vault.open(
          { keyId: r.keyId, ciphertext: r.ciphertext },
          binding,
        );
        const snapshot = parseDeferredSnapshot({
          invoiceId: r.invoiceId,
          userId: r.userId,
          operationId: r.operationId,
          grantId: r.grantId,
          policy: r.policy,
          stage: r.stage,
          amountMinor: r.amountMinor,
          mode: "live",
          launchAt: new Date(r.launchAt).toISOString(),
        });
        const material: DeferredRequestSource = {
          snapshot,
          idempotencyKey: r.idempotencyKey,
          customer: { email },
          fiscal: this.fiscal,
          returnUrl: this.returnUrl,
        };
        // A sealed body may be replaced only after expiration and before first dispatch.
        // Once dispatch starts the outcome is recovered, never resent with new material.
        await tx.execute(
          sql`delete from early_bird_deferred_requests r where r.invoice_id=${invoiceId}::uuid and r.user_id=${resolved.userId}::uuid and r.expires_at<=clock_timestamp() and exists(select 1 from early_bird_deferred_invoices i where i.id=r.invoice_id and i.user_id=r.user_id and i.dispatch_started_at is null)`,
        );
        const existing = (
          await tx.execute<{
            ciphertext: string;
            keyReference: string;
            digest: string;
          }>(
            sql`select ciphertext,key_reference as "keyReference",request_digest as digest from early_bird_deferred_requests where invoice_id=${invoiceId}::uuid and user_id=${resolved.userId}::uuid and receipt_contact_id=${contactId}::uuid and expires_at>clock_timestamp() for share`,
          )
        ).rows[0];
        if (existing) {
          if (existing.keyReference !== this.keyReference)
            throw new Error("early_bird_deferred_request_unavailable");
          openDeferredRequest(material, existing, this.requestKey);
          return material;
        }
        const sealed = sealDeferredRequest(
          material,
          this.requestKey,
          this.keyReference,
        );
        await tx.execute(
          sql`insert into early_bird_deferred_requests(invoice_id,user_id,receipt_contact_id,request_digest,ciphertext,key_reference,expires_at) values(${invoiceId}::uuid,${resolved.userId}::uuid,${contactId}::uuid,${sealed.digest},${sealed.ciphertext},${sealed.keyReference},${binding.expiresAt}::timestamptz)`,
        );
        return material;
      },
      { isolationLevel: "serializable" },
    );
  }
}
