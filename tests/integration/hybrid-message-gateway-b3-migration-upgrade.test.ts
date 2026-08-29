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

describe("B3 migration 0035 to 0036", () => {
  it("preserves B2 data and creates empty immutable budget facts", async () => {
    const admin = process.env.II_TONYA_TEST_POSTGRES_ADMIN_URL;
    const container = admin
      ? await startExternalPostgresDatabase(admin)
      : await new PostgreSqlContainer("postgres:16-alpine").start();
    const db = new PgPool({ connectionString: container.getConnectionUri() });
    try {
      const journal = JSON.parse(
        readFileSync("packages/db/migrations/meta/_journal.json", "utf8"),
      ) as { entries: { idx: number; tag: string }[] };
      for (const entry of journal.entries.filter((e) => e.idx <= 35))
        await apply(db, `packages/db/migrations/${entry.tag}.sql`);
      const user = (
        await db.query<{ id: string }>(
          "insert into users default values returning id",
        )
      ).rows[0]!.id;
      await db.query(
        `insert into dialogues(tenant_key,user_id,provider,bot_key,external_chat_id) values('b3-upgrade','${user}'::uuid,'telegram','b3-upgrade','chat')`,
      );
      await apply(
        db,
        "packages/db/migrations/0036_selarti_budget_controls_b3.sql",
      );
      expect(
        (
          await db.query<{
            dialogues: number;
            policies: number;
            reservations: number;
            facts: number;
          }>(
            "select (select count(*)::int from dialogues) dialogues,(select count(*)::int from selarti_budget_policies) policies,(select count(*)::int from selarti_cost_reservations) reservations,(select count(*)::int from selarti_actual_usage_facts) facts",
          )
        ).rows[0],
      ).toEqual({ dialogues: 1, policies: 0, reservations: 0, facts: 0 });
      const names = (
        await db.query<{ name: string }>(
          "select indexname name from pg_indexes where indexname in ('selarti_budget_policy_one_active_idx','selarti_cost_reservations_period_idx','selarti_actual_usage_terminal_unique','selarti_actual_usage_unknown_unique','selarti_budget_alerts_created_idx')",
        )
      ).rows
        .map((r) => r.name)
        .sort();
      expect(names).toEqual([
        "selarti_actual_usage_terminal_unique",
        "selarti_actual_usage_unknown_unique",
        "selarti_budget_alerts_created_idx",
        "selarti_budget_policy_one_active_idx",
        "selarti_cost_reservations_period_idx",
      ]);
    } finally {
      await db.end();
      await container.stop();
    }
  }, 120_000);
});
