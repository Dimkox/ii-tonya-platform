import { readFileSync } from "node:fs";
import { sql } from "drizzle-orm";
import type { DrizzleDb } from "../client.js";
/** Replay the hand-authored SQL through a fixed journal index on an empty disposable database. */
export async function replayMigrationsThrough(
  db: DrizzleDb,
  lastIndex: number,
): Promise<void> {
  if (!Number.isSafeInteger(lastIndex) || lastIndex < 0)
    throw new Error("invalid_migration_index");
  const folder = "packages/db/migrations";
  const journal = JSON.parse(
    readFileSync(`${folder}/meta/_journal.json`, "utf8"),
  ) as { entries: { idx: number; tag: string }[] };
  const entries = journal.entries.filter((entry) => entry.idx <= lastIndex);
  if (
    entries.length !== lastIndex + 1 ||
    entries.some(
      (entry, i) =>
        entry.idx !== i || !/^[0-9]{4}_[a-z0-9_-]+$/u.test(entry.tag),
    )
  )
    throw new Error("invalid_migration_journal");
  for (const entry of entries)
    await db.execute(
      sql.raw(readFileSync(`${folder}/${entry.tag}.sql`, "utf8")),
    );
}
