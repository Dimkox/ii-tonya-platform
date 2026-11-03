import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";

// A migration number is not a change identifier across branches (issue #87).
// Two branches can carry different SQL under the same NNNN index, and drizzle
// gates application only by `created_at < journal.when`, so a renumbered or
// late-`when` entry is silently skipped on any database that is already ahead.

const MIGRATIONS = "packages/db/migrations";
const JOURNAL = `${MIGRATIONS}/meta/_journal.json`;
const BASE_REF = process.env.MIGRATION_BASE_REF ?? "origin/main";

type MigrationFile = Readonly<{ idx: string; name: string; blob: string }>;
type JournalEntry = Readonly<{ idx: number; tag: string; when: number }>;

type Collision = Readonly<{
  idx: string;
  base: string;
  head: string;
  baseBlob: string;
  headBlob: string;
}>;

// Files the branch introduced or changed (head differs from merge-base) that
// reuse an index already present on the base ref with other content.
const findIndexCollisions = (
  base: readonly MigrationFile[],
  mergeBase: readonly MigrationFile[],
  head: readonly MigrationFile[],
): Collision[] => {
  const inMergeBase = new Set(
    mergeBase.map((file) => `${file.name}@${file.blob}`),
  );
  const byIdx = new Map<string, MigrationFile[]>();
  for (const file of base) {
    byIdx.set(file.idx, [...(byIdx.get(file.idx) ?? []), file]);
  }
  const collisions: Collision[] = [];
  for (const file of head) {
    if (inMergeBase.has(`${file.name}@${file.blob}`)) continue;
    for (const other of byIdx.get(file.idx) ?? []) {
      if (other.name === file.name && other.blob === file.blob) continue;
      collisions.push({
        idx: file.idx,
        base: other.name,
        head: file.name,
        baseBlob: other.blob,
        headBlob: file.blob,
      });
    }
  }
  return collisions;
};

// Every journal entry that is new relative to the base ref must be strictly
// later than the newest `when` already on the base ref.
const findStaleWhen = (
  base: readonly JournalEntry[],
  head: readonly JournalEntry[],
): JournalEntry[] => {
  const baseTags = new Set(base.map((entry) => entry.tag));
  const maxBaseWhen = Math.max(0, ...base.map((entry) => entry.when));
  return head.filter(
    (entry) => !baseTags.has(entry.tag) && entry.when <= maxBaseWhen,
  );
};

const git = (...args: string[]): string =>
  execFileSync("git", args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });

const refExists = (ref: string): boolean => {
  try {
    git("rev-parse", "--verify", "--quiet", `${ref}^{commit}`);
    return true;
  } catch {
    return false;
  }
};

const listMigrations = (ref: string): MigrationFile[] =>
  git("ls-tree", ref, `${MIGRATIONS}/`)
    .split("\n")
    .map((line) => /^\S+ blob (\S+)\t.*\/((\d{4})_[^/]+\.sql)$/u.exec(line))
    .filter((match): match is RegExpExecArray => match !== null)
    .map((match) => ({ idx: match[3]!, name: match[2]!, blob: match[1]! }));

const readJournal = (ref: string): JournalEntry[] =>
  (JSON.parse(git("show", `${ref}:${JOURNAL}`)) as { entries: JournalEntry[] })
    .entries;

describe("migration numbers across branches", () => {
  const file = (idx: string, name: string, blob: string): MigrationFile => ({
    idx,
    name: `${idx}_${name}.sql`,
    blob,
  });

  it("flags a reused index with different content", () => {
    const base = [file("0087", "a", "aaa")];
    const head = [file("0087", "b", "bbb")];
    expect(findIndexCollisions(base, [], head)).toEqual([
      {
        idx: "0087",
        base: "0087_a.sql",
        head: "0087_b.sql",
        baseBlob: "aaa",
        headBlob: "bbb",
      },
    ]);
  });

  it("flags an add/add on the same file name with different content", () => {
    const base = [file("0018", "x", "111")];
    const head = [file("0018", "x", "222")];
    expect(findIndexCollisions(base, [], head)).toHaveLength(1);
  });

  it("ignores files the branch inherited from the merge-base", () => {
    const old = file("0010", "x", "old");
    const base = [file("0010", "x", "rewritten-on-main")];
    expect(findIndexCollisions(base, [old], [old])).toEqual([]);
  });

  it("ignores identical files and fresh indices", () => {
    const same = file("0001", "a", "s");
    expect(
      findIndexCollisions([same], [], [same, file("0002", "b", "n")]),
    ).toEqual([]);
  });

  it("flags new journal entries whose when is not after the base maximum", () => {
    const base = [
      { idx: 0, tag: "0000_a", when: 10 },
      { idx: 1, tag: "0001_b", when: 20 },
    ];
    const head = [
      ...base,
      { idx: 2, tag: "0002_late", when: 20 },
      { idx: 3, tag: "0003_ok", when: 21 },
    ];
    expect(findStaleWhen(base, head)).toEqual([
      { idx: 2, tag: "0002_late", when: 20 },
    ]);
  });

  it.skipIf(!refExists(BASE_REF))(
    `HEAD reuses no ${BASE_REF} migration number and keeps journal.when after it`,
    () => {
      const mergeBase = git("merge-base", BASE_REF, "HEAD").trim();
      const collisions = findIndexCollisions(
        listMigrations(BASE_REF),
        listMigrations(mergeBase),
        listMigrations("HEAD"),
      );
      expect(
        collisions,
        "a migration number is not a change identifier: renumber the branch migration after the base ref",
      ).toEqual([]);
      expect(
        findStaleWhen(readJournal(BASE_REF), readJournal("HEAD")),
        "new journal entries must have when greater than every when on the base ref",
      ).toEqual([]);
    },
  );
});
