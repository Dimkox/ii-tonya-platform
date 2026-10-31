import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { payerReceiptCaptureRequestSchema } from "@ii-tonya/contracts";
import type {
  PayerReceiptBinding,
  PayerReceiptVault,
} from "@ii-tonya/integrations";
import type { DrizzleDb } from "../client.js";
import { lockClientConsentSubject } from "./client-consent-authority.js";

export type DeferredReceiptScope = Readonly<{
  botId: string;
  botKey: string;
  telegramUserId: string;
  chatId: string;
  offerId: string;
  choiceId: string;
  accountId: string;
}>;
export type AuthenticatedSource = {
  resolve(scope: DeferredReceiptScope): Promise<{ userId: string } | null>;
};
type Row = {
  id: string;
  userId: string;
  choiceId: string;
  accountId: string;
  capturedAt: string;
  expiresAt: string;
  keyId: string;
  ciphertext: string;
};
function binding(row: Row): PayerReceiptBinding {
  return {
    id: row.id,
    userId: row.userId,
    quoteId: row.choiceId,
    kind: "email",
    basis: "fiscal_payment_dec_plt_004_v1",
    capturedAt: new Date(row.capturedAt).toISOString(),
    expiresAt: new Date(row.expiresAt).toISOString(),
  };
}
/** Requires an authenticated Telegram scope resolver and the existing encrypted vault. */
export class PostgresDeferredReceiptContact {
  constructor(
    private readonly db: DrizzleDb,
    private readonly source: AuthenticatedSource,
    private readonly vault: PayerReceiptVault,
  ) {}
  async capture(
    scope: DeferredReceiptScope,
    email: string,
    idempotencyKey: string,
  ): Promise<{ id: string; expiresAt: string }> {
    const invalid = () => new Error("early_bird_deferred_receipt_unavailable");
    if (
      !payerReceiptCaptureRequestSchema.safeParse({
        quoteId: scope.choiceId,
        email,
        idempotencyKey,
      }).success
    )
      throw invalid();
    const resolved = await this.source.resolve(scope);
    if (!resolved) throw invalid();
    return this.db.transaction(async (tx) => {
      await lockClientConsentSubject(tx, resolved.userId);
      const authorized = (
        await tx.execute<{ valid: boolean }>(
          sql`select exists(select 1 from early_bird_deferred_accounts a join expert_sales_bases b on b.id=a.base_id and b.user_id=a.user_id join early_bird_choices c on c.id=a.choice_id and c.user_id=a.user_id join users u on u.id=a.user_id and u.active where a.id=${scope.accountId}::uuid and a.user_id=${resolved.userId}::uuid and a.base_id=${scope.offerId}::uuid and a.choice_id=${scope.choiceId}::uuid and c.choice='later' and c.id=(select id from early_bird_choices where base_id=a.base_id order by decision_no desc limit 1) and early_bird_wave_active(early_bird_current_time()) and early_bird_composite_qualification(a.user_id,a.choice_id) and expert_card_current_messaging_authority(a.user_id,b.consent_version)) as valid`,
        )
      ).rows[0]?.valid;
      if (authorized !== true) throw invalid();
      const prior = (
        await tx.execute<Row>(
          sql`select r.id,r.user_id as "userId",a.choice_id as "choiceId",r.account_id as "accountId",r.captured_at as "capturedAt",r.expires_at as "expiresAt",r.key_id as "keyId",r.ciphertext from early_bird_deferred_receipt_contacts r join early_bird_deferred_accounts a on a.id=r.account_id and a.user_id=r.user_id where r.user_id=${resolved.userId}::uuid and r.idempotency_key=${idempotencyKey} for update of r`,
        )
      ).rows[0];
      if (prior) {
        if (
          prior.accountId !== scope.accountId ||
          prior.choiceId !== scope.choiceId ||
          Date.parse(prior.expiresAt) <= Date.now() ||
          this.vault.open(
            { keyId: prior.keyId, ciphertext: prior.ciphertext },
            binding(prior),
          ) !== email
        )
          throw invalid();
        return {
          id: prior.id,
          expiresAt: new Date(prior.expiresAt).toISOString(),
        };
      }
      const now = (
        await tx.execute<{ now: string }>(
          sql`select date_trunc('milliseconds',clock_timestamp()) as now`,
        )
      ).rows[0]?.now;
      if (!now) throw invalid();
      const capturedAt = new Date(now).toISOString(),
        expiresAt = new Date(
          Date.parse(capturedAt) + 12 * 60 * 60 * 1000,
        ).toISOString();
      const metadata: PayerReceiptBinding = {
        id: randomUUID(),
        userId: resolved.userId,
        quoteId: scope.choiceId,
        kind: "email",
        basis: "fiscal_payment_dec_plt_004_v1",
        capturedAt,
        expiresAt,
      };
      const sealed = this.vault.seal(email, metadata);
      await tx.execute(
        sql`insert into early_bird_deferred_receipt_contacts(id,user_id,account_id,idempotency_key,captured_at,expires_at,key_id,ciphertext) values(${metadata.id}::uuid,${metadata.userId}::uuid,${scope.accountId}::uuid,${idempotencyKey},${capturedAt}::timestamptz,${expiresAt}::timestamptz,${sealed.keyId},${sealed.ciphertext})`,
      );
      return { id: metadata.id, expiresAt };
    });
  }
  async active(scope: DeferredReceiptScope): Promise<{ id: string } | null> {
    const resolved = await this.source.resolve(scope);
    if (!resolved) return null;
    return this.db.transaction(async (tx) => {
      await lockClientConsentSubject(tx, resolved.userId);
      const rows = (
        await tx.execute<{ id: string }>(
          sql`select r.id from early_bird_deferred_receipt_contacts r join early_bird_deferred_accounts a on a.id=r.account_id and a.user_id=r.user_id join expert_sales_bases b on b.id=a.base_id and b.user_id=a.user_id join early_bird_choices c on c.id=a.choice_id and c.user_id=a.user_id where r.user_id=${resolved.userId}::uuid and a.id=${scope.accountId}::uuid and a.base_id=${scope.offerId}::uuid and a.choice_id=${scope.choiceId}::uuid and c.choice='later' and c.id=(select id from early_bird_choices where base_id=a.base_id order by decision_no desc limit 1) and r.expires_at>clock_timestamp() and early_bird_wave_active(early_bird_current_time()) and early_bird_composite_qualification(a.user_id,a.choice_id) and expert_card_current_messaging_authority(a.user_id,b.consent_version) order by r.captured_at desc,r.id desc limit 1 for share of r,a,b,c`,
        )
      ).rows;
      return rows[0] ?? null;
    });
  }
  /** Caller must first revoke this exact contact at the gateway and await the fence. */
  async listExpired(limit = 50): Promise<{ id: string; userId: string }[]> {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100)
      throw new Error("early_bird_deferred_receipt_unavailable");
    return (
      await this.db.execute<{ id: string; userId: string }>(
        sql`select id,user_id as "userId" from early_bird_deferred_receipt_contacts where expires_at<=clock_timestamp() order by expires_at,id limit ${limit}`,
      )
    ).rows;
  }
  /** Invoke only after gateway revocation has acknowledged this contact. */
  async expireSelected(input: {
    id: string;
    userId: string;
  }): Promise<boolean> {
    return this.db.transaction(async (tx) => {
      await lockClientConsentSubject(tx, input.userId);
      const rows = (
        await tx.execute<{ id: string }>(
          sql`delete from early_bird_deferred_receipt_contacts where id=${input.id}::uuid and user_id=${input.userId}::uuid and expires_at<=clock_timestamp() returning id`,
        )
      ).rows;
      return rows.length === 1;
    });
  }
}
