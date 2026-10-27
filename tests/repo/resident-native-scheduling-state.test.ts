import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
const base = "packages/db/migrations",
  read = (p: string) => JSON.parse(readFileSync(p, "utf8")),
  sha = (p: string) =>
    createHash("sha256").update(readFileSync(p)).digest("hex");
it("binds native0070 scheduling and confirmation authority to the preserved historical chain", () => {
  const m = read(`${base}/state/0070_manifest.json`),
    s = read(`${base}/meta/0070_snapshot.json`),
    o = read(`${base}/state/0070_sql_objects.json`);
  expect(m.databaseVersion).toBe("170005");
  expect(m.generatePermitted).toBe(false);
  expect(m.migrations).toHaveLength(71);
  for (const migration of m.migrations)
    expect(sha(`${base}/${migration.tag}.sql`)).toBe(migration.sha256);
  expect(sha(`${base}/meta/0070_snapshot.json`)).toBe(m.snapshotSha256);
  expect(sha(`${base}/state/0070_sql_objects.json`)).toBe(m.sqlObjectsSha256);
  expect(s.prevId).toBe(read(`${base}/meta/0069_snapshot.json`).id);
  expect(Object.keys(s.tables)).toHaveLength(222);
  expect(o.functions).toHaveLength(175);
  expect(o.triggers).toHaveLength(210);
  expect(o.constraints).toHaveLength(1509);
  expect(o.indexes).toHaveLength(549);
  const d = s.tables["public.expert_card_drafts"];
  for (const c of [
    "initial_schedule",
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
    "resident_native_confirmation_source",
    "resident_schedule_version_source",
    "resident_service_mapping_source",
    "resident_native_logistics_guard",
    "resident_card_version_source",
    "resident_rich_draft_source",
    "resident_rich_write_safety",
    "resident_card_media_erase",
  ])
    expect(o.triggers.some((t: { name: string }) => t.name === name)).toBe(
      true,
    );
});

it("pins native scheduling artifacts exactly while rejecting mutated bytes and adjacent paths", async () => {
  const { classifyApprovedTrackedScopeContent } =
    await import("./support/payment-scope-boundary.js");
  for (const path of [
    "packages/db/migrations/0070_resident_native_scheduling.sql",
    "packages/db/migrations/meta/0070_snapshot.json",
    "packages/db/migrations/state/0070_sql_objects.json",
    "packages/db/migrations/state/0070_manifest.json",
  ]) {
    const content = readFileSync(path, "utf8");
    expect(classifyApprovedTrackedScopeContent({ path, content })).toEqual([]);
    expect(
      classifyApprovedTrackedScopeContent({ path, content: content + "\n" }),
    ).not.toEqual([]);
    expect(
      classifyApprovedTrackedScopeContent({
        path: path.replace("0070", "0071"),
        content,
      }),
    ).not.toEqual([]);
  }
});
