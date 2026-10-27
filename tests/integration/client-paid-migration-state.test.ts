import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, expect, it } from "vitest";
import {
  startTestPostgres,
  type TestDatabase,
} from "../../packages/db/src/testkit/postgres.js";
import {
  constraintStateSql,
  indexStateSql,
  normalizeMigrationSnapshot,
  type ConstraintState,
  type IndexState,
} from "../../packages/db/src/testkit/migration-state.js";

const folder = "packages/db/migrations";
const read = (path: string) => JSON.parse(readFileSync(path, "utf8"));
let database: TestDatabase | undefined;
let output: string | undefined;

beforeAll(async () => {
  database = await startTestPostgres();
  expect(
    (await database.db.execute(sql`show server_version_num`)).rows[0],
  ).toEqual({ server_version_num: "170005" });
  const journal = read(`${folder}/meta/_journal.json`);
  for (const entry of journal.entries.filter(
    (e: { idx: number }) => e.idx <= 42,
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

it("reproduces paid-order snapshot0042 from PostgreSQL with correct predecessor", async () => {
  const expected = read(`${folder}/meta/0042_snapshot.json`);
  expect(expected.prevId).toBe(read(`${folder}/meta/0041_snapshot.json`).id);
  output = mkdtempSync(join(tmpdir(), "ii-tonya-paid-state-check-"));
  const connection = database!.db.$client.options.connectionString;
  if (!connection) throw new Error("test_connection_missing");
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
      { stdio: "ignore", timeout: 60_000 },
    );
    child.on("error", () => reject(new Error("introspection_failed")));
    child.on("exit", (code) =>
      code === 0 ? resolve() : reject(new Error("introspection_failed")),
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
  actual.id = expected.id;
  actual.prevId = expected.prevId;
  expect(actual).toEqual(expected);
}, 90_000);

it("preserves paid-order constraints and append-only triggers in SQL-only evidence", async () => {
  const functions = await database!.db.execute(
    sql`select p.proname name,pg_get_function_identity_arguments(p.oid) arguments,pg_get_functiondef(p.oid) definition from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and not exists(select 1 from pg_depend d where d.classid='pg_proc'::regclass and d.objid=p.oid and d.deptype='e') order by name,arguments`,
  );
  const triggers = await database!.db.execute(
    sql`select c.relname table_name,t.tgname name,pg_get_triggerdef(t.oid,true) definition,t.tgenabled enabled from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and not t.tgisinternal order by table_name,name`,
  );
  const exclusionConstraints = await database!.db.execute(
    sql`select r.relname table_name,c.conname name,pg_get_constraintdef(c.oid,true) definition from pg_constraint c join pg_class r on r.oid=c.conrelid join pg_namespace n on n.oid=c.connamespace where n.nspname='public' and c.contype='x' order by table_name,name`,
  );
  const extensions = await database!.db.execute(
    sql`select extname name,extversion version from pg_extension where extname<>'plpgsql' order by name`,
  );
  const constraints = await database!.db.execute(sql.raw(constraintStateSql));
  const indexes = await database!.db.execute(sql.raw(indexStateSql));
  expect({
    functions: functions.rows,
    triggers: triggers.rows,
    exclusionConstraints: exclusionConstraints.rows,
    extensions: extensions.rows,
    constraints: constraints.rows,
    indexes: indexes.rows,
  }).toEqual(read(`${folder}/state/0042_sql_objects.json`));
});
