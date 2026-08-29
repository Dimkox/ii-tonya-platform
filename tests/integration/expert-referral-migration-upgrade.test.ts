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

async function expectQuery<T extends Record<string, unknown>>(
  db: SqlExecutor,
  statement: string,
  rows: T[],
): Promise<void> {
  await expect(db.query<T>(statement)).resolves.toMatchObject({ rows });
}

async function applyThrough0017(db: SqlExecutor): Promise<void> {
  const journal = JSON.parse(
    readFileSync("packages/db/migrations/meta/_journal.json", "utf8"),
  ) as { entries: { idx: number; tag: string }[] };
  for (const entry of journal.entries.filter(({ idx }) => idx <= 17)) {
    await applySqlMigration(db, `packages/db/migrations/${entry.tag}.sql`);
  }
}

async function applyThrough0031(db: SqlExecutor): Promise<void> {
  const journal = JSON.parse(
    readFileSync("packages/db/migrations/meta/_journal.json", "utf8"),
  ) as { entries: { idx: number; tag: string }[] };
  for (const entry of journal.entries.filter(({ idx }) => idx <= 31)) {
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

describe("commercial core 0032 upgrade compatibility", () => {
  it("backfills the legacy client cohort without changing legacy financial facts", async () => {
    const adminUrl = process.env.II_TONYA_TEST_POSTGRES_ADMIN_URL;
    if (adminUrl === undefined)
      throw new Error("test postgres admin URL required");
    const container = await startExternalPostgresDatabase(adminUrl);
    const pool = new Pool({ connectionString: container.getConnectionUri() });
    try {
      await applyThrough0031(pool);
      const ids = {
        admin: fixtureUuid("101"),
        client: fixtureUuid("102"),
        expert: fixtureUuid("103"),
        tariff: fixtureUuid("104"),
        approval: fixtureUuid("105"),
      };
      await pool.query(
        `insert into users (id) values ('${ids.admin}'::uuid), ('${ids.client}'::uuid), ('${ids.expert}'::uuid)`,
      );
      await pool.query(
        `insert into admin_sessions (session_id_hash, admin_id, mfa_verified_at, expires_at) values ('upgrade-session', '${ids.admin}'::uuid, now(), now() + interval '1 hour')`,
      );
      await pool.query(
        `insert into admin_approvals (id, action, object_type, object_id, requester_id, expires_at, nonce) values ('${ids.approval}'::uuid, 'expert_residency.tariff_create', 'tariff', '${ids.tariff}'::uuid, '${ids.admin}'::uuid, now() + interval '1 hour', 'upgrade-nonce')`,
      );
      await pool.query(
        `insert into experts (id, user_id, active, verified) values ('${ids.expert}'::uuid, '${ids.expert}'::uuid, true, true)`,
      );
      await pool.query(
        `insert into expert_residency_tariff_versions (id, tariff_key, display_name, price_minor, duration_seconds, active_from, active_to, approval_id, admin_session_id_hash) values ('${ids.tariff}'::uuid, 'legacy', 'Legacy', 390000, 2592000, now() - interval '1 day', now() + interval '1 day', '${ids.approval}'::uuid, 'upgrade-session')`,
      );
      await pool.query(
        `insert into expert_residency_orders (expert_id, tariff_version_id, snapshot_display_name, price_minor, currency, duration_seconds, credit_minor, cash_minor, payment_deadline, provider_deadline, idempotency_key) values ('${ids.expert}'::uuid, '${ids.tariff}'::uuid, 'Legacy', 390000, 'RUB', 2592000, 117000, 273000, now() + interval '1 hour', now() + interval '2 hours', 'upgrade-order')`,
      );

      await applySqlMigration(
        pool,
        "packages/db/migrations/0032_commercial_core_v2_a1.sql",
      );
      await expectQuery(
        pool,
        `select policy_version, control_version from client_commercial_policy_assignments where user_id='${ids.client}'::uuid`,
        [{ policy_version: "legacy_package_v1", control_version: 1 }],
      );
      await expectQuery(
        pool,
        `select commercial_policy_version, credit_cap_bps, individual_services_enabled, group_event_limit, statistics_level, support_priority from expert_residency_tariff_versions where id='${ids.tariff}'::uuid`,
        [
          {
            commercial_policy_version: "legacy_residency_v1",
            credit_cap_bps: 5000,
            individual_services_enabled: false,
            group_event_limit: 0,
            statistics_level: "basic",
            support_priority: "standard",
          },
        ],
      );
      await expectQuery(
        pool,
        `select commercial_policy_version, credit_cap_bps, individual_services_enabled, group_event_limit, statistics_level, support_priority, price_minor, credit_minor, cash_minor from expert_residency_orders where idempotency_key='upgrade-order'`,
        [
          {
            commercial_policy_version: "legacy_residency_v1",
            credit_cap_bps: 5000,
            individual_services_enabled: false,
            group_event_limit: 0,
            statistics_level: "basic",
            support_priority: "standard",
            price_minor: "390000",
            credit_minor: "117000",
            cash_minor: "273000",
          },
        ],
      );
      await pool.query(
        `insert into users (id) values ('${fixtureUuid("106")}'::uuid)`,
      );
      await expectQuery(
        pool,
        `select count(*)::int as count from client_commercial_policy_assignments where user_id='${fixtureUuid("106")}'::uuid`,
        [{ count: 0 }],
      );
      await expect(
        pool.query(
          `update client_commercial_policy_assignments set policy_version='free_client_v2' where user_id='${ids.client}'::uuid`,
        ),
      ).rejects.toBeDefined();
      await expect(
        pool.query(
          `delete from client_commercial_policy_assignments where user_id='${ids.client}'::uuid`,
        ),
      ).rejects.toBeDefined();
      await applySqlMigration(
        pool,
        "packages/db/migrations/0033_expert_referral_maturity_a2.sql",
      );
      await expectQuery(
        pool,
        `select count(*)::int as count from expert_referral_reward_maturities`,
        [{ count: 0 }],
      );
      await expectQuery(
        pool,
        `select commercial_policy_version, credit_cap_bps, price_minor, credit_minor, cash_minor from expert_residency_orders where idempotency_key='upgrade-order'`,
        [
          {
            commercial_policy_version: "legacy_residency_v1",
            credit_cap_bps: 5000,
            price_minor: "390000",
            credit_minor: "117000",
            cash_minor: "273000",
          },
        ],
      );
    } finally {
      await pool.end();
      await container.stop();
    }
  }, 120_000);
});
