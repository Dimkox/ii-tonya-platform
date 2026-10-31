import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Pool } from "pg";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, expect, it } from "vitest";
import {
  startDisposableTestPostgres,
  type TestDatabase,
} from "../testkit/postgres.js";
// The candidate builder writes only to the disposable directory supplied here.
import {
  buildEarlyBirdMigrationCandidate,
  assertCandidateSourcesUnchanged,
} from "../../../../scripts/build-early-bird-migration-candidate.mjs";
const SYNTHETIC_FIXTURE_VALUE_1 = "synthetic-only";

let fixture: TestDatabase;
let limited: Pool;
let directory: string;
beforeAll(async () => {
  fixture = await startDisposableTestPostgres();
}, 120_000);
afterAll(async () => {
  await limited?.end();
  await fixture?.stop();
  if (directory) await rm(directory, { recursive: true, force: true });
}, 120_000);

it("replays the pinned historical chain through 0081 and keeps the limited legacy capability isolated", async () => {
  const root = process.cwd();
  const journalPath = path.join(
    root,
    "packages/db/migrations/meta/_journal.json",
  );
  const priorJournal = await readFile(journalPath);
  directory = await mkdtemp(path.join(tmpdir(), "early-bird-aggregate-"));
  // Historical migration witness, not current runtime/release coverage. Both
  // source segments and the 0000..0081 SQL are bound to their committed hashes.
  const observation = await buildEarlyBirdMigrationCandidate({
    root,
    output: directory,
    observeCurrentSources: false,
  });
  const bytes = await readFile(path.join(directory, `${observation.tag}.sql`));
  expect(createHash("sha256").update(bytes).digest("hex")).toBe(
    observation.candidateSha256,
  );
  await migrate(fixture.db, { migrationsFolder: directory });
  expect(await readFile(journalPath)).toEqual(priorJournal);
  await assertCandidateSourcesUnchanged(root, observation);
  const schema = (
    await fixture.db.execute(
      sql`select (select count(*)::integer from drizzle.__drizzle_migrations) as migrations, (select phase from early_bird_launch_configs where active) as phase, to_regclass('public.early_bird_composite_intents') is not null as intents, to_regclass('public.early_bird_deferred_accounts') is not null as deferred, to_regclass('public.receipt_revocation_outbox') is not null as revocations, to_regprocedure('early_bird_private.owner_admit_send(uuid,uuid,uuid,text)') is not null as admission, exists(select 1 from pg_roles where rolname='ii_tonya_wave_gateway') as gateway_role`,
    )
  ).rows[0];
  expect(schema).toEqual({
    migrations: 82,
    phase: "PUBLIC_LAUNCH",
    intents: true,
    deferred: true,
    revocations: true,
    admission: true,
    gateway_role: false,
  });
  const user = await fixture.createUser();
  await fixture.db.execute(
    sql.raw(
      "create role aggregate_legacy_login login password 'synthetic-only' noinherit nosuperuser nocreatedb nocreaterole nobypassrls",
    ),
  );
  const address = new URL(fixture.db.$client.options.connectionString!);
  address.username = "aggregate_legacy_login";
  address.password = SYNTHETIC_FIXTURE_VALUE_1;
  limited = new Pool({ connectionString: address.toString(), max: 1 });
  await expect(
    limited.query("select early_bird_touch_coverage_epoch($1::uuid)", [user]),
  ).rejects.toMatchObject({ code: "42501" });
  await fixture.db.transaction(async (tx) => {
    await tx.execute(
      sql`select set_config('ii_tonya.legacy_settlement_role','aggregate_legacy_login',true)`,
    );
    await tx.execute(
      sql.raw(
        await readFile(
          "scripts/sql/provision-early-bird-legacy-coverage.sql",
          "utf8",
        ),
      ),
    );
  });
  await limited.query("select early_bird_touch_coverage_epoch($1::uuid)", [
    user,
  ]);
  expect(
    (
      await limited.query(
        "select early_bird_active_coverage_end($1::uuid) as ends",
        [user],
      )
    ).rows[0].ends,
  ).toBeNull();
  await expect(
    limited.query("select * from early_bird_payment_successes"),
  ).rejects.toMatchObject({ code: "42501" });
  await expect(
    limited.query(
      "select early_bird_commit_verified_payment('{}'::jsonb,'x',now())",
    ),
  ).rejects.toMatchObject({ code: "42501" });
  await expect(
    limited.query(
      "select early_bird_private.find_verified_payment('operation','x')",
    ),
  ).rejects.toMatchObject({ code: "42501" });
  expect(
    (
      await fixture.db.execute(
        sql`select count(*)::integer as n from early_bird_payment_successes`,
      )
    ).rows[0]?.n,
  ).toBe(0);
  await assertCandidateSourcesUnchanged(root, observation);
  console.info(
    `temporary candidate SHA256=${observation.candidateSha256}; segments=${observation.sources.length}`,
  );
}, 120_000);
