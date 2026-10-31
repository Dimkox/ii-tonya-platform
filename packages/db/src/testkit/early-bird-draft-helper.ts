import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { sql, type SQL } from "drizzle-orm";

const canonicalHash =
  "4896c3e2482efc27db1578bbb8ede5098796c404faa75cb5d20ff268657a4353";
const canonicalPath =
  "packages/db/migrations/0081_early_bird_payment_runtime.sql";
const manifestPath =
  "docs/superpowers/implementation-artifacts/early-bird-0081-promotion-segments-2026-10-30.json";
const digest = (value: Buffer) =>
  createHash("sha256").update(value).digest("hex");

type Decision = {
  included: boolean;
  entireFile: boolean;
  sourceMatches: boolean;
  canonicalMatches: boolean;
  installed: "verified" | "absent" | "mismatch";
};
export function decideEarlyBirdDraft(
  state: Decision,
): "skip" | "apply" | "suffix" {
  if (state.installed === "mismatch")
    throw new Error("early_bird_test_migration_mismatch");
  if (state.installed === "absent" || !state.included) return "apply";
  if (!state.canonicalMatches || !state.sourceMatches)
    throw new Error("early_bird_test_draft_mismatch");
  return state.entireFile ? "skip" : "suffix";
}

type Executor = { execute: (query: SQL) => PromiseLike<{ rows: unknown[] }> };
/** Test-only: never apply an already installed draft or silently accept source drift. */
export async function applyEarlyBirdDraftIfNeeded(
  db: Executor,
  source: string,
): Promise<void> {
  const bytes = readFileSync(source);
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
    segments: Array<{
      source: string;
      order: number;
      source_sha256: string;
      selection: { kind: string; marker?: string };
    }>;
  };
  const segment = manifest.segments.find((item) => item.source === source);
  const journal = JSON.parse(
    readFileSync("packages/db/migrations/meta/_journal.json", "utf8"),
  ) as { entries: Array<{ tag: string; when: number }> };
  const entry = journal.entries.find(
    (item) => item.tag === "0081_early_bird_payment_runtime",
  );
  const exists = (
    await db.execute(
      sql`select to_regclass('drizzle.__drizzle_migrations') is not null as present`,
    )
  ).rows[0] as { present: boolean };
  let installed: Decision["installed"] = "absent";
  if (exists.present && entry) {
    const rows = (
      await db.execute(
        sql`select hash from drizzle.__drizzle_migrations where created_at=${entry.when}`,
      )
    ).rows as Array<{ hash: string }>;
    if (rows.length)
      installed =
        rows.length === 1 && rows[0]!.hash === canonicalHash
          ? "verified"
          : "mismatch";
  }
  let canonicalMatches = false;
  if (installed === "verified") {
    const canonical = readFileSync(canonicalPath);
    canonicalMatches = digest(canonical) === canonicalHash;
    if (segment) {
      const marker = segment.selection.marker;
      const cut = marker ? bytes.indexOf(Buffer.from(marker)) : -1;
      const selected =
        segment.selection.kind === "entire_file"
          ? bytes
          : cut >= 0 && bytes.indexOf(Buffer.from(marker!), cut + 1) < 0
            ? bytes.subarray(0, cut)
            : Buffer.alloc(0);
      canonicalMatches &&=
        selected.length > 0 &&
        canonical.includes(
          Buffer.concat([
            Buffer.from(`-- Candidate segment ${segment.order}: ${source}\n`),
            selected,
          ]),
        );
    }
  }
  const decision = decideEarlyBirdDraft({
    included: segment !== undefined,
    entireFile: segment?.selection.kind === "entire_file",
    sourceMatches: !!segment && digest(bytes) === segment.source_sha256,
    canonicalMatches,
    installed,
  });
  if (decision === "apply") await db.execute(sql.raw(bytes.toString("utf8")));
  if (decision === "suffix") {
    if (
      segment?.selection.kind !== "prefix_before_exact_marker" ||
      !segment.selection.marker
    )
      throw new Error("early_bird_test_draft_selection");
    const cut = bytes.indexOf(Buffer.from(segment.selection.marker));
    if (cut < 0) throw new Error("early_bird_test_draft_selection");
    await db.execute(sql.raw(bytes.subarray(cut).toString("utf8")));
  }
}

/** Full-chain fixtures skip only the exact publication segment installed by 0083. */
export async function applyEarlyBirdPublicationDraftIfNeeded(
  db: Executor,
): Promise<void> {
  const source =
    "docs/superpowers/implementation-artifacts/drafts/early_bird_publication_worker.sql";
  const canonical =
    "packages/db/migrations/0083_early_bird_launch_publication.sql";
  const expected =
    "69427ca04b5b16004764d8cc6c20c061e1fad85b89eed60352f56529048918f7";
  const sourceBytes = readFileSync(source);
  const journal = JSON.parse(
    readFileSync("packages/db/migrations/meta/_journal.json", "utf8"),
  ) as { entries: Array<{ tag: string; when: number }> };
  const entry = journal.entries.find(
    (item) => item.tag === "0083_early_bird_launch_publication",
  );
  const present = (
    await db.execute(
      sql`select to_regclass('drizzle.__drizzle_migrations') is not null as present`,
    )
  ).rows[0] as { present: boolean };
  if (present.present && entry) {
    const rows = (
      await db.execute(
        sql`select hash from drizzle.__drizzle_migrations where created_at=${entry.when}`,
      )
    ).rows as Array<{ hash: string }>;
    if (rows.length) {
      if (rows.length !== 1 || rows[0]!.hash !== expected)
        throw new Error("early_bird_test_migration_mismatch");
      const bytes = readFileSync(canonical);
      if (
        digest(bytes) !== expected ||
        !bytes.includes(
          Buffer.concat([
            Buffer.from(
              "-- Launch capability segment: early_bird_publication_worker.sql [complete]\n",
            ),
            sourceBytes,
          ]),
        )
      )
        throw new Error("early_bird_test_draft_mismatch");
      return;
    }
  }
  await db.execute(sql.raw(sourceBytes.toString("utf8")));
}
