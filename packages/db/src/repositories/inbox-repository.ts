import { sql } from "drizzle-orm";
import type { DrizzleDb } from "../client.js";

type DbExecutor = Pick<DrizzleDb, "execute">;

export interface InboxClaimCommand {
  provider: string;
  externalEventId: string;
  payloadHash: string;
  normalizedIdentifier: string;
}

export type InboxClaimResult =
  | { kind: "claimed"; inboxId: string }
  | { kind: "duplicate"; messageEventId: string; payloadMatches: boolean };

export class InboxPayloadMismatchError extends Error {
  constructor() {
    super("Inbound provider event payload does not match the stored claim");
  }
}

export class PostgresInboxRepository {
  async claim(executor: DbExecutor, command: InboxClaimCommand): Promise<InboxClaimResult> {
    const result = await executor.execute<{ id: string }>(sql`
      insert into integration_inbox (
        provider,
        external_event_id,
        payload_hash,
        normalized_identifier
      ) values (
        ${command.provider},
        ${command.externalEventId},
        ${command.payloadHash},
        ${command.normalizedIdentifier}
      )
      on conflict (provider, external_event_id) do nothing
      returning id
    `);
    const claimed = result.rows[0];
    if (claimed !== undefined) return { kind: "claimed", inboxId: claimed.id };
    const stored = (await executor.execute<{
      messageEventId: string | null;
      payloadHash: string;
    }>(sql`
      select message_event_id as "messageEventId", payload_hash as "payloadHash"
      from integration_inbox
      where provider = ${command.provider}
        and external_event_id = ${command.externalEventId}
    `)).rows[0];
    if (stored?.messageEventId === null || stored === undefined) {
      throw new Error("Expected the stored inbox event association");
    }
    return {
      kind: "duplicate",
      messageEventId: stored.messageEventId,
      payloadMatches: stored.payloadHash === command.payloadHash,
    };
  }

  async associate(executor: DbExecutor, inboxId: string, messageEventId: string): Promise<void> {
    await executor.execute(sql`
      update integration_inbox
      set message_event_id = ${messageEventId}::uuid
      where id = ${inboxId}::uuid
    `);
  }
}
