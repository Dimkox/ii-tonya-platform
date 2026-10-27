import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { it, expect } from "vitest";
import {
  classifyApprovedTrackedScopeContent,
  classifyPaymentScopeProbe,
} from "./support/payment-scope-boundary.js";
const folder = "packages/db/migrations";
const digest = (path: string) =>
  createHash("sha256").update(readFileSync(path)).digest("hex");
it("pins the actual additive PostgreSQL17.5 state and SQL-only objects", () => {
  const state = JSON.parse(
    readFileSync(`${folder}/state/0058_stabilization_sql_objects.json`, "utf8"),
  );
  expect(state.serverVersionNum).toBe(170005);
  expect(state.sourceMigrationSha256).toBe(
    digest(`${folder}/0058_residency_core_stabilization.sql`),
  );
  expect(state.parentSnapshotSha256).toBe(
    digest(`${folder}/meta/0057_snapshot.json`),
  );
  expect(state.normalizedSnapshotSha256).toBe(
    digest(`${folder}/meta/0058_snapshot.json`),
  );
  expect(state.functions.map((x: { name: string }) => x.name)).toEqual([
    "expert_card_tag_selection_guard",
    "hashtags_synonyms_valid",
  ]);
  expect(state.triggers).toHaveLength(1);
  expect(state.views.map((x: { name: string }) => x.name)).toEqual([
    "hashtags_taxonomy",
    "resident_workspace_access",
  ]);
  expect(state.constraints).toHaveLength(13);
  expect(state.indexes).toHaveLength(4);
});
it.each([
  "0058_residency_core_stabilization.sql",
  "meta/0058_snapshot.json",
  "state/0058_stabilization_sql_objects.json",
])("pins exact artifact and rejects mutation %s", (file) => {
  const path = `${folder}/${file}`,
    content = readFileSync(path, "utf8");
  expect(classifyApprovedTrackedScopeContent({ path, content })).toEqual([]);
  expect(
    classifyApprovedTrackedScopeContent({ path, content: content + "\n" }),
  ).not.toEqual([]);
});
it("preserves every owner label/category/synonym and excludes the isolated mocks from SQL", () => {
  const source = readFileSync(
    "docs/source/residency-phase1-owner-2026-10-26/hashtaxonomy-v2.txt",
    "utf8",
  );
  const catalogue = JSON.parse(
    readFileSync("packages/db/src/residency-hashtags.json", "utf8"),
  ) as {
    id: string;
    parentCategory: string;
    subCategory: string;
    tagValue: string;
    displayLabel: string;
    synonyms: { term: string }[];
    weightScore: number;
    isActive: boolean;
  }[];
  let parentCategory = "",
    subCategory = "";
  const expected = [];
  for (const line of source.split("\n")) {
    if (line.startsWith("### CAT_")) parentCategory = line.slice(4);
    if (line.startsWith("#### Sub-cat: ")) subCategory = line.slice(14);
    const match = /^\*\s+\*\*(#[^*]+)\*\* \(Syn: (.*?)\)/u.exec(line);
    if (match)
      expected.push({
        parentCategory,
        subCategory,
        tagValue: match[1]!.slice(1),
        displayLabel: match[1],
        synonyms: match[2]!.split(",").map((term) => ({ term: term.trim() })),
        weightScore: 5,
        isActive: true,
      });
  }
  expect(catalogue).toHaveLength(164);
  expect(new Set(catalogue.map((r) => r.parentCategory)).size).toBe(7);
  expect(new Set(catalogue.map((r) => r.id)).size).toBe(164);
  expect(
    catalogue.map(({ id, ...row }) => {
      expect(id).toMatch(/^[0-9a-f-]{36}$/u);
      return row;
    }),
  ).toEqual(expected);
  const sql = readFileSync(
    `${folder}/0058_residency_core_stabilization.sql`,
    "utf8",
  );
  for (const row of catalogue) {
    expect(sql).toContain(`'${row.id}'::uuid`);
    expect(sql).toContain(row.displayLabel);
  }
  expect(sql).not.toContain("PSYCHOLOGY");
  expect(sql).not.toContain("00000000-0000-4000-8000-000000000001");
});
it("rejects adjacent taxonomy and workspace flag authority", () => {
  expect(
    classifyPaymentScopeProbe({
      path: "packages/db/migrations/0058_shadow.sql",
      content: "CREATE TABLE hashtags_db_shadow(id uuid);",
    }),
  ).not.toEqual([]);
  expect(
    classifyPaymentScopeProbe({
      path: "packages/db/src/schema/shadow.ts",
      content:
        'export const shadow=pgTable("expert_card_draft_tags_shadow",{});',
    }),
  ).not.toEqual([]);
  expect(
    classifyPaymentScopeProbe({
      path: "packages/config/src/shadow.ts",
      content:
        "export const enabled=process.env.RESIDENT_WORKSPACE_SHADOW_ENABLED;",
    }),
  ).not.toEqual([]);
});
it.each(["helper.py", "test_helper.py"])(
  "pins parser executable and rejects mutation %s",
  (file) => {
    const path = `packages/integrations/parser/${file}`,
      content = readFileSync(path, "utf8");
    expect(classifyApprovedTrackedScopeContent({ path, content })).toEqual([]);
    expect(
      classifyApprovedTrackedScopeContent({ path, content: content + "\n" }),
    ).not.toEqual([]);
  },
);
it("ships helper and locked dependency graph while Node-only production remains parser-free", () => {
  const manifest = JSON.parse(
    readFileSync("packages/integrations/package.json", "utf8"),
  );
  expect(manifest.files).toEqual([
    "dist",
    "parser/helper.py",
    "parser/pyproject.toml",
    "parser/uv.lock",
  ]);
  const lock = readFileSync("packages/integrations/parser/uv.lock", "utf8");
  expect(lock).toContain('name = "pymupdf"');
  expect(lock).toContain('version = "1.26.7"');
  expect(lock).toContain('name = "python-docx"');
  expect(lock).toContain('version = "1.2.0"');
  expect(lock).toContain('hash = "sha256:');
  const adapter = readFileSync(
    "packages/integrations/src/documents/safe-document-parser.ts",
    "utf8",
  );
  expect(adapter).toContain("!options.enabled");
  expect(adapter).toContain("!options.pythonExecutable");
});
