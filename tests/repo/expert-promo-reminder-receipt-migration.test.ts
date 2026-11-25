import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { expect, it } from "vitest";

const folder = "packages/db/migrations";
const read = (path: string) =>
  JSON.parse(readFileSync(`${folder}/${path}`, "utf8"));
const hash = (path: string) =>
  createHash("sha256")
    .update(readFileSync(`${folder}/${path}`))
    .digest("hex");

it("binds the two nullable reminder receipt columns to migration 0092 and its PostgreSQL catalogue", () => {
  const entry = read("meta/_journal.json").entries[92];
  expect(entry).toMatchObject({
    idx: 92,
    tag: "0092_expert_promo_reminder_receipt",
    breakpoints: true,
  });
  const snapshot = read("meta/0092_snapshot.json");
  const manifest = read("state/0092_manifest.json");
  expect(snapshot.prevId).toBe(read("meta/0091_snapshot.json").id);
  const priorSnapshots = readdirSync(`${folder}/meta`).filter(
    (name) =>
      /^\d{4}_snapshot\.json$/u.test(name) && name < "0092_snapshot.json",
  );
  expect(
    priorSnapshots.some((name) => read(`meta/${name}`).id === snapshot.id),
  ).toBe(false);
  expect(manifest.migrations.slice(0, -1)).toEqual(
    read("state/0091_manifest.json").migrations,
  );
  expect(manifest.migrations[92]).toEqual({
    idx: 92,
    tag: entry.tag,
    sha256: hash(`${entry.tag}.sql`),
  });
  expect(manifest.snapshotSha256).toBe(hash("meta/0092_snapshot.json"));
  expect(manifest.sqlObjectsSha256).toBe(hash("state/0092_sql_objects.json"));
  expect(manifest.databaseVersion).toBe("170005");
  const table = snapshot.tables["public.expert_promo_funnel_state"];
  expect(table.columns.message6_confirmed_at).toMatchObject({
    type: "timestamp with time zone",
    notNull: false,
  });
  expect(table.columns.message6_message_id).toMatchObject({
    type: "text",
    notNull: false,
  });
  const receipt = read("state/0092_sql_objects.json").constraints.find(
    (check: { name: string }) => check.name === "expert_promo_message6_receipt",
  );
  expect(receipt).toMatchObject({
    table_name: "expert_promo_funnel_state",
    kind: "c",
    validated: true,
  });
  expect(table.checkConstraints.expert_promo_message6_receipt.value).toBe(
    receipt.expression,
  );
});
