import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, beforeAll, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { createDb, migrateDb } from "../client.js";
import { applyEarlyBirdDraftIfNeeded } from "../testkit/early-bird-draft-helper.js";
import {
  startExpertReferralTestDatabase,
  type ExpertReferralTestDatabase,
} from "../testkit/expert-referral.js";
let db: ExpertReferralTestDatabase;
beforeAll(async () => {
  db = await startExpertReferralTestDatabase(undefined, {
    forceDisposableCluster: true,
  });
}, 120_000);
afterAll(async () => {
  await db?.stop();
}, 120_000);
it("replays the canonical journal in two databases and verifies the promoted draft without provisioning roles", async () => {
  const source =
    "docs/superpowers/implementation-artifacts/drafts/0081_early_bird_composite.sql";
  const draft = readFileSync(source, "utf8");
  // The canonical journal already installed this draft. Pin the precise former
  // failure, then validate its installed hash/content instead of recreating DDL.
  await expect(db.db.execute(sql.raw(draft))).rejects.toMatchObject({
    cause: {
      code: "42P07",
      message: 'relation "early_bird_composite_intents" already exists',
    },
  });
  await applyEarlyBirdDraftIfNeeded(db.db, source);
  const before = (
    await db.db.execute<{ n: number }>(
      sql`select count(*)::int n from pg_roles where rolname='ii_tonya_wave_verifier'`,
    )
  ).rows[0]!.n;
  expect(before).toBe(0);
  await db.db.$client.query("create database early_bird_replay_secondary");
  const testConnection = new URL(db.db.$client.options.connectionString!);
  testConnection.pathname = "/early_bird_replay_secondary";
  const second = createDb(testConnection.toString());
  try {
    await migrateDb(second, resolve("packages/db/migrations"));
    await applyEarlyBirdDraftIfNeeded(second, source);
    expect(
      (
        await second.execute<{ n: number }>(
          sql`select count(*)::int n from pg_roles where rolname='ii_tonya_wave_verifier'`,
        )
      ).rows[0]!.n,
    ).toBe(0);
    expect(
      (
        await second.execute<{ exists: boolean }>(
          sql`select to_regprocedure('early_bird_private.bind_verified(uuid,uuid,text,text,jsonb)') is not null as exists`,
        )
      ).rows[0]?.exists,
    ).toBe(true);
  } finally {
    await second.$client.end();
    await db.db.$client.query("drop database early_bird_replay_secondary");
  }
}, 120_000);
