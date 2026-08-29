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
describe("B1 migration 0033 to 0034", () => {
  it("preserves legacy identities and installs scoped constraints without synthetic facts", async () => {
    const admin = process.env.II_TONYA_TEST_POSTGRES_ADMIN_URL;
    const container = admin
      ? await startExternalPostgresDatabase(admin)
      : await new PostgreSqlContainer("postgres:16-alpine").start();
    const db = new PgPool({ connectionString: container.getConnectionUri() });
    try {
      const journal = JSON.parse(
        readFileSync("packages/db/migrations/meta/_journal.json", "utf8"),
      ) as { entries: { idx: number; tag: string }[] };
      for (const e of journal.entries.filter((e) => e.idx <= 33))
        await apply(db, `packages/db/migrations/${e.tag}.sql`);
      const user = (
        await db.query<{ id: string }>(
          "insert into users default values returning id",
        )
      ).rows[0]!.id;
      await db.query(
        `insert into channel_identities(user_id,provider,external_id) values('${user}'::uuid,'telegram','legacy-preserved')`,
      );
      await apply(
        db,
        "packages/db/migrations/0034_hybrid_message_gateway_b1.sql",
      );
      const legacy = (
        await db.query<{ botKey: string | null; status: string }>(
          "select bot_key as \"botKey\",status from channel_identities where external_id='legacy-preserved'",
        )
      ).rows[0];
      expect(legacy).toEqual({ botKey: null, status: "active" });
      const indexes = await db.query<{ name: string }>(
        "select indexname name from pg_indexes where tablename in ('channel_identities','dialogue_inbound')",
      );
      expect(indexes.rows.map((x) => x.name)).toEqual(
        expect.arrayContaining([
          "channel_identities_provider_external_legacy_unique",
          "channel_identities_telegram_bot_user_chat_unique",
          "dialogue_inbound_provider_bot_update_unique",
          "dialogue_inbound_dialogue_idx",
          "dialogue_inbound_expiry_idx",
        ]),
      );
      const counts = (
        await db.query<{ dialogues: number; inbound: number; outbox: number }>(
          "select (select count(*)::int from dialogues) dialogues,(select count(*)::int from dialogue_inbound) inbound,(select count(*)::int from integration_outbox) outbox",
        )
      ).rows[0];
      expect(counts).toEqual({ dialogues: 0, inbound: 0, outbox: 0 });
    } finally {
      await db.end();
      await container.stop();
    }
  }, 120000);
});
