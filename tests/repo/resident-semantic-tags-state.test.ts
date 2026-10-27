import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
const base = "packages/db/migrations",
  read = (p: string) => JSON.parse(readFileSync(p, "utf8")),
  sha = (p: string) =>
    createHash("sha256").update(readFileSync(p)).digest("hex");
it("binds semantic0069 cache and selection authority to the preserved historical chain", () => {
  const m = read(`${base}/state/0069_manifest.json`),
    s = read(`${base}/meta/0069_snapshot.json`),
    o = read(`${base}/state/0069_sql_objects.json`);
  expect(m.databaseVersion).toBe("170005");
  expect(m.generatePermitted).toBe(false);
  expect(m.migrations).toHaveLength(70);
  for (const migration of m.migrations)
    expect(sha(`${base}/${migration.tag}.sql`)).toBe(migration.sha256);
  expect(sha(`${base}/meta/0069_snapshot.json`)).toBe(m.snapshotSha256);
  expect(sha(`${base}/state/0069_sql_objects.json`)).toBe(m.sqlObjectsSha256);
  expect(s.prevId).toBe(read(`${base}/meta/0068_snapshot.json`).id);
  expect(Object.keys(s.tables)).toHaveLength(213);
  expect(o.functions).toHaveLength(151);
  expect(o.triggers).toHaveLength(193);
  expect(o.constraints).toHaveLength(1448);
  expect(o.indexes).toHaveLength(533);
  const d = s.tables["public.expert_card_drafts"];
  for (const c of [
    "semantic_tags",
    "tag_preview",
    "rich_mode",
    "rich_profile",
    "rich_proposal",
    "rich_guided",
    "rich_pending_services",
    "owner_confirmed_digest",
    "preview_content_digest",
    "assistance_requested_at",
  ])
    expect(d.columns[c]).toBeDefined();
  expect(s.tables["public.resident_card_versions"]).toBeDefined();
  expect(s.tables["public.tag_embeddings_cache"]).toBeDefined();
  expect(s.tables["public.resident_tag_decisions"]).toBeDefined();
  expect(
    s.tables["public.resident_card_media"].foreignKeys
      .resident_card_media_id_fkey.tableTo,
  ).toBe("resident_object_deletions");
  for (const name of [
    "resident_card_version_source",
    "resident_rich_draft_source",
    "resident_rich_write_safety",
    "resident_card_media_erase",
  ])
    expect(o.triggers.some((t: { name: string }) => t.name === name)).toBe(
      true,
    );
});

it("pins semantic artifacts exactly while rejecting mutated bytes and adjacent paths", async () => {
  const { classifyApprovedTrackedScopeContent } =
    await import("./support/payment-scope-boundary.js");
  for (const path of [
    "packages/db/migrations/0069_resident_semantic_tags.sql",
    "packages/db/migrations/meta/0069_snapshot.json",
    "packages/db/migrations/state/0069_sql_objects.json",
    "packages/db/migrations/state/0069_manifest.json",
  ]) {
    const content = readFileSync(path, "utf8");
    expect(classifyApprovedTrackedScopeContent({ path, content })).toEqual([]);
    expect(
      classifyApprovedTrackedScopeContent({ path, content: content + "\n" }),
    ).not.toEqual([]);
    expect(
      classifyApprovedTrackedScopeContent({
        path: path.replace("0069", "0070"),
        content,
      }),
    ).not.toEqual([]);
  }
});
