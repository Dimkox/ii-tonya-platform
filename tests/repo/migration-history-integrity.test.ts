import { existsSync, readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";

const MIGRATIONS = "packages/db/migrations";
const META = `${MIGRATIONS}/meta`;

type JournalEntry = {
  idx: number;
  version: string;
  tag: string;
  breakpoints: boolean;
};

const snapshotPath = (idx: number): string =>
  `${META}/${String(idx).padStart(4, "0")}_snapshot.json`;

// Migration history is hand-authored: these entries have SQL but no Drizzle
// snapshot, so `drizzle-kit generate` diffs against the newest stored snapshot
// (0021) and re-emits every object added after it. The list is a frozen
// baseline - a NEW gap fails the guard, closing one only requires shrinking it.
const MISSING_SNAPSHOT_BASELINE = [
  14, 19, 20, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37,
  38,
];

// drizzle-kit 0.31.x aborts JSON.stringify on a BigInt schema default, so
// `generate` is unusable while these exist. Pinned to make a new one loud.
const BIGINT_LITERAL_DEFAULTS_BASELINE = [
  "packages/db/src/schema/integration.ts:next_delivery_sequence",
];

describe("migration history integrity", () => {
  const journal = JSON.parse(readFileSync(`${META}/_journal.json`, "utf8")) as {
    entries: JournalEntry[];
  };
  const sqlNames = readdirSync(MIGRATIONS)
    .filter((name) => name.endsWith(".sql"))
    .map((name) => name.slice(0, -4))
    .sort();

  it("keeps journal entries contiguous and ordered", () => {
    expect(journal.entries.map((entry) => entry.idx)).toEqual(
      journal.entries.map((_entry, position) => position),
    );
    expect(
      journal.entries.filter(
        (entry) => entry.version !== journal.entries[0]?.version,
      ).length,
    ).toBe(0);
  });

  it("keeps every journal entry and migration file paired", () => {
    const tags = journal.entries.map((entry) => entry.tag).sort();
    expect(tags).toEqual(sqlNames);
    expect(
      journal.entries.filter(
        (entry) =>
          !entry.tag.startsWith(`${String(entry.idx).padStart(4, "0")}_`),
      ),
    ).toEqual([]);
  });

  it("keeps snapshot gaps inside the frozen hand-authored baseline", () => {
    const missing = journal.entries
      .filter((entry) => !existsSync(snapshotPath(entry.idx)))
      .map((entry) => entry.idx);
    // A new migration without a snapshot must never slip in silently.
    expect(
      missing.filter((idx) => !MISSING_SNAPSHOT_BASELINE.includes(idx)),
    ).toEqual([]);
    // Closing a gap is welcome - then shrink the baseline in the same change.
    expect(
      MISSING_SNAPSHOT_BASELINE.filter((idx) => !missing.includes(idx)),
    ).toEqual([]);
  });

  it("pins the newest snapshot as the drizzle-kit generate diff base", () => {
    const newest = Math.max(
      ...journal.entries
        .filter((entry) => existsSync(snapshotPath(entry.idx)))
        .map((entry) => entry.idx),
    );
    expect(newest).toBe(21);
    expect(newest).toBeLessThan(
      Math.max(...journal.entries.map((entry) => entry.idx)),
    );
  });

  it("pins bigint defaults that break drizzle-kit generate", () => {
    const found: string[] = [];
    for (const name of readdirSync("packages/db/src/schema")) {
      if (!name.endsWith(".ts")) {
        continue;
      }
      const path = `packages/db/src/schema/${name}`;
      const source = readFileSync(path, "utf8");
      for (const match of source.matchAll(
        /bigint\(\s*"([^"]+)"[\s\S]{0,160}?\.default\(\s*(?:0|[1-9][0-9]*)n\s*\)/g,
      )) {
        found.push(`${path}:${match[1]}`);
      }
    }
    expect(found.sort()).toEqual(BIGINT_LITERAL_DEFAULTS_BASELINE);
  });

  it("keeps the hand-authored migration policy documented", () => {
    const contract = readFileSync("AGENTS.md", "utf8");
    expect(contract).toContain("## Migration history is hand-authored");
    expect(contract).toContain("drizzle-kit generate");
    expect(contract).toContain("0021");
    expect(contract).toContain("Everything's fine");
  });
});
