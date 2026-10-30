import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, expect, it } from "vitest";
import {
  startDisposableTestPostgres,
  type TestDatabase,
} from "../testkit/postgres.js";
import { requireDeferredPrincipal } from "./early-bird-deferred-principal.js";
import type { DrizzleDb } from "../client.js";
import {
  buildEarlyBirdMigrationCandidate,
  assertCandidateSourcesUnchanged,
} from "../../../../scripts/build-early-bird-migration-candidate.mjs";
import {
  buildEarlyBirdRoleProvisioningSql,
  loadEarlyBirdRoleCapabilities,
} from "../../../../scripts/provision-early-bird-runtime-roles.mjs";
const SYNTHETIC_FIXTURE_VALUE_1 = "synthetic-only";

let fixture: TestDatabase;
let directory: string;
const pools: Pool[] = [];
beforeAll(async () => {
  fixture = await startDisposableTestPostgres();
}, 120_000);
afterAll(async () => {
  await Promise.all(pools.map((p) => p.end()));
  await fixture?.stop();
  if (directory) await rm(directory, { force: true, recursive: true });
}, 120_000);

it("installs all current segments and provisions every isolated capability without cross-role or direct-table access", async () => {
  directory = await mkdtemp(path.join(tmpdir(), "early-bird-all-roles-"));
  const root = process.cwd();
  const originalJournal = await readFile(
    "packages/db/migrations/meta/_journal.json",
  );
  const observation = await buildEarlyBirdMigrationCandidate({
    root,
    output: directory,
    observeCurrentSources: true,
  });
  expect(observation.sources).toHaveLength(19);
  await migrate(fixture.db, { migrationsFolder: directory });
  const capabilities = await loadEarlyBirdRoleCapabilities();
  expect(capabilities).toHaveLength(22);
  const mapping = Object.fromEntries(
    capabilities.map((capability, i) => [
      capability.role,
      `runtime_witness_${i}`,
    ]),
  );
  for (const login of Object.values(mapping))
    await fixture.db.execute(
      sql.raw(
        `create role ${login} login password 'synthetic-only' inherit nosuperuser nocreatedb nocreaterole noreplication nobypassrls`,
      ),
    );
  const provisioningSql = await buildEarlyBirdRoleProvisioningSql(mapping);
  const admin = await fixture.db.$client.connect();
  try {
    await admin.query(provisioningSql);
    await admin.query(provisioningSql); // Idempotent exact capability grants.
  } catch (error) {
    await admin.query("ROLLBACK");
    const diagnostic = await admin.query(
      `select p.oid::regprocedure::text as function, p.prosecdef, lang.lanname from pg_proc p join pg_namespace ns on ns.oid=p.pronamespace join pg_language lang on lang.oid=p.prolang where left(ns.nspname,3)<>'pg_' and ns.nspname<>'information_schema' and (p.prosecdef or (not lang.lanpltrusted and not exists(select 1 from pg_depend dep join pg_extension ext on ext.oid=dep.refobjid where dep.classid='pg_proc'::regclass and dep.objid=p.oid and dep.refclassid='pg_extension'::regclass and dep.deptype='e' and ext.extname in ('pgcrypto','btree_gist')))) and has_function_privilege('runtime_witness_0',p.oid,'EXECUTE')`,
    );
    console.info(
      "provisioning capability",
      (error as { detail?: string }).detail,
      "unexpected public functions",
      diagnostic.rows,
    );
    throw error;
  } finally {
    admin.release();
  }
  for (const capability of capabilities) {
    const login = mapping[capability.role]!;
    const url = new URL(fixture.db.$client.options.connectionString!);
    url.username = login;
    url.password = SYNTHETIC_FIXTURE_VALUE_1;
    const pool = new Pool({ connectionString: url.toString(), max: 1 });
    pools.push(pool);
    const identity = (
      await pool.query(
        "select current_user as login, session_user as authenticated, (select rolsuper from pg_roles where rolname=current_user) as super",
      )
    ).rows[0];
    expect(identity).toEqual({ login, authenticated: login, super: false });
    const membership = await pool.query(
      "select parent.rolname as role,m.admin_option from pg_auth_members m join pg_roles child on child.oid=m.member join pg_roles parent on parent.oid=m.roleid where child.rolname=current_user",
    );
    expect(membership.rows).toEqual([
      { role: capability.role, admin_option: false },
    ]);
    const allowed = await pool.query(
      "select count(*)::integer as n from pg_proc where oid=any($1::regprocedure[]) and prosecdef and has_function_privilege(current_user,oid,'EXECUTE')",
      [capability.functions],
    );
    expect(allowed.rows[0].n).toBe(capability.functions.length);
    const extra = await pool.query(
      "select count(*)::integer as n from pg_proc p join pg_namespace ns on ns.oid=p.pronamespace where left(ns.nspname,3)<>'pg_' and ns.nspname<>'information_schema' and p.prosecdef and has_function_privilege(current_user,p.oid,'EXECUTE') and not p.oid=any($1::regprocedure[])",
      [capability.functions],
    );
    expect(extra.rows[0].n).toBe(0);
    if (capability.functions.length === 1) {
      await (drizzle(pool) as unknown as DrizzleDb).transaction(async (tx) => {
        await requireDeferredPrincipal(
          tx,
          login,
          capability.role,
          capability.functions[0]!,
        );
      });
    }
    await expect(
      pool.query("select * from early_bird_composite_intents"),
    ).rejects.toMatchObject({ code: "42501" });
    await expect(
      pool.query("select * from early_bird_deferred_receipt_contacts"),
    ).rejects.toMatchObject({ code: "42501" });
    await expect(
      pool.query("create table public.forbidden_runtime_write(id integer)"),
    ).rejects.toMatchObject({ code: "42501" });
  }
  const migrationOwner = (
    await fixture.db.execute<{ name: string }>(sql`select current_user as name`)
  ).rows[0]!.name;
  const ownerMapping = await buildEarlyBirdRoleProvisioningSql({
    [capabilities[0]!.role]: migrationOwner,
  });
  const rejected = await fixture.db.$client.connect();
  try {
    await expect(rejected.query(ownerMapping)).rejects.toMatchObject({
      message: "early_bird_role_login_unsafe",
    });
    await rejected.query("ROLLBACK");
    // An existing runtime login that accidentally gained table access must be
    // rejected, not silently stripped or provisioned as though still isolated.
    await rejected.query(
      "grant select on early_bird_composite_intents to runtime_witness_0",
    );
    await expect(rejected.query(provisioningSql)).rejects.toMatchObject({
      message: "early_bird_role_extra_privilege",
    });
    await rejected.query("ROLLBACK");
    await rejected.query(
      "revoke select on early_bird_composite_intents from runtime_witness_0",
    );
  } finally {
    await rejected.query("ROLLBACK");
    rejected.release();
  }
  expect(
    (
      await fixture.db.execute(
        sql`select count(*)::integer as n from early_bird_payment_successes`,
      )
    ).rows[0]?.n,
  ).toBe(0);
  expect(await readFile("packages/db/migrations/meta/_journal.json")).toEqual(
    originalJournal,
  );
  await assertCandidateSourcesUnchanged(root, observation);
  console.info(
    `all-role candidate SHA256=${observation.candidateSha256}; isolated_capabilities=${capabilities.length}; segments=${observation.sources.length}`,
  );
}, 120_000);
