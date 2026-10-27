import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
const base = "packages/db/migrations",
  read = (p: string) => JSON.parse(readFileSync(p, "utf8")),
  sha = (p: string) =>
    createHash("sha256").update(readFileSync(p)).digest("hex");
it("binds rich private versions, guided state and custody to the complete SQL chain", () => {
  const m = read(`${base}/state/0066_manifest.json`),
    s = read(`${base}/meta/0066_snapshot.json`),
    o = read(`${base}/state/0066_sql_objects.json`);
  expect(m.databaseVersion).toBe("170005");
  expect(m.generatePermitted).toBe(false);
  expect(m.migrations).toHaveLength(67);
  for (const migration of m.migrations)
    expect(sha(`${base}/${migration.tag}.sql`)).toBe(migration.sha256);
  expect(sha(`${base}/meta/0066_snapshot.json`)).toBe(m.snapshotSha256);
  expect(sha(`${base}/state/0066_sql_objects.json`)).toBe(m.sqlObjectsSha256);
  expect(s.prevId).toBe(read(`${base}/meta/0065_snapshot.json`).id);
  expect(Object.keys(s.tables)).toHaveLength(211);
  expect(o.functions).toHaveLength(142);
  expect(o.triggers).toHaveLength(189);
  expect(o.constraints).toHaveLength(1429);
  expect(o.indexes).toHaveLength(531);
  const d = s.tables["public.expert_card_drafts"];
  for (const c of [
    "rich_mode",
    "rich_profile",
    "rich_proposal",
    "rich_guided",
    "owner_confirmed_digest",
    "preview_content_digest",
    "assistance_requested_at",
  ])
    expect(d.columns[c]).toBeDefined();
  expect(s.tables["public.resident_card_versions"]).toBeDefined();
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

it("pins only exact reviewed rich artifacts and rejects mutations and adjacent migration names", async () => {
  const { classifyApprovedTrackedScopeContent, classifyPaymentScopeProbe } =
    await import("./support/payment-scope-boundary.js");
  for (const path of [
    `${base}/0066_resident_rich_onboarding.sql`,
    `${base}/meta/0066_snapshot.json`,
    `${base}/state/0066_sql_objects.json`,
    `${base}/state/0066_manifest.json`,
  ]) {
    const content = readFileSync(path, "utf8");
    expect(classifyApprovedTrackedScopeContent({ path, content })).toEqual([]);
    expect(
      classifyApprovedTrackedScopeContent({ path, content: content + "\n" }),
    ).not.toEqual([]);
    expect(
      classifyApprovedTrackedScopeContent({
        path: path.replace("0066", "0067"),
        content,
      }),
    ).not.toEqual([]);
  }
  expect(
    classifyPaymentScopeProbe({
      path: "packages/db/src/schema/resident-rich-copy.ts",
      content: 'const rogue=pgTable("resident_card_unreviewed", {});',
    }),
  ).not.toEqual([]);
});

it("binds correction0067 partial queue and validator to the preserved historical chain", () => {
  const m = read(`${base}/state/0067_manifest.json`),
    s = read(`${base}/meta/0067_snapshot.json`),
    o = read(`${base}/state/0067_sql_objects.json`);
  expect(m.databaseVersion).toBe("170005");
  expect(m.generatePermitted).toBe(false);
  expect(m.migrations).toHaveLength(68);
  for (const migration of m.migrations)
    expect(sha(`${base}/${migration.tag}.sql`)).toBe(migration.sha256);
  expect(sha(`${base}/meta/0067_snapshot.json`)).toBe(m.snapshotSha256);
  expect(sha(`${base}/state/0067_sql_objects.json`)).toBe(m.sqlObjectsSha256);
  expect(s.prevId).toBe(read(`${base}/meta/0066_snapshot.json`).id);
  expect(Object.keys(s.tables)).toHaveLength(211);
  expect(o.functions).toHaveLength(142);
  expect(o.triggers).toHaveLength(189);
  expect(o.constraints).toHaveLength(1430);
  expect(o.indexes).toHaveLength(531);
  const d = s.tables["public.expert_card_drafts"];
  for (const c of [
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

it("pins correction artifacts exactly while rejecting mutated bytes and adjacent paths", async () => {
  const { classifyApprovedTrackedScopeContent } =
    await import("./support/payment-scope-boundary.js");
  for (const path of [
    "packages/db/migrations/0067_resident_rich_review_corrections.sql",
    "packages/db/migrations/meta/0067_snapshot.json",
    "packages/db/migrations/state/0067_sql_objects.json",
    "packages/db/migrations/state/0067_manifest.json",
  ]) {
    const content = readFileSync(path, "utf8");
    expect(classifyApprovedTrackedScopeContent({ path, content })).toEqual([]);
    expect(
      classifyApprovedTrackedScopeContent({ path, content: content + "\n" }),
    ).not.toEqual([]);
    expect(
      classifyApprovedTrackedScopeContent({
        path: path.replace("0067", "0068"),
        content,
      }),
    ).not.toEqual([]);
  }
});

it("binds correction0068 latest immutable publication authority to the preserved historical chain", () => {
  const m = read(`${base}/state/0068_manifest.json`),
    s = read(`${base}/meta/0068_snapshot.json`),
    o = read(`${base}/state/0068_sql_objects.json`);
  expect(m.databaseVersion).toBe("170005");
  expect(m.generatePermitted).toBe(false);
  expect(m.migrations).toHaveLength(69);
  for (const migration of m.migrations)
    expect(sha(`${base}/${migration.tag}.sql`)).toBe(migration.sha256);
  expect(sha(`${base}/meta/0068_snapshot.json`)).toBe(m.snapshotSha256);
  expect(sha(`${base}/state/0068_sql_objects.json`)).toBe(m.sqlObjectsSha256);
  expect(s.prevId).toBe(read(`${base}/meta/0067_snapshot.json`).id);
  expect(Object.keys(s.tables)).toHaveLength(211);
  expect(o.functions).toHaveLength(142);
  expect(o.triggers).toHaveLength(189);
  expect(o.constraints).toHaveLength(1430);
  expect(o.indexes).toHaveLength(531);
  const d = s.tables["public.expert_card_drafts"];
  for (const c of [
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

it("pins second correction artifacts exactly while rejecting mutated bytes and adjacent paths", async () => {
  const { classifyApprovedTrackedScopeContent } =
    await import("./support/payment-scope-boundary.js");
  for (const path of [
    "packages/db/migrations/0068_resident_latest_approved_publication.sql",
    "packages/db/migrations/meta/0068_snapshot.json",
    "packages/db/migrations/state/0068_sql_objects.json",
    "packages/db/migrations/state/0068_manifest.json",
  ]) {
    const content = readFileSync(path, "utf8");
    expect(classifyApprovedTrackedScopeContent({ path, content })).toEqual([]);
    expect(
      classifyApprovedTrackedScopeContent({ path, content: content + "\n" }),
    ).not.toEqual([]);
    expect(
      classifyApprovedTrackedScopeContent({
        path: path.replace("0068", "0069"),
        content,
      }),
    ).not.toEqual([]);
  }
});
