import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { startTestPostgres } from "../testkit/postgres.js";
it("preserves the subject advisory-lock grant guard in the 0076 catalogue", async () => {
  const fixture = await startTestPostgres();
  try {
    const base = "packages/db/migrations";
    const journal = JSON.parse(
      readFileSync(`${base}/meta/_journal.json`, "utf8"),
    );
    for (const entry of journal.entries.filter(
      (e: { idx: number }) => e.idx <= 76,
    ))
      await fixture.db.execute(
        sql.raw(readFileSync(`${base}/${entry.tag}.sql`, "utf8")),
      );
    const result = await fixture.db.execute<{
      name: string;
      arguments: string;
      definition: string;
    }>(
      sql`select p.proname name,pg_get_function_identity_arguments(p.oid) arguments,pg_get_functiondef(p.oid) definition from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='owner_test_pricing_grant_guard'`,
    );
    const catalog = JSON.parse(
      readFileSync(`${base}/state/0076_sql_objects.json`, "utf8"),
    );
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]!.definition).toContain("pg_advisory_xact_lock");
    expect(catalog.functions).toEqual(expect.arrayContaining(result.rows));
  } finally {
    await fixture.stop();
  }
}, 120_000);
