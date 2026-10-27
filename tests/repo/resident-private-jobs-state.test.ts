import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
const base = "packages/db/migrations";
const read = (path: string) => readFileSync(path, "utf8");
const digest = (path: string) =>
  createHash("sha256").update(readFileSync(path)).digest("hex");
it("binds private jobs state to the complete hand-authored SQL chain and erasure authority", () => {
  const manifest = JSON.parse(read(`${base}/state/0064_manifest.json`)),
    snapshot = JSON.parse(read(`${base}/meta/0064_snapshot.json`)),
    objects = JSON.parse(read(`${base}/state/0064_sql_objects.json`));
  expect(manifest.databaseVersion).toBe("170005");
  expect(manifest.generatePermitted).toBe(false);
  expect(manifest.migrations).toHaveLength(65);
  for (const migration of manifest.migrations)
    expect(digest(`${base}/${migration.tag}.sql`)).toBe(migration.sha256);
  expect(digest(`${base}/meta/0064_snapshot.json`)).toBe(
    manifest.snapshotSha256,
  );
  expect(digest(`${base}/state/0064_sql_objects.json`)).toBe(
    manifest.sqlObjectsSha256,
  );
  expect(Object.keys(snapshot.tables)).toHaveLength(209);
  expect(objects.functions).toHaveLength(132);
  expect(objects.triggers).toHaveLength(183);
  expect(objects.constraints).toHaveLength(1412);
  expect(objects.indexes).toHaveLength(527);
  const table = snapshot.tables["public.resident_object_deletions"];
  expect(table.columns.subject_erasure_key).toBeDefined();
  expect(table.columns.deletion_job_id).toBeDefined();
  expect(table.checkConstraints.resident_private_erasure_link).toBeDefined();
  expect(
    objects.triggers.some(
      (t: { name: string }) =>
        t.name === "resident_private_erasure_completion_guard",
    ),
  ).toBe(true);
  expect(
    snapshot.tables["public.resident_evidence_jobs"].columns.document_cursor,
  ).toBeDefined();
  expect(
    snapshot.tables["public.resident_evidence_jobs"].columns
      .documents_materialized,
  ).toBeDefined();
});
