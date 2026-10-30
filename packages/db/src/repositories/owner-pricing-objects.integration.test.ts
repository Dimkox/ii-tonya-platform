import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { startTestPostgres } from "../testkit/postgres.js";
import { replayMigrationsThrough } from "../testkit/replay-migrations-through.js";
it("reproduces all function and trigger definitions and enablement from SQL", async () => {
  const fixture = await startTestPostgres();
  try {
    await replayMigrationsThrough(fixture.db, 76);
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
    const catalog = JSON.parse(
      readFileSync(
        "packages/db/migrations/state/0076_sql_objects.json",
        "utf8",
      ),
    );
    expect(functions).toEqual(catalog.functions);
    expect(triggers).toEqual(catalog.triggers);
  } finally {
    await fixture.stop();
  }
}, 120_000);
