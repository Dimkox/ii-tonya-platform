import { sql } from "drizzle-orm";
import type { DrizzleDb } from "../client.js";
/** Opaque tokens survive subject erasure and remain pending until gateway ACK. */
export class PostgresReceiptRevocationOutbox {
  constructor(private readonly db: DrizzleDb) {}
  async assertReady(mode: "privacy" | "worker"): Promise<void> {
    const row = (
      await this.db.execute<{ ready: boolean }>(
        sql`select case when to_regclass('public.receipt_revocation_outbox') is null then false else has_table_privilege(current_user,to_regclass('public.receipt_revocation_outbox'),'SELECT') and has_table_privilege(current_user,to_regclass('public.receipt_revocation_outbox'),'DELETE') and (${mode}='worker' or has_table_privilege(current_user,to_regclass('public.receipt_revocation_outbox'),'INSERT')) end as ready`,
      )
    ).rows[0];
    if (row?.ready !== true)
      throw new Error("receipt_revocation_outbox_unavailable");
  }
  async listPending(
    keyVersion: string,
    limit: number,
  ): Promise<{ token: string; contactId: string }[]> {
    if (
      !/^[A-Za-z0-9_-]{1,64}$/u.test(keyVersion) ||
      !Number.isInteger(limit) ||
      limit < 1 ||
      limit > 100
    )
      throw new Error("receipt_revocation_outbox_invalid");
    return (
      await this.db.execute<{ token: string; contactId: string }>(
        sql`select token,contact_id as "contactId" from receipt_revocation_outbox where key_version=${keyVersion} and acknowledged_at is null order by requested_at,token limit ${limit}`,
      )
    ).rows;
  }
  async acknowledge(token: string, keyVersion: string): Promise<void> {
    if (
      !/^[a-f0-9]{64}$/u.test(token) ||
      !/^[A-Za-z0-9_-]{1,64}$/u.test(keyVersion)
    )
      throw new Error("receipt_revocation_outbox_invalid");
    await this.db.execute(
      sql`delete from receipt_revocation_outbox where token=${token} and key_version=${keyVersion}`,
    );
  }
}
