import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import {
  classifyApprovedTrackedScopeContent,
  classifyPaymentScopeProbe,
} from "./support/payment-scope-boundary.js";
const folder = "packages/db/migrations";
it("binds additive verification metadata to replayed SQL, prior snapshot and all new authority guards", () => {
  const state = JSON.parse(
    readFileSync(`${folder}/state/0057_verification_sql_objects.json`, "utf8"),
  );
  const digest = (p: string) =>
    createHash("sha256").update(readFileSync(p)).digest("hex");
  expect(state.serverVersionNum).toBe(170005);
  expect(state.sourceMigrationSha256).toBe(
    digest(`${folder}/0057_resident_verification_form.sql`),
  );
  expect(state.parentSnapshotSha256).toBe(
    digest(`${folder}/meta/0056_snapshot.json`),
  );
  expect(state.normalizedSnapshotSha256).toBe(
    digest(`${folder}/meta/0057_snapshot.json`),
  );
  expect(state.functions.map((f: { name: string }) => f.name)).toEqual([
    "erase_resident_verification_subject",
    "resident_verification_consent_cleanup",
    "resident_verification_draft_valid",
    "resident_verification_price_allowed",
    "resident_verification_price_guard",
    "resident_verification_social_projection",
    "resident_verification_stage_projection",
    "resident_verification_write_guard",
  ]);
  expect(state.triggers).toHaveLength(5);
  expect(
    state.constraints.some(
      (c: { name: string }) => c.name === "channel_identity_resident_owner",
    ),
  ).toBe(true);
  expect(
    state.constraints.some(
      (c: { name: string }) =>
        c.name === "users_current_verification_stage_check",
    ),
  ).toBe(true);
});
it.each([
  "0057_resident_verification_form.sql",
  "meta/0057_snapshot.json",
  "state/0057_verification_sql_objects.json",
])("pins exact verified artifact bytes and rejects mutation: %s", (file) => {
  const path = `${folder}/${file}`,
    content = readFileSync(path, "utf8");
  expect(classifyApprovedTrackedScopeContent({ path, content })).toEqual([]);
  expect(
    classifyApprovedTrackedScopeContent({ path, content: content + "\n" }),
  ).not.toEqual([]);
});
it("rejects adjacent intake relation and flag probes while keeping the approved scope exact", () => {
  expect(
    classifyPaymentScopeProbe({
      path: "packages/db/src/schema/verification-shadow.ts",
      content:
        'export const shadow = pgTable("residents_applications_shadow", {});',
    }),
  ).not.toEqual([]);
  expect(
    classifyPaymentScopeProbe({
      path: "packages/config/src/verification-shadow.ts",
      content:
        "const flag = process.env.EXPERT_VERIFICATION_FORM_SHADOW_ENABLED;",
    }),
  ).not.toEqual([]);
  expect(
    classifyApprovedTrackedScopeContent({
      path: `${folder}/0057_resident_verification_form_shadow.sql`,
      content: "select 1;",
    }),
  ).not.toEqual([]);
});
