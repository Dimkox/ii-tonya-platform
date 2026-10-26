import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import {
  classifyApprovedTrackedScopeContent,
  classifyPaymentScopeProbe,
} from "./support/payment-scope-boundary.js";
const digest = (p: string) =>
  createHash("sha256").update(readFileSync(p)).digest("hex");
const root = "packages/db/migrations";
it("pins the complete replayed PostgreSQL17.5 state and v3 application projection", () => {
  const manifest = JSON.parse(
    readFileSync(`${root}/state/0059_manifest.json`, "utf8"),
  );
  expect(manifest.databaseVersion).toBe("170005");
  expect(manifest.generatePermitted).toBe(false);
  expect(manifest.migrations.at(-1)).toMatchObject({
    idx: 59,
    sha256: digest(`${root}/0059_residency_separated_sales.sql`),
  });
  expect(manifest.snapshotSha256).toBe(
    digest(`${root}/meta/0059_snapshot.json`),
  );
  expect(manifest.sqlObjectsSha256).toBe(
    digest(`${root}/state/0059_sql_objects.json`),
  );
  const snapshot = JSON.parse(
    readFileSync(`${root}/meta/0059_snapshot.json`, "utf8"),
  );
  expect(snapshot.prevId).toBe(
    JSON.parse(readFileSync(`${root}/meta/0058_snapshot.json`, "utf8")).id,
  );
  const projection = snapshot.views["public.resident_sales_application"];
  for (const name of [
    "base_tariff_amount",
    "base_offer_shown_at",
    "promo_accepted_flag",
    "final_locked_price",
    "offer_expiry_date",
  ])
    expect(projection.columns).toHaveProperty(name);
  const state = JSON.parse(
    readFileSync(`${root}/state/0059_sql_objects.json`, "utf8"),
  );
  expect(
    state.triggers.some(
      (t: { name: string }) => t.name === "expert_sales_paid_lock_source",
    ),
  ).toBe(true);
});
it.each([
  "0059_residency_separated_sales.sql",
  "meta/0059_snapshot.json",
  "state/0059_sql_objects.json",
  "state/0059_manifest.json",
])("registers only the exact immutable artifact %s", (file) => {
  const path = `${root}/${file}`,
    content = readFileSync(path, "utf8");
  expect(classifyApprovedTrackedScopeContent({ path, content })).toEqual([]);
  expect(
    classifyApprovedTrackedScopeContent({ path, content: content + "\n" }),
  ).not.toEqual([]);
});
it("permits only the reviewed held client and rejects adjacent paths, endpoints and credentials", () => {
  const path = "packages/integrations/src/yookassa/held-onboarding.ts",
    content = readFileSync(path, "utf8");
  expect(classifyPaymentScopeProbe({ path, content })).toEqual([]);
  expect(
    classifyPaymentScopeProbe({
      path: path.replace("held-onboarding", "held-onboarding-extra"),
      content,
    }),
  ).not.toEqual([]);
  expect(
    classifyPaymentScopeProbe({
      path,
      content: content.replace(
        "https://api.yookassa.ru",
        "https://evil.invalid",
      ),
    }),
  ).not.toEqual([]);
  expect(
    classifyPaymentScopeProbe({
      path,
      content: content + "\nconst secret=process.env.YOOKASSA_SECRET_KEY;",
    }),
  ).not.toEqual([]);
  expect(
    classifyPaymentScopeProbe({
      path: "packages/db/src/schema/adjacent-sales.ts",
      content:
        'import {pgTable,uuid} from "drizzle-orm/pg-core";export const adjacent=pgTable("expert_sales_paid_locks_extra",{id:uuid("id")});',
    }),
  ).not.toEqual([]);
});
it("keeps v3 prompt activation disabled and its source digest exact", () => {
  const manifest = JSON.parse(
    readFileSync(
      "docs/prompts/residency-separated-sales-v3-manifest.json",
      "utf8",
    ),
  );
  expect(manifest.status).toBe("inactive");
  for (const asset of manifest.assets)
    expect(asset.sha256).toBe(digest(asset.path));
});
