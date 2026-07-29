import { sql } from "drizzle-orm";
import type { DrizzleDb } from "../client.js";

type DbExecutor = Pick<DrizzleDb, "execute">;

export interface InboxClaimCommand {
  provider: string;
  externalEventId: string;
  payloadHash: string;
  normalizedIdentifier: string;
}

export class PostgresInboxRepository {
  async claim(executor: DbExecutor, command: InboxClaimCommand): Promise<boolean> {
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
    return result.rows.length === 1;
  }
}
