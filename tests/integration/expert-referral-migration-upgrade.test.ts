import { spawnSync } from "node:child_process";
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

interface TestContainerConstructor {
  new (image: string): TestContainerBuilder;
}

interface PoolHandle extends SqlExecutor {
  end(): Promise<void>;
}

interface PoolConstructor {
  new (options: { connectionString: string }): PoolHandle;
}

const requireFromDb = createRequire(
  new URL("../../packages/db/package.json", import.meta.url),
);
const { PostgreSqlContainer } = requireFromDb("@testcontainers/postgresql") as {
  PostgreSqlContainer: TestContainerConstructor;
};
const { Pool } = requireFromDb("pg") as { Pool: PoolConstructor };

type DatabaseErrorEvidence = {
  code?: unknown;
  message?: unknown;
  cause?: unknown;
};

function databaseErrorChain(error: unknown): DatabaseErrorEvidence[] {
  const chain: DatabaseErrorEvidence[] = [];
  const seen = new Set<unknown>();
  let current = error;
  while (
    typeof current === "object" &&
    current !== null &&
    !seen.has(current)
  ) {
    seen.add(current);
    const evidence = current as DatabaseErrorEvidence;
    chain.push(evidence);
    current = evidence.cause;
  }
  return chain;
}

async function applySqlMigration(db: SqlExecutor, path: string): Promise<void> {
  const statements = readFileSync(path, "utf8")
    .split("--> statement-breakpoint")
    .map((statement) => statement.trim())
    .filter((statement) => statement.length > 0);
  for (const statement of statements) await db.query(statement);
}

async function applyThrough0017(db: SqlExecutor): Promise<void> {
  const journal = JSON.parse(
    readFileSync("packages/db/migrations/meta/_journal.json", "utf8"),
  ) as { entries: { idx: number; tag: string }[] };
  for (const entry of journal.entries.filter(({ idx }) => idx <= 17)) {
    await applySqlMigration(db, `packages/db/migrations/${entry.tag}.sql`);
  }
}

const fixtureUuid = (suffix: string): string =>
  `00000000-0000-4000-8000-${suffix.padStart(12, "0")}`;

describe("expert referral migration 0018 upgrade guard", () => {
  it("places the duplicate identity guard before every 0018 DDL statement", () => {
    const migration = readFileSync(
      "packages/db/migrations/0018_expert_residency_referrals.sql",
      "utf8",
    );
    const guard = migration.indexOf("expert_user_identity_duplicates");
    const firstDdl = migration.search(
      /\b(?:create|alter)\s+(?:extension|type|table|view|index|function|trigger)\b/iu,
    );
    expect(guard).toBeGreaterThan(-1);
    expect(firstDdl).toBeGreaterThan(guard);
    expect(migration).toContain("ERRCODE = 'P0001'");
  });

  it("fails preflight and migration before creating any 0018 relation", async () => {
    const adminUrl = process.env.II_TONYA_TEST_POSTGRES_ADMIN_URL;
    const container = adminUrl
      ? await startExternalPostgresDatabase(adminUrl)
      : await new PostgreSqlContainer("postgres:16-alpine").start();
    const connectionString = container.getConnectionUri();
    const pool = new Pool({ connectionString });
    try {
      await applyThrough0017(pool);
      const duplicateUserId = fixtureUuid("10");
      const firstExpertId = fixtureUuid("11");
      const secondExpertId = fixtureUuid("12");
      await pool.query(`
        insert into users (id) values ('${duplicateUserId}'::uuid);
        insert into experts (id, user_id, active, verified) values
          ('${firstExpertId}'::uuid, '${duplicateUserId}'::uuid, true, true),
          ('${secondExpertId}'::uuid, '${duplicateUserId}'::uuid, true, true);
      `);

      const preflight = spawnSync(
        process.execPath,
        ["scripts/preflight-expert-referral-migration.mjs"],
        {
          cwd: process.cwd(),
          encoding: "utf8",
          env: { ...process.env, DATABASE_URL: connectionString },
        },
      );
      const output = `${preflight.stdout}${preflight.stderr}`;
      expect(preflight.status).not.toBe(0);
      expect(output).toContain("P0001");
      expect(output).toContain("expert_user_identity_duplicates");
      expect(output).toContain("duplicate_groups=1");
      expect(output).not.toContain(duplicateUserId);
      expect(output).not.toContain(firstExpertId);
      expect(output).not.toContain(secondExpertId);

      let caught: unknown;
      try {
        await applySqlMigration(
          pool,
          "packages/db/migrations/0018_expert_residency_referrals.sql",
        );
      } catch (error) {
        caught = error;
      }
      const chain = databaseErrorChain(caught);
      expect(
        chain.some(
          (error) =>
            error.code === "P0001" &&
            String(error.message).includes("expert_user_identity_duplicates"),
        ),
      ).toBe(true);

      const created = await pool.query<{ relationName: string | null }>(
        `select to_regclass('public.expert_referral_codes')::text as "relationName"`,
      );
      expect(created.rows[0]?.relationName).toBeNull();
    } finally {
      await pool.end();
      await container.stop();
    }
  }, 120_000);
});
