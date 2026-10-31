import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { startTestPostgres } from "../testkit/postgres.js";
import { replayMigrationsThrough } from "../testkit/replay-migrations-through.js";
import {
  constraintStateSql,
  indexStateSql,
  normalizeMigrationSnapshot,
} from "../testkit/migration-state.js";

it("reproduces early-bird positive price snapshot and SQL objects from a fresh SQL replay", async () => {
  const fixture = await startTestPostgres();
  const out = mkdtempSync(join(tmpdir(), "owner-state-test-"));
  try {
    await replayMigrationsThrough(fixture.db, 79);
    const connection = fixture.db.$client.options.connectionString;
    expect(connection).toBeTruthy();
    const result = spawnSync(
      process.execPath,
      [
        "node_modules/drizzle-kit/bin.cjs",
        "introspect",
        "--dialect=postgresql",
        `--url=${connection}`,
        `--out=${out}`,
      ],
      { stdio: "ignore", timeout: 90_000 },
    );
    expect(result.status).toBe(0);
    const constraints = (await fixture.db.execute(sql.raw(constraintStateSql)))
      .rows;
    const indexes = (await fixture.db.execute(sql.raw(indexStateSql))).rows;
    const actual = normalizeMigrationSnapshot(
      JSON.parse(readFileSync(join(out, "meta/0000_snapshot.json"), "utf8")),
      { constraints: constraints as never, indexes: indexes as never },
    );
    const expected = JSON.parse(
      readFileSync("packages/db/migrations/meta/0079_snapshot.json", "utf8"),
    );
    actual.id = expected.id;
    actual.prevId = expected.prevId;
    expect(actual).toEqual(expected);
    const catalog = JSON.parse(
      readFileSync(
        "packages/db/migrations/state/0079_sql_objects.json",
        "utf8",
      ),
    );
    expect(catalog.constraints).toEqual(constraints);
    expect(catalog.indexes).toEqual(indexes);
    const functions = (
      await fixture.db.execute(
        sql`select p.proname name,pg_get_function_identity_arguments(p.oid) arguments,pg_get_functiondef(p.oid) definition from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and not exists(select 1 from pg_depend d where d.classid='pg_proc'::regclass and d.objid=p.oid and d.deptype='e') order by name,arguments`,
      )
    ).rows;
    const triggers = (
      await fixture.db.execute(
        sql`select c.relname table_name,t.tgname name,pg_get_triggerdef(t.oid,true) definition,t.tgenabled enabled from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and not t.tgisinternal order by table_name,name`,
      )
    ).rows;
    expect(catalog.functions).toEqual(functions);
    expect(catalog.triggers).toEqual(triggers);
  } finally {
    rmSync(out, { recursive: true, force: true });
    await fixture.stop();
  }
}, 180_000);
