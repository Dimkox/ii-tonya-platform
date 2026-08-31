import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import { startExternalPostgresDatabase } from "../../packages/db/src/testkit/external-postgres.js";

interface Db {
  query<T extends Record<string, unknown> = Record<string, unknown>>(
    sql: string,
  ): Promise<{ rows: T[] }>;
}
interface Container {
  getConnectionUri(): string;
  stop(): Promise<unknown>;
}
interface Pool extends Db {
  end(): Promise<void>;
}
const req = createRequire(
  new URL("../../packages/db/package.json", import.meta.url),
);
const { PostgreSqlContainer } = req("@testcontainers/postgresql") as {
  PostgreSqlContainer: new (image: string) => { start(): Promise<Container> };
};
const { Pool: PgPool } = req("pg") as {
  Pool: new (input: { connectionString: string }) => Pool;
};
const apply = async (db: Db, path: string) => {
  for (const part of readFileSync(path, "utf8")
    .split("--> statement-breakpoint")
    .map((x) => x.trim())
    .filter(Boolean))
    await db.query(part);
};

describe("B2 migration 0034 to 0035", () => {
  it("preserves B1 rows and adds no synthetic proposals or deliveries", async () => {
    const admin = process.env.II_TONYA_TEST_POSTGRES_ADMIN_URL;
    const container = admin
      ? await startExternalPostgresDatabase(admin)
      : await new PostgreSqlContainer("postgres:16-alpine").start();
    const db = new PgPool({ connectionString: container.getConnectionUri() });
    try {
      const journal = JSON.parse(
        readFileSync("packages/db/migrations/meta/_journal.json", "utf8"),
      ) as { entries: { idx: number; tag: string }[] };
      for (const entry of journal.entries.filter((entry) => entry.idx <= 34))
        await apply(db, `packages/db/migrations/${entry.tag}.sql`);
      const user = (
        await db.query<{ id: string }>(
          "insert into users default values returning id",
        )
      ).rows[0]!.id;
      const dialogue = (
        await db.query<{ id: string }>(
          `insert into dialogues(tenant_key,user_id,provider,bot_key,external_chat_id) values('bot-upgrade','${user}'::uuid,'telegram','bot-upgrade','chat') returning id`,
        )
      ).rows[0]!.id;
      await db.query(
        `insert into dialogue_inbound(dialogue_id,provider,bot_key,provider_update_id,payload_hash,text,created_at,expires_at) values('${dialogue}'::uuid,'telegram','bot-upgrade',9001,repeat('a',64),'legacy','2026-08-29T00:00:00Z','2026-09-28T00:00:00Z')`,
      );
      await apply(
        db,
        "packages/db/migrations/0035_hybrid_message_gateway_b2.sql",
      );
      const counts = (
        await db.query<{
          inbound: number;
          proposals: number;
          deliveries: number;
        }>(
          "select (select count(*)::int from dialogue_inbound) inbound,(select count(*)::int from selarti_response_proposals) proposals,(select count(*)::int from dialogue_deliveries) deliveries",
        )
      ).rows[0];
      expect(counts).toEqual({ inbound: 1, proposals: 0, deliveries: 0 });
      const indexes = await db.query<{ name: string }>(
        "select indexname name from pg_indexes where indexname in ('integration_outbox_dialogue_sequence_unique','integration_outbox_dialogue_order_claim_idx','dialogue_deliveries_order_idx','selarti_response_proposals_expiry_idx')",
      );
      expect(indexes.rows.map((row) => row.name).sort()).toEqual([
        "dialogue_deliveries_order_idx",
        "integration_outbox_dialogue_order_claim_idx",
        "integration_outbox_dialogue_sequence_unique",
        "selarti_response_proposals_expiry_idx",
      ]);
    } finally {
      await db.end();
      await container.stop();
    }
  }, 120_000);
});
