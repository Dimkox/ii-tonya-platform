import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import {
  classifyApprovedTrackedScopeContent,
  classifyPaymentScopeProbe,
} from "./support/payment-scope-boundary.js";
const base = "packages/db/migrations/";
const read = (path: string) => JSON.parse(readFileSync(base + path, "utf8"));
const digest = (path: string) =>
  createHash("sha256")
    .update(readFileSync(base + path))
    .digest("hex");
it("pins the SQL-replayed0062 state and every source migration hash", () => {
  const m = read("state/0062_manifest.json"),
    snapshot = read("meta/0062_snapshot.json"),
    objects = read("state/0062_sql_objects.json");
  expect(m.databaseVersion).toBe("170005");
  expect(m.generatePermitted).toBe(false);
  expect(m.migrations).toHaveLength(63);
  for (const migration of m.migrations)
    expect(digest(`${migration.tag}.sql`)).toBe(migration.sha256);
  expect(m.snapshotSha256).toBe(digest("meta/0062_snapshot.json"));
  expect(m.sqlObjectsSha256).toBe(digest("state/0062_sql_objects.json"));
  expect(snapshot.prevId).toBe(read("meta/0061_snapshot.json").id);
  expect(Object.keys(snapshot.tables)).toHaveLength(204);
  expect(objects.functions).toHaveLength(127);
  expect(objects.triggers).toHaveLength(180);
  expect(objects.extensions).toHaveLength(2);
});
it.each([
  "0062_resident_verification_messages.sql",
  "meta/0062_snapshot.json",
  "state/0062_sql_objects.json",
  "state/0062_manifest.json",
])("rejects changed reviewed0062 bytes: %s", (file) => {
  const path = base + file,
    content = readFileSync(path, "utf8");
  expect(classifyApprovedTrackedScopeContent({ path, content })).toEqual([]);
  expect(
    classifyApprovedTrackedScopeContent({ path, content: content + "\n" }),
  ).not.toEqual([]);
});
it.each(["review-preview", "review-confirm", "review-recovery"])(
  "allows only exact protected manager route %s",
  (suffix) => {
    const route = `/v1/admin/expert-verification/:applicationId/${suffix}`,
      path = "apps/api/src/routes/neutral.ts";
    expect(
      classifyPaymentScopeProbe({
        path,
        content: `app.post(${JSON.stringify(route)}, handler);`,
      }),
    ).toEqual([]);
    expect(
      classifyPaymentScopeProbe({
        path,
        content: `app.post(${JSON.stringify(route + "/unsafe")}, handler);`,
      }),
    ).not.toEqual([]);
  },
);
it("pins the loopback browser harness and denies an altered dynamic loader", () => {
  const path = "scripts/verify-resident-review-browser.mjs",
    content = readFileSync(path, "utf8");
  expect(classifyApprovedTrackedScopeContent({ path, content })).toEqual([]);
  expect(classifyPaymentScopeProbe({ path, content })).toEqual([]);
  expect(
    classifyPaymentScopeProbe({ path, content: content + "\n" }),
  ).toContain("unresolved runtime module import requires explicit review");
});
it("pins additive0063 state without rewriting0062", () => {
  const m = read("state/0063_manifest.json"),
    snapshot = read("meta/0063_snapshot.json"),
    objects = read("state/0063_sql_objects.json");
  expect(m.databaseVersion).toBe("170005");
  expect(m.generatePermitted).toBe(false);
  expect(m.migrations).toHaveLength(64);
  for (const migration of m.migrations)
    expect(digest(`${migration.tag}.sql`)).toBe(migration.sha256);
  expect(m.snapshotSha256).toBe(digest("meta/0063_snapshot.json"));
  expect(m.sqlObjectsSha256).toBe(digest("state/0063_sql_objects.json"));
  expect(snapshot.prevId).toBe(read("meta/0062_snapshot.json").id);
  expect(Object.keys(snapshot.tables)).toHaveLength(204);
  expect(objects.functions).toHaveLength(129);
  expect(objects.triggers).toHaveLength(180);
  expect(objects.indexes).toHaveLength(516);
});
it.each([
  "0063_resident_verification_review_corrections.sql",
  "meta/0063_snapshot.json",
  "state/0063_sql_objects.json",
  "state/0063_manifest.json",
])("rejects changed corrective0063 bytes: %s", (file) => {
  const path = base + file,
    content = readFileSync(path, "utf8");
  expect(classifyApprovedTrackedScopeContent({ path, content })).toEqual([]);
  expect(
    classifyApprovedTrackedScopeContent({ path, content: content + "\n" }),
  ).not.toEqual([]);
});
