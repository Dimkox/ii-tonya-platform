import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import {
  startTestPostgres,
  type TestDatabase,
} from "../../packages/db/src/testkit/postgres.js";

const execFileAsync = promisify(execFile);
let legacyDb: TestDatabase;

type ErrorEvidence = {
  code?: unknown;
  message?: unknown;
  cause?: unknown;
};

function errorChain(error: unknown): ErrorEvidence[] {
  const evidence: ErrorEvidence[] = [];
  const seen = new Set<unknown>();
  let current = error;
  while (
    typeof current === "object" &&
    current !== null &&
    !seen.has(current)
  ) {
    seen.add(current);
    evidence.push(current as ErrorEvidence);
    current = (current as ErrorEvidence).cause;
  }
  return evidence;
}

async function relationExists(name: string): Promise<boolean> {
  const result = await legacyDb.db.execute<{ exists: boolean }>(sql`
    select to_regclass(${"public." + name}) is not null as exists
  `);
  return result.rows[0]?.exists ?? false;
}

function duplicateGuardIsFirstStatement(migration: string): boolean {
  const statements = migration
    .split("--> statement-breakpoint")
    .map((statement) => statement.trim())
    .filter(Boolean);
  const guard = statements[0] ?? "";
  return (
    guard.startsWith("DO $$") &&
    guard.includes("expert_user_identity_duplicates") &&
    !/\b(?:create|alter|drop|truncate|grant|revoke|comment)\b/iu.test(guard)
  );
}

beforeAll(async () => {
  legacyDb = await startTestPostgres();
  for (let index = 0; index <= 17; index += 1) {
    const prefix = index.toString().padStart(4, "0");
    const entry = (await import("node:fs"))
      .readdirSync("packages/db/migrations")
      .find((name) => name.startsWith(`${prefix}_`) && name.endsWith(".sql"));
    if (entry === undefined) throw new Error(`missing migration ${prefix}`);
    await legacyDb.db.$client.query(
      readFileSync(`packages/db/migrations/${entry}`, "utf8"),
    );
  }
  await legacyDb.db.execute(sql`
    insert into users (id) values
      ('10000000-0000-4000-8000-000000000001'::uuid)
  `);
  await legacyDb.db.execute(sql`
    insert into experts (id, user_id, active, verified) values
      (
        '10000000-0000-4000-8000-000000000002'::uuid,
        '10000000-0000-4000-8000-000000000001'::uuid,
        true, true
      ),
      (
        '10000000-0000-4000-8000-000000000003'::uuid,
        '10000000-0000-4000-8000-000000000001'::uuid,
        true, true
      )
  `);
}, 120_000);

afterAll(async () => legacyDb?.stop(), 60_000);

describe("expert referral 0017 to 0018 migration", () => {
  it("fails the read-only preflight with only the duplicate-group count", async () => {
    const pool = legacyDb.db.$client as unknown as {
      options: { connectionString?: string };
    };
    const databaseUrl = pool.options.connectionString;
    expect(databaseUrl).toBeTruthy();

    let caught: unknown;
    try {
      await execFileAsync(
        process.execPath,
        ["scripts/preflight-expert-referral-migration.mjs"],
        {
          env: { ...process.env, DATABASE_URL: databaseUrl },
          encoding: "utf8",
        },
      );
    } catch (error) {
      caught = error;
    }

    expect(caught).toMatchObject({
      code: 1,
      stdout: "duplicate_groups=1\n",
      stderr: "",
    });
    expect(JSON.stringify(caught)).not.toContain(
      "10000000-0000-4000-8000-000000000001",
    );
    const experts = await legacyDb.db.execute<{ count: string }>(sql`
      select count(*)::text as count from experts
    `);
    expect(experts.rows[0]?.count).toBe("2");
  });

  it("stops before any 0018 DDL with the fail-closed marker", async () => {
    const migration = readFileSync(
      "packages/db/migrations/0018_expert_residency_referrals.sql",
      "utf8",
    );
    expect(duplicateGuardIsFirstStatement(migration)).toBe(true);
    expect(
      duplicateGuardIsFirstStatement(
        `CREATE TABLE leaked_before_guard (id integer);--> statement-breakpoint\n${migration}`,
      ),
    ).toBe(false);
    let caught: unknown;
    try {
      await legacyDb.db.$client.query(migration);
    } catch (error) {
      caught = error;
    }

    expect(
      errorChain(caught).some(
        (error) =>
          error.code === "P0001" &&
          String(error.message).includes("expert_user_identity_duplicates"),
      ),
    ).toBe(true);
    for (const relation of [
      "expert_first_residency_settlements",
      "expert_referral_abuse_holds",
      "expert_referral_code_batches",
      "expert_referral_codes",
      "expert_referral_feature_controls",
      "expert_referral_issuance_overrides",
      "expert_referral_ledger_allocations",
      "expert_referral_ledger_entries",
      "expert_referral_reward_grants",
      "expert_referrals",
      "expert_residency_orders",
      "expert_residency_payment_attempts",
      "expert_residency_provider_event_inbox",
      "expert_residency_tariff_versions",
      "expert_referral_balances",
    ]) {
      await expect(relationExists(relation), relation).resolves.toBe(false);
    }

    const durableArtifacts = await legacyDb.db.execute<{ count: string }>(sql`
      select count(*)::text as count
      from (
        select t.oid
        from pg_type t
        where t.typname = any(array[
          'expert_first_settlement_eligibility',
          'expert_referral_abuse_hold_status',
          'expert_referral_batch_status',
          'expert_referral_code_status',
          'expert_referral_ledger_entry_kind',
          'expert_residency_order_status',
          'expert_residency_payment_attempt_status',
          'expert_residency_provider_event_status'
        ])
        union all
        select p.oid
        from pg_proc p
        where p.proname like '%expert_referral%'
           or p.proname like 'enforce_expert_%'
        union all
        select e.oid
        from pg_extension e
        where e.extname = 'btree_gist'
      ) artifacts
    `);
    expect(durableArtifacts.rows[0]?.count).toBe("0");
  });
});
