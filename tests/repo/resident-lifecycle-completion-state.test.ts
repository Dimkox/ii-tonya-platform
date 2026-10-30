import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
const base = "packages/db/migrations",
  read = (p: string) => JSON.parse(readFileSync(p, "utf8")),
  sha = (p: string) =>
    createHash("sha256").update(readFileSync(p)).digest("hex");
it("reconstructs lifecycle75 from SQL with owned deferred delivery authority and preserved historical inputs", () => {
  const m = read(`${base}/state/0075_manifest.json`),
    s = read(`${base}/meta/0075_snapshot.json`),
    o = read(`${base}/state/0075_sql_objects.json`);
  expect(m.databaseVersion).toBe("170005");
  expect(m.generatePermitted).toBe(false);
  expect(m.migrations).toHaveLength(76);
  for (const input of m.migrations)
    expect(sha(`${base}/${input.tag}.sql`)).toBe(input.sha256);
  expect(sha(`${base}/meta/0075_snapshot.json`)).toBe(m.snapshotSha256);
  expect(sha(`${base}/state/0075_sql_objects.json`)).toBe(m.sqlObjectsSha256);
  expect(s.prevId).toBe(read(`${base}/meta/0074_snapshot.json`).id);
  expect(Object.keys(s.tables)).toHaveLength(232);
  expect(o.functions).toHaveLength(180);
  expect(o.triggers).toHaveLength(219);
  expect(
    o.constraints.find(
      (c: { name: string }) => c.name === "resident_work_last_attempt",
    ),
  ).toMatchObject({
    deferrable: true,
    initially_deferred: true,
    columns_from: ["id", "last_attempt_id", "attempt_count"],
    columns_to: ["notice_id", "id", "sequence"],
  });
  for (const name of [
    "resident_work_notice_delivery_guard",
    "resident_work_attempt_delivery_guard",
    "resident_waitlist_join_guard",
  ])
    expect(o.triggers.some((t: { name: string }) => t.name === name)).toBe(
      true,
    );
  const journal = read(`${base}/meta/_journal.json`).entries;
  expect(journal.filter((entry: { idx: number }) => entry.idx === 75)).toEqual([
    {
      idx: 75,
      version: "7",
      when: 1793152800006,
      tag: "0075_resident_lifecycle_completion",
      breakpoints: true,
    },
  ]);
  expect(journal[75].when).toBeGreaterThan(journal[74].when);
  expect(journal.at(-1)).toEqual({
    idx: 83,
    version: "7",
    when: 1793152800014,
    tag: "0083_early_bird_launch_publication",
    breakpoints: true,
  });
  expect(journal.at(-1).when).toBeGreaterThan(journal.at(-2).when);
});
it("pins actual default PostgreSQL fixture to the same supported Compose version", () => {
  const source = readFileSync("packages/db/src/testkit/postgres.ts", "utf8"),
    compose = readFileSync("compose.yaml", "utf8");
  expect(source).toContain('new PostgreSqlContainer("postgres:17.5-bookworm")');
  expect(source).not.toContain("postgres:16-alpine");
  expect(compose).toContain("postgres:17.5-bookworm");
});
it("registers exact lifecycle artifacts and denies changed bytes and adjacent routes", async () => {
  const {
    classifyApprovedTrackedScopeContent,
    EXPERT_RESIDENCY_ALLOWED_ROUTES,
  } = await import("./support/payment-scope-boundary.js");
  for (const path of [
    `${base}/0075_resident_lifecycle_completion.sql`,
    `${base}/meta/0075_snapshot.json`,
    `${base}/state/0075_manifest.json`,
    `${base}/state/0075_sql_objects.json`,
  ]) {
    const content = readFileSync(path, "utf8");
    expect(classifyApprovedTrackedScopeContent({ path, content })).toEqual([]);
    expect(
      classifyApprovedTrackedScopeContent({ path, content: content + "\n" }),
    ).not.toEqual([]);
  }
  expect(
    EXPERT_RESIDENCY_ALLOWED_ROUTES.has(
      "/v1/admin/expert-cards/lifecycle/:caseId/close",
    ),
  ).toBe(true);
  expect(
    EXPERT_RESIDENCY_ALLOWED_ROUTES.has(
      "/v1/admin/expert-cards/lifecycle/:caseId/delete",
    ),
  ).toBe(false);
});
it("binds current explanatory prompt assets without rewriting historical manifests", () => {
  const m = read("docs/prompts/residency-lifecycle-v4-manifest.json");
  expect(m.status).toBe("inactive");
  expect(m.ruleVersion).toBe("residency_offer_v3");
  for (const a of m.assets) expect(sha(a.path)).toBe(a.sha256);
});

it("admits only exact full PG75 catalogue bytes above the unchanged general bound", async () => {
  const { isApprovedLargeScopeArtifact, PAYMENT_SCOPE_MAX_FILE_BYTES } =
    await import("./support/payment-scope-boundary.js");
  const path = "packages/db/migrations/state/0075_sql_objects.json",
    content = readFileSync(path, "utf8"),
    size = Buffer.byteLength(content, "utf8");
  expect(PAYMENT_SCOPE_MAX_FILE_BYTES).toBe(1048576);
  expect(size).toBe(1064832);
  expect(isApprovedLargeScopeArtifact(path, size, () => content)).toBe(true);
  expect(
    isApprovedLargeScopeArtifact(path, size, () =>
      content.replace("functions", "functionz"),
    ),
  ).toBe(false);
  expect(
    isApprovedLargeScopeArtifact(path, size + 1, () => {
      throw Error("must not read wrong size");
    }),
  ).toBe(false);
  expect(
    isApprovedLargeScopeArtifact(path.replace("0075", "0076"), size, () => {
      throw Error("must not read adjacent path");
    }),
  ).toBe(false);
});
