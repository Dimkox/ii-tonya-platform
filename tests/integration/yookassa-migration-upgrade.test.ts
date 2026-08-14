import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import { startExternalPostgresDatabase } from "../../packages/db/src/testkit/external-postgres.js";

interface SqlExecutor {
  query<T extends Record<string, unknown> = Record<string, unknown>>(
    statement: string,
  ): Promise<{ rows: T[] }>;
}

interface TestContainer {
  getConnectionUri(): string;
  stop(): Promise<unknown>;
}

interface TestContainerBuilder {
  start(): Promise<TestContainer>;
}

interface PoolHandle extends SqlExecutor {
  end(): Promise<void>;
}

const requireFromDb = createRequire(
  new URL("../../packages/db/package.json", import.meta.url),
);
const { PostgreSqlContainer } = requireFromDb("@testcontainers/postgresql") as {
  PostgreSqlContainer: new (image: string) => TestContainerBuilder;
};
const { Pool } = requireFromDb("pg") as {
  Pool: new (options: { connectionString: string }) => PoolHandle;
};

async function applySqlMigration(db: SqlExecutor, path: string): Promise<void> {
  for (const statement of readFileSync(path, "utf8")
    .split("--> statement-breakpoint")
    .map((part) => part.trim())
    .filter(Boolean)) {
    await db.query(statement);
  }
}

async function applyThrough(db: SqlExecutor, lastIndex: number): Promise<void> {
  const journal = JSON.parse(
    readFileSync("packages/db/migrations/meta/_journal.json", "utf8"),
  ) as { entries: { idx: number; tag: string }[] };
  for (const entry of journal.entries.filter(({ idx }) => idx <= lastIndex)) {
    await applySqlMigration(db, `packages/db/migrations/${entry.tag}.sql`);
  }
}

describe("YooKassa migration 0023 upgrade compatibility", () => {
  it("upgrades the real schema through 0022 and installs the exact 0023 contract", async () => {
    const adminUrl = process.env.II_TONYA_TEST_POSTGRES_ADMIN_URL;
    const database = adminUrl
      ? await startExternalPostgresDatabase(adminUrl)
      : await new PostgreSqlContainer("postgres:16-alpine").start();
    const pool = new Pool({ connectionString: database.getConnectionUri() });
    try {
      await applyThrough(pool, 22);
      expect(
        (
          await pool.query<{ relationName: string | null }>(
            "select to_regclass('public.expert_residency_provider_operations')::text as \"relationName\"",
          )
        ).rows[0]?.relationName,
      ).toBeNull();

      await applySqlMigration(
        pool,
        "packages/db/migrations/0023_yookassa_provider_operations.sql",
      );

      const constraints = await pool.query<{ name: string; type: string }>(`
        select conname as name, contype as type
        from pg_constraint
        where conrelid = 'expert_residency_provider_operations'::regclass
        order by conname
      `);
      expect(constraints.rows).toEqual([
        { name: "expert_provider_operations_amount", type: "c" },
        { name: "expert_provider_operations_attempt_order_fk", type: "f" },
        { name: "expert_provider_operations_claim_digest", type: "c" },
        { name: "expert_provider_operations_currency", type: "c" },
        { name: "expert_provider_operations_kind", type: "c" },
        { name: "expert_provider_operations_mode", type: "c" },
        { name: "expert_provider_operations_order_fk", type: "f" },
        { name: "expert_provider_operations_parent", type: "c" },
        { name: "expert_provider_operations_provider", type: "c" },
        { name: "expert_provider_operations_provider_id", type: "c" },
        { name: "expert_provider_operations_request_digest", type: "c" },
        { name: "expert_provider_operations_resolution", type: "c" },
        { name: "expert_provider_operations_status", type: "c" },
        {
          name: "expert_residency_provider_operations_pkey",
          type: "p",
        },
      ]);

      const indexes = await pool.query<{ name: string; definition: string }>(`
        select indexname as name, indexdef as definition
        from pg_indexes
        where schemaname = 'public'
          and tablename = 'expert_residency_provider_operations'
        order by indexname
      `);
      expect(indexes.rows.map(({ name }) => name)).toEqual([
        "expert_provider_operations_command_unique",
        "expert_provider_operations_idempotency_unique",
        "expert_provider_operations_object_unique",
        "expert_provider_operations_order_kind_idx",
        "expert_provider_operations_reconcile_idx",
        "expert_residency_provider_operations_pkey",
      ]);
      expect(
        indexes.rows.find(
          ({ name }) => name === "expert_provider_operations_object_unique",
        )?.definition,
      ).toContain("WHERE (provider_object_id IS NOT NULL)");
    } finally {
      await pool.end();
      await database.stop();
    }
  }, 120_000);
});
