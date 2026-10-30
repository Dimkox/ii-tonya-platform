import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { startTestPostgres } from "../testkit/postgres.js";
it("records the two approval references and their exact catalog constraints", async () => {
  const fixture = await startTestPostgres();
  try {
    await fixture.migrate();
    const actual = await fixture.db.execute<{
      column_name: string;
      is_nullable: string;
      data_type: string;
    }>(
      sql`select column_name,is_nullable,data_type from information_schema.columns where table_schema='public' and table_name='owner_test_pricing_grants' and column_name in ('grant_approval_id','revoke_approval_id') order by column_name`,
    );
    expect(actual.rows).toEqual([
      {
        column_name: "grant_approval_id",
        is_nullable: "NO",
        data_type: "uuid",
      },
      {
        column_name: "revoke_approval_id",
        is_nullable: "YES",
        data_type: "uuid",
      },
    ]);
    const snapshot = JSON.parse(
      readFileSync("packages/db/migrations/meta/0076_snapshot.json", "utf8"),
    );
    const table = snapshot.tables["public.owner_test_pricing_grants"];
    expect(table.columns.grant_approval_id).toMatchObject({
      type: "uuid",
      notNull: true,
    });
    expect(table.columns.revoke_approval_id).toMatchObject({
      type: "uuid",
      notNull: false,
    });
    const constraints = await fixture.db.execute<{
      name: string;
      definition: string;
    }>(
      sql`select conname name, pg_get_constraintdef(oid,true) definition from pg_constraint where conrelid='owner_test_pricing_grants'::regclass and contype='f' and conname like '%approval_id%' order by conname`,
    );
    const catalog = JSON.parse(
      readFileSync(
        "packages/db/migrations/state/0076_sql_objects.json",
        "utf8",
      ),
    );
    for (const c of constraints.rows)
      expect(catalog.constraints).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: c.name, definition: c.definition }),
        ]),
      );
    expect(constraints.rows).toHaveLength(2);
  } finally {
    await fixture.stop();
  }
}, 120_000);
