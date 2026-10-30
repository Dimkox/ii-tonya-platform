import { readFileSync } from "node:fs";
import { getTableConfig } from "drizzle-orm/pg-core";
import { expect, it } from "vitest";
import { earlyBirdLaunchKitJobs } from "../../packages/db/src/schema/early-bird-launch-kit.js";
it("matches the independently reconstructed 0083 launch-kit ledger, including user-only FK", () => {
  const snapshot = JSON.parse(
    readFileSync("packages/db/migrations/meta/0083_snapshot.json", "utf8"),
  );
  const previous = JSON.parse(
    readFileSync("packages/db/migrations/meta/0082_snapshot.json", "utf8"),
  );
  expect(
    Object.keys(snapshot.tables).filter((name) => !previous.tables[name]),
  ).toEqual(["public.early_bird_launch_kit_jobs"]);
  const expected = snapshot.tables["public.early_bird_launch_kit_jobs"];
  const config = getTableConfig(earlyBirdLaunchKitJobs);
  expect(config.columns.map((column) => column.name).sort()).toEqual(
    Object.keys(expected.columns).sort(),
  );
  for (const column of config.columns) {
    const saved = expected.columns[column.name];
    expect({
      type: column.getSQLType(),
      notNull: column.notNull,
      primaryKey: column.primary,
      hasDefault: column.hasDefault,
    }).toEqual({
      type: saved.type,
      notNull: saved.notNull,
      primaryKey: saved.primaryKey,
      hasDefault: saved.default !== undefined,
    });
  }
  expect(config.foreignKeys.map((key) => key.getName())).toEqual([
    "early_bird_launch_kit_jobs_user_id_fkey",
  ]);
  expect(config.uniqueConstraints.map((item) => item.name)).toEqual(
    Object.keys(expected.uniqueConstraints),
  );
  expect(config.checks.map((item) => item.name).sort()).toEqual(
    Object.keys(expected.checkConstraints).sort(),
  );
  expect(config.indexes.map((item) => item.config.name)).toEqual(
    Object.keys(expected.indexes),
  );
});
