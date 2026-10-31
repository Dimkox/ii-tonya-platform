import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
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

const folder = "packages/db/migrations";
const latest = 85;
const tag = "0085";
const read = (path: string) => JSON.parse(readFileSync(path, "utf8"));
const digest = (path: string) =>
  createHash("sha256").update(readFileSync(path)).digest("hex");
let database: TestDatabase;
let output: string;
beforeAll(async () => {
  database = await startDisposableTestPostgres();
  await database.migrate();
}, 120_000);
afterAll(async () => {
  try {
    await database?.stop();
  } finally {
    if (output) rmSync(output, { recursive: true, force: true });
  }
}, 120_000);

it("reproduces canonical0085 snapshot and exact SQL state from a full PostgreSQL17.5 replay", async () => {
  expect(
    (await database.db.execute(sql`show server_version_num`)).rows[0]
      ?.server_version_num,
  ).toBe("170005");
  const journal = read(`${folder}/meta/_journal.json`);
  expect(journal.entries.at(-1)).toMatchObject({
    idx: latest,
    tag: "0085_resident_native_uuid_sources",
    breakpoints: true,
  });
  const expected = read(`${folder}/meta/${tag}_snapshot.json`);
  const manifest = read(`${folder}/state/${tag}_manifest.json`);
  expect(expected.prevId).toBe(read(`${folder}/meta/0084_snapshot.json`).id);
  expect(manifest.migrations).toHaveLength(latest + 1);
  expect(manifest.migrations.slice(0, latest)).toEqual(
    read(`${folder}/state/0084_manifest.json`).migrations,
  );
  for (const entry of journal.entries)
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
  expect(manifest.databaseVersion).toBe("170005");
  expect(manifest.drizzleKitVersion).toBe("0.31.10");
  expect(manifest.generatePermitted).toBe(false);
  const state = await captureMigrationSqlState(database.db, true, true);
  expect(state).toEqual(read(`${folder}/state/${tag}_sql_objects.json`));
  expect(state.functions).toHaveLength(325);
  expect(state.triggers).toHaveLength(293);
  expect(state.constraints).toHaveLength(1922);
  expect(state.indexes).toHaveLength(672);
  if (!("schemas" in state) || !("functionPrivileges" in state))
    throw new Error("private_state_evidence_missing");
  expect(state.schemas).toEqual([
    { name: "early_bird_private", public_usage: false, public_create: false },
  ]);
  expect(
    state.functionPrivileges.filter(
      (entry) => entry.schema === "early_bird_private",
    ),
  ).toHaveLength(55);
  expect(
    state.functionPrivileges
      .filter((entry) => entry.security_definer)
      .every((entry) => entry.public_execute === false),
  ).toBe(true);
  if (!("sequences" in state)) throw new Error("sequence_evidence_missing");
  expect(state.sequences).toHaveLength(4);
  output = mkdtempSync(join(tmpdir(), "ii-tonya-0085-state-validation-"));
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
  const actual = normalizeMigrationSnapshot(
    read(join(output, "meta/0000_snapshot.json")),
    { constraints: state.constraints, indexes: state.indexes },
  );
  actual.id = expected.id;
  actual.prevId = expected.prevId;
  expect(actual).toEqual(expected);
  expect(Object.keys(actual.tables)).toHaveLength(280);
}, 180_000);
