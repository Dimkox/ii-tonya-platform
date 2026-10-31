import { sql } from "drizzle-orm";
import type { DrizzleDb } from "../client.js";
import { lockClientConsentSubject } from "./client-consent-authority.js";
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;
/** Draft 0087 retention only; caller must fence this subject at the gateway first. */
export class PostgresEarlyBirdReceiptRetention {
  constructor(private readonly db: DrizzleDb) {}
  async listExpired(limit = 50): Promise<{ id: string; userId: string }[]> {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100)
      throw new Error("early_bird_receipt_unavailable");
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
    if (!uuid.test(input.id) || !uuid.test(input.userId))
      throw new Error("early_bird_receipt_unavailable");
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
