import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { payerReceiptCaptureRequestSchema } from "@ii-tonya/contracts";
import type {
  PayerReceiptBinding,
  PayerReceiptVault,
} from "@ii-tonya/integrations";
import type { DrizzleDb } from "../client.js";
import { lockClientConsentSubject } from "./client-consent-authority.js";
import type { PostgresEarlyBirdOwnerScopeSource } from "./early-bird-owner-scope-source.js";

type Scope = Parameters<PostgresEarlyBirdOwnerScopeSource["resolve"]>[0];
type Source = {
  resolve(scope: Scope): Promise<{ userId: string } | null>;
  resolveCurrent(
    input: Pick<Scope, "botId" | "botKey" | "telegramUserId" | "chatId">,
  ): Promise<Scope | null>;
};
type Row = {
  id: string;
  userId: string;
  choiceId: string;
  capturedAt: string;
  expiresAt: string;
  keyId: string;
  ciphertext: string;
  idempotencyKey: string;
};
const columns = sql`id,user_id as "userId",choice_id as "choiceId",captured_at as "capturedAt",expires_at as "expiresAt",key_id as "keyId",ciphertext,idempotency_key as "idempotencyKey"`;
const invalid = () => new Error("early_bird_receipt_unavailable");
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
/** Draft 0087 only. All access re-resolves the authenticated scope and current wave authority. */
export class PostgresEarlyBirdReceiptContact {
  constructor(
    private readonly db: DrizzleDb,
    private readonly source: Source,
    private readonly vault?: PayerReceiptVault,
  ) {}
  async captureCurrent(
    input: Pick<Scope, "botId" | "botKey" | "telegramUserId" | "chatId"> & {
      updateId: number;
    },
    email: string,
  ): Promise<{ id: string; expiresAt: string }> {
    if (!Number.isSafeInteger(input.updateId) || input.updateId < 0)
      throw invalid();
    const scope = await this.source.resolveCurrent(input);
    if (!scope) throw invalid();
    return this.capture(
      scope,
      email,
      `wave-receipt:${input.botId}:${input.updateId}`,
    );
  }
  async capture(
    scope: Scope,
    email: string,
    idempotencyKey: string,
  ): Promise<{ id: string; expiresAt: string }> {
    const parsed = payerReceiptCaptureRequestSchema.safeParse({
      quoteId: scope.choiceId,
      email,
      idempotencyKey,
    });
    if (!this.vault || !parsed.success) throw invalid();
    const resolved = await this.source.resolve(scope);
    if (!resolved) throw invalid();
    const vault = this.vault;
    return this.db.transaction(async (tx) => {
      await tx.execute(
        sql`select set_config('statement_timeout','4000ms',true)`,
      );
      await lockClientConsentSubject(tx, resolved.userId);
      const authorized = (
        await tx.execute<{ valid: boolean }>(
          sql`select early_bird_receipt_authorized(${resolved.userId}::uuid,${scope.choiceId}::uuid) as valid`,
        )
      ).rows[0];
      if (authorized?.valid !== true) throw invalid();
      const prior = (
        await tx.execute<Row>(
          sql`select ${columns} from early_bird_receipt_contacts where user_id=${resolved.userId}::uuid and choice_id=${scope.choiceId}::uuid and expires_at>clock_timestamp() for update`,
        )
      ).rows[0];
      if (prior) {
        if (
          prior.idempotencyKey !== idempotencyKey ||
          Date.parse(prior.expiresAt) <= Date.now() ||
          vault.open(
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
      const clock = (
        await tx.execute<{ now: string }>(
          sql`select date_trunc('milliseconds',clock_timestamp()) as now`,
        )
      ).rows[0];
      if (!clock) throw invalid();
      const capturedAt = new Date(clock.now).toISOString(),
        expiresAt = new Date(
          Date.parse(capturedAt) + 12 * 60 * 60 * 1000,
        ).toISOString();
      const metadata: PayerReceiptBinding = {
        id: randomUUID(),
        quoteId: scope.choiceId,
        userId: resolved.userId,
        kind: "email",
        basis: "fiscal_payment_dec_plt_004_v1",
        capturedAt,
        expiresAt,
      };
      const sealed = vault.seal(email, metadata);
      await tx.execute(
        sql`insert into early_bird_receipt_contacts(id,user_id,choice_id,idempotency_key,captured_at,expires_at,key_id,ciphertext) values(${metadata.id}::uuid,${metadata.userId}::uuid,${metadata.quoteId}::uuid,${idempotencyKey},${capturedAt}::timestamptz,${expiresAt}::timestamptz,${sealed.keyId},${sealed.ciphertext})`,
      );
      return { id: metadata.id, expiresAt };
    });
  }
  async read(
    scope: Scope,
  ): Promise<{ id: string; email: string; expiresAt: string } | null> {
    if (!this.vault) return null;
    const resolved = await this.source.resolve(scope);
    if (!resolved) return null;
    const vault = this.vault;
    return this.db.transaction(async (tx) => {
      await tx.execute(
        sql`select set_config('statement_timeout','4000ms',true)`,
      );
      await lockClientConsentSubject(tx, resolved.userId);
      const rows = (
        await tx.execute<Row>(
          sql`select ${columns} from early_bird_receipt_contacts r where r.user_id=${resolved.userId}::uuid and r.choice_id=${scope.choiceId}::uuid and r.expires_at>clock_timestamp() and early_bird_receipt_authorized(r.user_id,r.choice_id) for share`,
        )
      ).rows;
      if (rows.length !== 1) return null;
      return {
        id: rows[0]!.id,
        email: vault.open(
          { keyId: rows[0]!.keyId, ciphertext: rows[0]!.ciphertext },
          binding(rows[0]!),
        ),
        expiresAt: new Date(rows[0]!.expiresAt).toISOString(),
      };
    });
  }
  /** The caller must fence the subject's gateway before calling expireSelected. */
  async listExpired(limit = 50): Promise<{ id: string; userId: string }[]> {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100)
      throw invalid();
    return this.db.transaction(async (tx) => {
      await tx.execute(
        sql`select set_config('statement_timeout','4000ms',true)`,
      );
      return (
        await tx.execute<{ id: string; userId: string }>(
          sql`select id,user_id as "userId" from early_bird_receipt_contacts where expires_at<=clock_timestamp() order by expires_at,id limit ${limit}`,
        )
      ).rows;
    });
  }
  async expireSelected(input: {
    id: string;
    userId: string;
  }): Promise<boolean> {
    const uuid =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;
    if (!uuid.test(input.id) || !uuid.test(input.userId)) throw invalid();
    return this.db.transaction(async (tx) => {
      await tx.execute(
        sql`select set_config('statement_timeout','4000ms',true)`,
      );
      await lockClientConsentSubject(tx, input.userId);
      return (
        (
          await tx.execute(
            sql`delete from early_bird_receipt_contacts where id=${input.id}::uuid and user_id=${input.userId}::uuid and expires_at<=clock_timestamp() returning id`,
          )
        ).rows.length === 1
      );
    });
  }
}
