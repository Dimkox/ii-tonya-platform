import { readFileSync } from "node:fs";
import { is, SQL } from "drizzle-orm";
import {
  getTableConfig,
  PgTable,
  PgDialect,
  type AnyPgTable,
} from "drizzle-orm/pg-core";
import { expect, it } from "vitest";
import * as schema from "../../packages/db/src/schema/early-bird-runtime.js";

type Snapshot = {
  tables: Record<
    string,
    {
      name: string;
      columns: Record<
        string,
        {
          type: string;
          notNull: boolean;
          primaryKey: boolean;
          default?: unknown;
        }
      >;
      indexes: Record<string, unknown>;
      foreignKeys: Record<string, unknown>;
      uniqueConstraints: Record<string, unknown>;
      checkConstraints: Record<string, unknown>;
      compositePrimaryKeys: Record<string, unknown>;
    }
  >;
};
const read = (version: string) =>
  JSON.parse(
    readFileSync(
      `packages/db/migrations/meta/${version}_snapshot.json`,
      "utf8",
    ),
  ) as Snapshot;
it("declares every 0081 relation and its columns and constraint names from the reviewed catalogue", () => {
  const prior = read("0080"),
    current = read("0081");
  const expected = Object.entries(current.tables).filter(
    ([name]) => !prior.tables[name],
  );
  const actual = (Object.values(schema) as unknown[])
    .filter((value): value is AnyPgTable => is(value, PgTable))
    .map((table) => getTableConfig(table));
  expect(actual.map((table) => table.name).sort()).toEqual(
    expected.map(([, table]) => table.name).sort(),
  );
  for (const [, table] of expected) {
    const config = actual.find((item) => item.name === table.name)!;
    expect(config.columns.map((c) => c.name).sort(), table.name).toEqual(
      Object.keys(table.columns).sort(),
    );
    for (const column of config.columns) {
      const reference = table.columns[column.name]!;
      expect(
        {
          type: column.getSQLType(),
          notNull: column.notNull,
          primaryKey: column.primary,
          hasDefault: column.hasDefault,
        },
        `${table.name}.${column.name}`,
      ).toEqual({
        type: reference.type,
        notNull: reference.notNull,
        primaryKey: reference.primaryKey,
        hasDefault: reference.default !== undefined,
      });
    }
    expect(config.checks.map((c) => c.name).sort(), table.name).toEqual(
      Object.keys(table.checkConstraints).sort(),
    );
    expect(
      config.foreignKeys.map((f) => f.getName()).sort(),
      table.name,
    ).toEqual(Object.keys(table.foreignKeys).sort());
    expect(
      config.uniqueConstraints.map((u) => u.name).sort(),
      table.name,
    ).toEqual(Object.keys(table.uniqueConstraints).sort());
    expect(config.indexes.map((i) => i.config.name).sort(), table.name).toEqual(
      Object.keys(table.indexes).sort(),
    );
    expect(
      config.primaryKeys.map((p) => p.getName()).sort(),
      table.name,
    ).toEqual(Object.keys(table.compositePrimaryKeys).sort());
  }
});

it("preserves default values, foreign-key targets/actions and constraint expressions", () => {
  const prior = read("0080"),
    current = read("0081");
  const dialect = new PgDialect();
  const render = (value: unknown): string | undefined => {
    if (value === undefined) return undefined;
    if (is(value, SQL)) {
      const query = dialect.sqlToQuery(value);
      expect(query.params).toEqual([]);
      return query.sql.trim();
    }
    return String(value).trim();
  };
  const actual = (Object.values(schema) as unknown[])
    .filter((value): value is AnyPgTable => is(value, PgTable))
    .map((table) => getTableConfig(table));
  for (const [key, reference] of Object.entries(current.tables)) {
    if (prior.tables[key]) continue;
    const config = actual.find((table) => table.name === reference.name)!;
    for (const column of config.columns) {
      expect(
        render(column.default),
        `${reference.name}.${column.name} default`,
      ).toBe(render(reference.columns[column.name]!.default));
    }
    for (const foreign of config.foreignKeys) {
      const target = foreign.reference();
      const expected = reference.foreignKeys[foreign.getName()] as {
        name: string;
        schemaTo: string;
        tableFrom: string;
        tableTo: string;
        columnsFrom: string[];
        columnsTo: string[];
        onDelete: string;
        onUpdate: string;
      };
      expect(
        {
          name: foreign.getName(),
          schemaTo: getTableConfig(target.foreignTable).schema ?? "public",
          tableFrom: config.name,
          tableTo: getTableConfig(target.foreignTable).name,
          columnsFrom: target.columns.map((column) => column.name),
          columnsTo: target.foreignColumns.map((column) => column.name),
          onDelete: foreign.onDelete ?? "no action",
          onUpdate: foreign.onUpdate ?? "no action",
        },
        foreign.getName(),
      ).toEqual(expected);
    }
    for (const check of config.checks) {
      const expected = reference.checkConstraints[check.name] as {
        value: string;
      };
      expect(render(check.value), check.name).toBe(expected.value.trim());
    }
    for (const primary of config.primaryKeys) {
      const expected = reference.compositePrimaryKeys[primary.getName()] as {
        columns: string[];
      };
      expect(
        primary.columns.map((column) => column.name),
        primary.getName(),
      ).toEqual(expected.columns);
    }
    for (const unique of config.uniqueConstraints) {
      if (unique.name === undefined)
        throw new Error("reviewed unique constraint must have a name");
      const expected = reference.uniqueConstraints[unique.name] as {
        columns: string[];
        nullsNotDistinct: boolean;
      };
      expect(
        {
          columns: unique.columns.map((column) => column.name),
          nullsNotDistinct: unique.nullsNotDistinct,
        },
        unique.name,
      ).toEqual({
        columns: expected.columns,
        nullsNotDistinct: expected.nullsNotDistinct ?? false,
      });
    }
  }
});

it("models the publication's exclusive legacy or wave payment reference", async () => {
  const { expertsPublished } =
    await import("../../packages/db/src/schema/expert-card-payments.js");
  const config = getTableConfig(expertsPublished);
  expect(
    config.columns.find((column) => column.name === "paid_order_id")?.notNull,
  ).toBe(false);
  expect(
    config.columns
      .find((column) => column.name === "wave_intent_id")
      ?.getSQLType(),
  ).toBe("uuid");
  expect(config.checks.map((check) => check.name)).toContain(
    "expert_published_exact_payment_source",
  );
});
