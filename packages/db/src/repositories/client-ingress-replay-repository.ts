import type { DrizzleDb } from "../client.js";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
type Event = { readonly botId: string; readonly updateId: number };
const eventKey = (event: Event): string => {
  if (
    !/^[1-9]\d{0,15}$/u.test(event.botId) ||
    !Number.isSafeInteger(Number(event.botId)) ||
    typeof event.updateId !== "number" ||
    !Number.isSafeInteger(event.updateId) ||
    event.updateId < 0
  )
    throw new Error("client_ingress_event_invalid");
  return `client-navigation-v1:${event.botId}:${event.updateId}`;
};
export class PostgresClientIngressReplayRepository {
  constructor(private readonly db: DrizzleDb) {}
  async record(event: Event): Promise<"recorded" | "duplicate"> {
    const key = eventKey(event);
    try {
      return await this.db.transaction(async (tx) => {
        await tx.execute(sql`SET LOCAL lock_timeout = '1s'`);
        await tx.execute(sql`SET LOCAL statement_timeout = '2s'`);
        const result = await tx.execute<{ id: string }>(sql`
          insert into webhook_inbox (provider, external_event_id, status, claim_id, lease_until)
          values ('telegram', ${key}, 'complete', ${randomUUID()}::uuid, null)
          on conflict (provider, external_event_id) do nothing returning id
        `);
        if (result.rows.length === 1) return "recorded";
        if (result.rows.length === 0) return "duplicate";
        throw new Error("unexpected_receipt_result");
      });
    } catch {
      throw new Error("client_ingress_replay_unavailable");
    }
  }
  async hasReceipt(event: Event): Promise<boolean> {
    const key = eventKey(event);
    try {
      return await this.db.transaction(async (tx) => {
        await tx.execute(sql`SET LOCAL lock_timeout = '1s'`);
        await tx.execute(sql`SET LOCAL statement_timeout = '2s'`);
        const result = await tx.execute<{ present: boolean }>(sql`
          select exists (select 1 from webhook_inbox where provider='telegram' and external_event_id=${key}) as present
        `);
        const present = result.rows[0]?.present;
        if (typeof present !== "boolean")
          throw new Error("unexpected_replay_result");
        return present;
      });
    } catch {
      throw new Error("client_ingress_replay_unavailable");
    }
  }
}
