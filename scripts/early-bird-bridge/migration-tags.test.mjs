import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { validateMigrationTag } from "./migration-tags.mjs";

test("all committed journal tags and historical hyphens are valid", () => {
  const journal = JSON.parse(
    readFileSync("packages/db/migrations/meta/_journal.json", "utf8"),
  );
  for (const [idx, entry] of journal.entries.entries()) {
    assert.equal(validateMigrationTag(entry, idx), true, entry.tag);
  }
  assert.equal(
    validateMigrationTag(
      { idx: 1, tag: "0001_message-package-metadata", when: 1 },
      1,
    ),
    true,
  );
});

test("reject mismatched prefixes, traversal and malformed entries", () => {
  for (const tag of [
    "0002_wrong",
    "0001_../escape",
    "0001_foo/bar",
    "0001_foo\\bar",
    "0001_foo.sql",
    "0001_",
    "00001_name",
    "0001_NAME",
  ]) {
    assert.equal(validateMigrationTag({ idx: 1, tag, when: 1 }, 1), false, tag);
  }
  assert.equal(
    validateMigrationTag({ idx: 2, tag: "0001_name", when: 1 }, 1),
    false,
  );
  assert.equal(
    validateMigrationTag({ idx: 1, tag: "0001_name", when: 1.5 }, 1),
    false,
  );
});
