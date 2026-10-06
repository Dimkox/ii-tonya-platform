import { existsSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";

const folder = "packages/db/migrations";
const read = (path: string) =>
  existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : null;

describe("database-derived migration state baseline", () => {
  it("records the actual tables, constraints and SQL-only objects at migration 0039", () => {
    const snapshot = read(`${folder}/meta/0039_snapshot.json`);
    expect(snapshot, "missing actual database state baseline").not.toBeNull();
    expect(Object.keys(snapshot.tables)).toHaveLength(99);
    expect(Object.keys(snapshot.views).sort()).toEqual([
      "public.expert_referral_balances",
      "public.package_balances",
    ]);
    expect(
      snapshot.tables["public.client_sessions"].checkConstraints
        .client_sessions_scope_check.value,
    ).toContain("client_booking:write");
    const supplement = read(`${folder}/state/0039_sql_objects.json`);
    expect(
      supplement,
      "SQL-only authority must accompany the snapshot",
    ).not.toBeNull();
    expect(supplement.functions).toHaveLength(27);
    expect(supplement.triggers).toHaveLength(48);
    expect(supplement.exclusionConstraints).toEqual([
      expect.objectContaining({
        name: "expert_tariff_active_interval_exclusion",
      }),
    ]);
    expect(
      supplement.extensions.map((v: { name: string }) => v.name).sort(),
    ).toEqual(["btree_gist", "pgcrypto"]);
  });

  it("binds state evidence to every SQL input and the exact snapshot bytes", () => {
    const manifest = read(`${folder}/state/0039_manifest.json`);
    expect(manifest, "missing migration-state provenance").not.toBeNull();
    const journal = read(`${folder}/meta/_journal.json`);
    expect(manifest.migrations).toHaveLength(40);
    const digest = (path: string) =>
      createHash("sha256").update(readFileSync(path)).digest("hex");
    for (const entry of journal.entries.filter(
      (entry: { idx: number }) => entry.idx <= 39,
    )) {
      expect(manifest.migrations[entry.idx]).toEqual({
        idx: entry.idx,
        tag: entry.tag,
        sha256: digest(`${folder}/${entry.tag}.sql`),
      });
    }
    expect(manifest.snapshotSha256).toBe(
      digest(`${folder}/meta/0039_snapshot.json`),
    );
    expect(manifest.sqlObjectsSha256).toBe(
      digest(`${folder}/state/0039_sql_objects.json`),
    );
    expect(manifest.databaseVersion).toBe("170005");
    expect(manifest.generatePermitted).toBe(false);
  });
});
