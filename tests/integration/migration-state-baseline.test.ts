import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, expect, it } from "vitest";
import {
  startTestPostgres,
  type TestDatabase,
} from "../../packages/db/src/testkit/postgres.js";
import { createDb, type DrizzleDb } from "../../packages/db/src/client.js";
import {
  constraintStateSql,
  indexStateSql,
  normalizeMigrationSnapshot,
  type ConstraintState,
  type IndexState,
} from "../../packages/db/src/testkit/migration-state.js";

const dbRequire = createRequire(
  new URL("../../packages/db/package.json", import.meta.url),
);
const { PostgreSqlContainer } = dbRequire("@testcontainers/postgresql") as {
  PostgreSqlContainer: new (image: string) => {
    start(): Promise<{ getConnectionUri(): string; stop(): Promise<unknown> }>;
  };
};

const folder = "packages/db/migrations";
const read = (path: string) => JSON.parse(readFileSync(path, "utf8"));
let database: TestDatabase | undefined;
let output: string | undefined;

beforeAll(async () => {
  // This baseline is version-specific. Never inherit the shared PG16 default
  // or an arbitrary external admin URL for state reconstruction evidence.
  let db: DrizzleDb;
  database = await startTestPostgres({
    startContainer: () =>
      new PostgreSqlContainer("postgres:17.5-bookworm").start(),
    createPool: (connection) => {
      db = createDb(connection);
      return db.$client;
    },
    createDb: () => db,
  });
  const journal = read(`${folder}/meta/_journal.json`);
  for (const entry of journal.entries.filter(
    (e: { idx: number }) => e.idx <= 39,
  )) {
    await database.db.execute(
      sql.raw(readFileSync(`${folder}/${entry.tag}.sql`, "utf8")),
    );
  }
}, 120_000);

afterAll(async () => {
  try {
    await database?.stop();
  } finally {
    if (output) rmSync(output, { recursive: true, force: true });
  }
}, 120_000);

it("reproduces the committed snapshot from SQL, including all supported database objects", async () => {
  const version = await database!.db.execute<{ version: string }>(
    sql`select current_setting('server_version_num') version`,
  );
  expect(version.rows[0]?.version).toBe("170005");
  output = mkdtempSync(join(tmpdir(), "ii-tonya-migration-state-"));
  const connection = database!.db.$client.options.connectionString;
  if (!connection) throw new Error("test_database_connection_missing");
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
      {
        stdio: "ignore",
        timeout: 60_000,
      },
    );
    child.on("error", () =>
      reject(new Error("disposable_introspection_failed")),
    );
    child.on("exit", (code) =>
      code === 0
        ? resolve()
        : reject(new Error("disposable_introspection_failed")),
    );
  });
  const constraints = await database!.db.execute<
    ConstraintState & Record<string, unknown>
  >(sql.raw(constraintStateSql));
  const indexes = await database!.db.execute<
    IndexState & Record<string, unknown>
  >(sql.raw(indexStateSql));
  const actual = normalizeMigrationSnapshot(
    read(join(output, "meta/0000_snapshot.json")),
    { constraints: constraints.rows, indexes: indexes.rows },
  );
  const expected = read(`${folder}/meta/0039_snapshot.json`);
  actual.id = expected.id;
  actual.prevId = expected.prevId;
  expect(actual).toEqual(expected);
}, 90_000);

it("preserves exact functions, triggers, exclusion constraints and extensions omitted by Drizzle", async () => {
  const expected = read(`${folder}/state/0039_sql_objects.json`);
  const functions = await database!.db.execute(sql`
    select p.proname name, pg_get_function_identity_arguments(p.oid) arguments,
      pg_get_functiondef(p.oid) definition
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and not exists(select 1 from pg_depend d
      where d.classid='pg_proc'::regclass and d.objid=p.oid and d.deptype='e')
    order by name, arguments`);
  const triggers = await database!.db.execute(sql`
    select c.relname table_name,t.tgname name,pg_get_triggerdef(t.oid,true) definition,
      t.tgenabled enabled from pg_trigger t join pg_class c on c.oid=t.tgrelid
    join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and not t.tgisinternal order by table_name,name`);
  const exclusions = await database!.db.execute(sql`
    select r.relname table_name,c.conname name,pg_get_constraintdef(c.oid,true) definition
    from pg_constraint c join pg_class r on r.oid=c.conrelid
    join pg_namespace n on n.oid=c.connamespace
    where n.nspname='public' and c.contype='x' order by table_name,name`);
  const extensions = await database!.db.execute(sql`
    select extname name,extversion version from pg_extension where extname<>'plpgsql' order by name`);
  const constraints = await database!.db.execute(sql.raw(constraintStateSql));
  const indexes = await database!.db.execute(sql.raw(indexStateSql));
  expect({
    functions: functions.rows,
    triggers: triggers.rows,
    exclusionConstraints: exclusions.rows,
    extensions: extensions.rows,
    constraints: constraints.rows,
    indexes: indexes.rows,
  }).toEqual(expected);
});
