import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { payerReceiptCaptureRequestSchema } from "@ii-tonya/contracts";
import type {
  PayerReceiptBinding,
  PayerReceiptVault,
  YooKassaReceiptAuthority,
} from "@ii-tonya/integrations";
import type { DrizzleDb } from "../client.js";
import { lockClientConsentSubject } from "./client-consent-authority.js";

export class PayerReceiptError extends Error {
  constructor(
    readonly code:
      | "PAYER_RECEIPT_UNAVAILABLE"
      | "PAYER_RECEIPT_CONFLICT"
      | "PAYER_RECEIPT_INVALID",
  ) {
    super(code);
  }
}
type Row = PayerReceiptBinding & {
  keyId: string | null;
  ciphertext: string | null;
  valid: boolean;
} & Record<string, unknown>;
const columns = sql`c.id,c.quote_id as "quoteId",c.user_id as "userId",c.kind,c.basis,c.captured_at as "capturedAt",c.expires_at as "expiresAt",c.key_id as "keyId",c.ciphertext, c.redacted_at is null and c.expires_at>clock_timestamp() as valid`;
function binding(row: Row): PayerReceiptBinding {
  return {
    id: row.id,
    quoteId: row.quoteId,
    userId: row.userId,
    kind: row.kind,
    basis: row.basis,
    capturedAt: new Date(row.capturedAt).toISOString(),
    expiresAt: new Date(row.expiresAt).toISOString(),
  };
}
function open(
  row: Row | undefined,
  vault: PayerReceiptVault | undefined,
): string {
  if (!row?.valid || !row.ciphertext || !row.keyId || !vault)
    throw new PayerReceiptError("PAYER_RECEIPT_UNAVAILABLE");
  try {
    return vault.open(
      { keyId: row.keyId, ciphertext: row.ciphertext },
      binding(row),
    );
  } catch {
    throw new PayerReceiptError("PAYER_RECEIPT_UNAVAILABLE");
  }
}
export async function lockPayerReceiptSelection(
  tx: Pick<DrizzleDb, "execute">,
  input: { userId: string; quoteId: string; receiptContactId: string },
  vault?: PayerReceiptVault,
): Promise<void> {
  const row = (
    await tx.execute<Row>(
      sql`select ${columns} from payer_receipt_contacts c where c.id=${input.receiptContactId}::uuid and c.quote_id=${input.quoteId}::uuid and c.user_id=${input.userId}::uuid for update of c`,
    )
  ).rows[0];
  if (row)
    row.valid =
      (
        await tx.execute<{ valid: boolean }>(
          sql`select expires_at>clock_timestamp() and redacted_at is null as valid from payer_receipt_contacts where id=${row.id}::uuid`,
        )
      ).rows[0]?.valid === true;
  open(row, vault);
}
export class PostgresPayerReceiptContactRepository {
  constructor(
    private readonly db: DrizzleDb,
    private readonly vault?: PayerReceiptVault,
    private readonly retentionDays?: number,
  ) {}
  async capture(
    input: {
      userId: string;
      quoteId: string;
      email: string;
      idempotencyKey: string;
    },
    transaction?: Parameters<Parameters<DrizzleDb["transaction"]>[0]>[0],
  ) {
    const { userId, ...request } = input;
    const parsed = payerReceiptCaptureRequestSchema.safeParse(request);
    if (!parsed.success || !/^[0-9a-f-]{36}$/iu.test(userId))
      throw new PayerReceiptError("PAYER_RECEIPT_INVALID");
    const days = this.retentionDays;
    if (
      !this.vault ||
      !days ||
      !Number.isInteger(days) ||
      days < 1 ||
      days > 400
    )
      throw new PayerReceiptError("PAYER_RECEIPT_UNAVAILABLE");
    try {
      const write = async (
        tx: Parameters<Parameters<DrizzleDb["transaction"]>[0]>[0],
      ) => {
        await lockClientConsentSubject(tx, userId);
        const user = (
          await tx.execute<{ active: boolean }>(
            sql`select active from users where id=${userId}::uuid for share`,
          )
        ).rows[0];
        if (!user?.active)
          throw new PayerReceiptError("PAYER_RECEIPT_UNAVAILABLE");
        const prior = (
          await tx.execute<Row>(
            sql`select ${columns} from payer_receipt_contacts c where c.user_id=${userId}::uuid and c.idempotency_key=${parsed.data.idempotencyKey} for update of c`,
          )
        ).rows[0];
        if (prior) {
          prior.valid =
            (
              await tx.execute<{ valid: boolean }>(
                sql`select expires_at>clock_timestamp() and redacted_at is null as valid from payer_receipt_contacts where id=${prior.id}::uuid`,
              )
            ).rows[0]?.valid === true;
          if (
            prior.quoteId !== parsed.data.quoteId ||
            open(prior, this.vault) !== parsed.data.email
          )
            throw new PayerReceiptError("PAYER_RECEIPT_CONFLICT");
        }
        const bound =
          prior &&
          (
            await tx.execute<{ id: string }>(
              sql`select order_id as id from payer_receipt_order_bindings where contact_id=${prior.id}::uuid`,
            )
          ).rows[0];
        if (!bound) {
          const quote = (
            await tx.execute<{ id: string }>(
              sql`select q.id from expert_campaign_quotes q join expert_residency_tariff_versions t on t.id=q.tariff_version_id where q.id=${parsed.data.quoteId}::uuid and q.user_id=${userId}::uuid and (expert_sales_receipt_authority(q.id,q.user_id) or (q.rule_version<>'expert_separated_sales_v3' and q.quoted_at<=clock_timestamp() and q.expires_at>clock_timestamp() and t.active_from<=clock_timestamp() and t.active_to>clock_timestamp())) and not exists(select 1 from expert_residency_orders o where o.campaign_quote_id=q.id) for share of q,t`,
            )
          ).rows[0];
          if (!quote) throw new PayerReceiptError("PAYER_RECEIPT_UNAVAILABLE");
        }
        if (prior) {
          return {
            receiptContactId: prior.id,
            quoteId: prior.quoteId,
            expiresAt: new Date(prior.expiresAt).toISOString(),
          };
        }
        const clock = (
          await tx.execute<{ now: string }>(
            sql`select date_trunc('milliseconds',clock_timestamp()) as now`,
          )
        ).rows[0]!;
        const capturedAt = new Date(clock.now).toISOString(),
          expiresAt = new Date(
            Date.parse(capturedAt) + days * 86400000,
          ).toISOString();
        const metadata: PayerReceiptBinding = {
          id: randomUUID(),
          quoteId: parsed.data.quoteId,
          userId,
          kind: "email",
          basis: "fiscal_payment_dec_plt_004_v1",
          capturedAt,
          expiresAt,
        };
        const sealed = this.vault!.seal(parsed.data.email, metadata);
        await tx.execute(
          sql`insert into payer_receipt_contacts(id,quote_id,user_id,idempotency_key,kind,basis,captured_at,expires_at,key_id,ciphertext) values(${metadata.id}::uuid,${metadata.quoteId}::uuid,${userId}::uuid,${parsed.data.idempotencyKey},'email',${metadata.basis},${capturedAt}::timestamptz,${expiresAt}::timestamptz,${sealed.keyId},${sealed.ciphertext})`,
        );
        return {
          receiptContactId: metadata.id,
          quoteId: metadata.quoteId,
          expiresAt,
        };
      };
      return transaction
        ? await write(transaction)
        : await this.db.transaction(write);
    } catch (e) {
      if (e instanceof PayerReceiptError) throw e;
      throw new PayerReceiptError("PAYER_RECEIPT_UNAVAILABLE");
    }
  }
  async receiptAuthorityForOrder(
    orderId: string,
  ): Promise<YooKassaReceiptAuthority | null> {
    if (
      typeof orderId !== "string" ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu.test(
        orderId,
      )
    )
      return null;
    try {
      // Composite bindings and immutable contact identity survive redaction.
      // This query deliberately selects neither envelope nor disclosure state.
      const row = (
        await this.db.execute<{ id: string; kind: "email" }>(
          sql`select c.id,c.kind from payer_receipt_order_bindings b join payer_receipt_contacts c on c.id=b.contact_id and c.quote_id=b.quote_id and c.user_id=b.user_id join expert_residency_orders o on o.id=b.order_id and o.campaign_quote_id=b.quote_id where b.order_id=${orderId}::uuid`,
        )
      ).rows[0];
      return row
        ? {
            contactKind: row.kind,
            authorityReference: `payer-receipt:${row.id}`,
          }
        : null;
    } catch {
      return null;
    }
  }
  async receiptContactForOrder(orderId: string) {
    if (!/^[0-9a-f-]{36}$/iu.test(orderId) || !this.vault) return null;
    try {
      return await this.db.transaction(async (tx) => {
        const row = (
          await tx.execute<Row>(
            sql`select ${columns} from payer_receipt_order_bindings b join payer_receipt_contacts c on c.id=b.contact_id and c.quote_id=b.quote_id and c.user_id=b.user_id join expert_residency_orders o on o.id=b.order_id and o.campaign_quote_id=b.quote_id where b.order_id=${orderId}::uuid for share of c`,
          )
        ).rows[0];
        if (row)
          row.valid =
            (
              await tx.execute<{ valid: boolean }>(
                sql`select expires_at>clock_timestamp() and redacted_at is null as valid from payer_receipt_contacts where id=${row.id}::uuid`,
              )
            ).rows[0]?.valid === true;
        const email = open(row, this.vault);
        return { email, authorityReference: `payer-receipt:${row!.id}` };
      });
    } catch {
      return null;
    }
  }
  async redactExpiredBatch(limit: number): Promise<number> {
    if (!Number.isInteger(limit) || limit < 1 || limit > 100)
      throw new PayerReceiptError("PAYER_RECEIPT_INVALID");
    return this.db.transaction(async (tx) => {
      const rows = (
        await tx.execute<{ id: string }>(
          sql`select c.id from payer_receipt_contacts c where c.redacted_at is null and payer_receipt_redaction_due(c) order by c.expires_at,c.id limit ${limit} for update of c skip locked`,
        )
      ).rows;
      let count = 0;
      for (const row of rows) {
        const changed = await tx.execute(
          sql`update payer_receipt_contacts c set ciphertext=null,key_id=null,redacted_at=clock_timestamp() where c.id=${row.id}::uuid and c.redacted_at is null and payer_receipt_redaction_due(c) returning id`,
        );
        count += changed.rows.length;
      }
      return count;
    });
  }
}
