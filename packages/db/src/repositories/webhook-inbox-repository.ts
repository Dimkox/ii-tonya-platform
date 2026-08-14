import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import type { DrizzleDb } from "../client.js";

export class PostgresWebhookInboxRepository {
  constructor(
    private readonly db: Pick<DrizzleDb, "execute">,
    private readonly leaseMs = 30_000,
  ) {}

  async claim(
    provider: "telegram" | "yookassa",
    eventId: string,
  ): Promise<
    | { kind: "claimed"; claimId: string }
    | { kind: "duplicate" }
    | { kind: "busy" }
  > {
    const claimId = randomUUID();
    const result = await this.db.execute<{ claimId: string }>(sql`
      insert into webhook_inbox (provider, external_event_id, status, claim_id, lease_until)
      values (${provider}, ${eventId}, 'processing', ${claimId}::uuid, now() + (${this.leaseMs} * interval '1 millisecond'))
      on conflict (provider, external_event_id) do update set
        status = 'processing', claim_id = excluded.claim_id, lease_until = excluded.lease_until, updated_at = now()
      where webhook_inbox.status = 'failed' or (webhook_inbox.status = 'processing' and webhook_inbox.lease_until < now())
      returning claim_id as "claimId"
    `);
    if (result.rows[0] !== undefined) return { kind: "claimed", claimId };
    const stored = (
      await this.db.execute<{
        status: "processing" | "complete" | "failed";
      }>(sql`
      select status from webhook_inbox where provider = ${provider} and external_event_id = ${eventId}
    `)
    ).rows[0];
    return { kind: stored?.status === "complete" ? "duplicate" : "busy" };
  }

  async complete(claimId: string): Promise<void> {
    const result = await this.db.execute(
      sql`update webhook_inbox set status = 'complete', lease_until = null, updated_at = now() where claim_id = ${claimId}::uuid and status = 'processing' and lease_until >= now() returning id`,
    );
    if (result.rows.length !== 1) throw new WebhookInboxClaimLostError();
  }
  async fail(claimId: string): Promise<void> {
    const result = await this.db.execute(
      sql`update webhook_inbox set status = 'failed', lease_until = null, updated_at = now() where claim_id = ${claimId}::uuid and status = 'processing' and lease_until >= now() returning id`,
    );
    if (result.rows.length !== 1) throw new WebhookInboxClaimLostError();
  }
}

export class WebhookInboxClaimLostError extends Error {
  constructor() {
    super("Webhook inbox claim is stale or no longer owned");
  }
}
