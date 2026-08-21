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
    await expect(relationExists("expert_referral_code_batches")).resolves.toBe(
      false,
    );
    await expect(
      relationExists("expert_referral_feature_controls"),
    ).resolves.toBe(false);
  });
});
