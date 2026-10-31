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

it("reproduces the grant snapshot from a fresh SQL replay", async () => {
  const fixture = await startTestPostgres();
  const out = mkdtempSync(join(tmpdir(), "owner-state-test-"));
  try {
    await replayMigrationsThrough(fixture.db, 76);
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
      readFileSync("packages/db/migrations/meta/0076_snapshot.json", "utf8"),
    );
    actual.id = expected.id;
    actual.prevId = expected.prevId;
    expect(actual).toEqual(expected);
    const catalog = JSON.parse(
      readFileSync(
        "packages/db/migrations/state/0076_sql_objects.json",
        "utf8",
      ),
    );
    expect(catalog.constraints).toEqual(constraints);
    expect(catalog.indexes).toEqual(indexes);
    expect(catalog.functions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "owner_test_pricing_grant_guard",
        }),
      ]),
    );
    expect(catalog.triggers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "owner_test_pricing_grant_guard",
        }),
      ]),
    );
  } finally {
    rmSync(out, { recursive: true, force: true });
    await fixture.stop();
  }
}, 180_000);
