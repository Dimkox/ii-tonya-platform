import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, expect, it } from "vitest";
import {
  startDisposableTestPostgres,
  type TestDatabase,
} from "../../packages/db/src/testkit/postgres.js";
import {
  captureMigrationSqlState,
  normalizeMigrationSnapshot,
} from "../../packages/db/src/testkit/migration-state.js";
import { replayMigrationsThrough } from "../../packages/db/src/testkit/replay-migrations-through.js";
import {
  buildEarlyBirdRoleProvisioningSql,
  loadEarlyBirdRoleCapabilities,
} from "../../scripts/provision-early-bird-runtime-roles.mjs";
const SYNTHETIC_FIXTURE_VALUE_1 = "synthetic-only";

const folder = "packages/db/migrations";
const dbRequire = createRequire(
  new URL("../../packages/db/package.json", import.meta.url),
);
const { Pool } = dbRequire("pg") as {
  Pool: new (options: {
    connectionString: string;
    max: number;
  }) => TestDatabase["db"]["$client"];
};
const latest = 82;
const tag = String(latest).padStart(4, "0");
const previousTag = String(latest - 1).padStart(4, "0");
const read = (path: string) => JSON.parse(readFileSync(path, "utf8"));
const digest = (path: string) =>
  createHash("sha256").update(readFileSync(path)).digest("hex");
let database: TestDatabase;
let output: string;
const limitedPools: TestDatabase["db"]["$client"][] = [];
beforeAll(async () => {
  database = await startDisposableTestPostgres();
  await replayMigrationsThrough(database.db, latest);
}, 120_000);
afterAll(async () => {
  await Promise.all(limitedPools.map((pool) => pool.end()));
  await database?.stop();
  if (output) rmSync(output, { recursive: true, force: true });
}, 120_000);

it(`reproduces canonical ${tag} state and private capability ACLs from an independent full PostgreSQL replay`, async () => {
  const version = (
    await database.db.execute(
      sql`select current_setting('server_version_num') version`,
    )
  ).rows[0]?.version;
  expect(version).toBe("170005");
  const journal = read(`${folder}/meta/_journal.json`);
  expect(
    journal.entries.find((entry: { idx: number }) => entry.idx === latest),
  ).toMatchObject({
    idx: latest,
    tag: "0082_early_bird_worker_capabilities",
    breakpoints: true,
  });
  const expected = read(`${folder}/meta/${tag}_snapshot.json`);
  const manifest = read(`${folder}/state/${tag}_manifest.json`);
  expect(expected.prevId).toBe(
    read(`${folder}/meta/${previousTag}_snapshot.json`).id,
  );
  expect(manifest.migrations).toHaveLength(latest + 1);
  for (const entry of journal.entries.filter(
    (entry: { idx: number }) => entry.idx <= latest,
  ))
    expect(manifest.migrations[entry.idx]).toEqual({
      idx: entry.idx,
      tag: entry.tag,
      sha256: digest(`${folder}/${entry.tag}.sql`),
    });
  expect(manifest.snapshotSha256).toBe(
    digest(`${folder}/meta/${tag}_snapshot.json`),
  );
  expect(manifest.sqlObjectsSha256).toBe(
    digest(`${folder}/state/${tag}_sql_objects.json`),
  );
  expect(manifest.generatePermitted).toBe(false);
  expect(manifest.drizzleKitVersion).toBe("0.31.10");
  output = mkdtempSync(join(tmpdir(), `ii-tonya-${tag}-state-validation-`));
  const connection = database.db.$client.options.connectionString;
  if (!connection) throw new Error("disposable_connection_missing");
  await new Promise<void>((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [
        "node_modules/drizzle-kit/bin.cjs",
        "introspect",
        "--dialect=postgresql",
        `--url=${connection}`,
        `--out=${output}`,
      ],
      { stdio: "ignore", timeout: 120_000 },
    );
    child.once("error", () =>
      reject(new Error("disposable_introspection_failed")),
    );
    child.once("exit", (code) =>
      code === 0
        ? resolve()
        : reject(new Error("disposable_introspection_failed")),
    );
  });
  const state = await captureMigrationSqlState(database.db, true);
  expect(state).toEqual(read(`${folder}/state/${tag}_sql_objects.json`));
  const actual = normalizeMigrationSnapshot(
    read(join(output, "meta/0000_snapshot.json")),
    { constraints: state.constraints, indexes: state.indexes },
  );
  actual.id = expected.id;
  actual.prevId = expected.prevId;
  expect(actual).toEqual(expected);
  expect(Object.keys(actual.tables)).toHaveLength(275);
  expect(state.functions).toHaveLength(270);
  expect(state.triggers).toHaveLength(269);
  expect(state.constraints).toHaveLength(1871);
  expect(state.indexes).toHaveLength(661);
  expect(
    state.functions.filter((row) =>
      String(row.definition).includes("FUNCTION early_bird_private."),
    ),
  ).toHaveLength(7);
  if (!("schemas" in state) || !("functionPrivileges" in state))
    throw new Error("private_state_evidence_missing");
  expect(state.schemas).toEqual([
    { name: "early_bird_private", public_usage: false, public_create: false },
  ]);
  const privileged = state.functionPrivileges.filter(
    (row) => row.security_definer === true,
  );
  expect(privileged.length).toBeGreaterThan(0);
  expect(privileged.every((row) => row.public_execute === false)).toBe(true);
  // Old baseline consumers retain their public-only object shape. No historical
  // artifacts or public-only extraction semantics are silently rewritten.
  const historical = await captureMigrationSqlState(database.db);
  expect(Object.keys(historical).sort()).toEqual([
    "constraints",
    "exclusionConstraints",
    "extensions",
    "functions",
    "indexes",
    "triggers",
  ]);
  expect(
    historical.functions.some((row) =>
      String(row.definition).includes("FUNCTION early_bird_private."),
    ),
  ).toBe(false);
  const capabilities = (await loadEarlyBirdRoleCapabilities()).filter(
    (capability) => capability.migration <= latest,
  );
  expect(capabilities).toHaveLength(26);
  const mapping = Object.fromEntries(
    capabilities.map((capability, index) => [
      capability.role,
      `state_runtime_${index}`,
    ]),
  );
  for (const login of Object.values(mapping))
    await database.db.execute(
      sql.raw(
        `create role ${login} login password 'synthetic-only' inherit nosuperuser nocreatedb nocreaterole noreplication nobypassrls`,
      ),
    );
  const provisioning = await buildEarlyBirdRoleProvisioningSql(mapping);
  const operator = await database.db.$client.connect();
  try {
    await operator.query(provisioning);
    await operator.query(provisioning);
    for (const capability of capabilities) {
      const login = mapping[capability.role]!;
      const address = new URL(connection);
      address.username = login;
      address.password = SYNTHETIC_FIXTURE_VALUE_1;
      const pool = new Pool({ connectionString: address.toString(), max: 1 });
      limitedPools.push(pool);
      expect(
        (await pool.query("select current_user as login")).rows[0]?.login,
      ).toBe(login);
      expect(
        (
          await pool.query(
            "select parent.rolname as role,m.admin_option from pg_auth_members m join pg_roles child on child.oid=m.member join pg_roles parent on parent.oid=m.roleid where child.rolname=current_user",
          )
        ).rows,
      ).toEqual([{ role: capability.role, admin_option: false }]);
      expect(
        (
          await pool.query(
            "select count(*)::integer as n from pg_proc where oid=any($1::regprocedure[]) and prosecdef and has_function_privilege(current_user,oid,'EXECUTE')",
            [capability.functions],
          )
        ).rows[0]?.n,
      ).toBe(capability.functions.length);
      expect(
        (
          await pool.query(
            "select count(*)::integer as n from pg_proc p join pg_namespace ns on ns.oid=p.pronamespace where left(ns.nspname,3)<>'pg_' and ns.nspname<>'information_schema' and p.prosecdef and has_function_privilege(current_user,p.oid,'EXECUTE') and not p.oid=any($1::regprocedure[])",
            [capability.functions],
          )
        ).rows[0]?.n,
      ).toBe(0);
      await expect(
        pool.query("select * from early_bird_composite_intents"),
      ).rejects.toMatchObject({ code: "42501" });
      await expect(
        pool.query("select * from early_bird_deferred_receipt_contacts"),
      ).rejects.toMatchObject({ code: "42501" });
      await expect(
        pool.query("create table public.forbidden_state_runtime(id integer)"),
      ).rejects.toMatchObject({ code: "42501" });
    }
    const owner = (await operator.query("select current_user as name")).rows[0]
      .name as string;
    await expect(
      operator.query(
        await buildEarlyBirdRoleProvisioningSql({
          [capabilities[0]!.role]: owner,
        }),
      ),
    ).rejects.toMatchObject({ message: "early_bird_role_login_unsafe" });
    await operator.query("ROLLBACK");
    await operator.query(
      "grant select on early_bird_composite_intents to state_runtime_0",
    );
    await expect(operator.query(provisioning)).rejects.toMatchObject({
      message: "early_bird_role_extra_privilege",
    });
    await operator.query("ROLLBACK");
    await operator.query(
      "revoke select on early_bird_composite_intents from state_runtime_0",
    );
  } finally {
    await operator.query("ROLLBACK");
    operator.release();
  }
  expect(
    (
      await database.db.execute(
        sql`select count(*)::integer as n from early_bird_payment_successes`,
      )
    ).rows[0]?.n,
  ).toBe(0);
}, 180_000);
