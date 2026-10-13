import { closeDb, createDb, migrateDb } from "@ii-tonya/db";
import { fileURLToPath } from "node:url";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required");

// pg parses URL query parameters over Pool configuration. Reject all competing
// settings before constructing the pool, including encoded/repeated keys. Never
// include the URL or a driver diagnostic in an error visible to the service log.
if (process.env.PGOPTIONS)
  throw new Error("PGOPTIONS is forbidden for native migrations");
try {
  const url = new URL(databaseUrl);
  if (!["postgres:", "postgresql:"].includes(url.protocol)) throw new Error();
  const seen = new Set();
  for (const [key] of url.searchParams) {
    const normalized = key.toLowerCase();
    if (
      key.includes("%") ||
      seen.has(normalized) ||
      normalized === "options" ||
      normalized.includes("timeout")
    )
      throw new Error();
    seen.add(normalized);
  }
} catch {
  throw new Error(
    "Invalid or conflicting native migration database configuration",
  );
}

if (!process.argv?.includes("--validate-config")) {
  const db = createDb(databaseUrl, {
    options: "-c lock_timeout=10000 -c statement_timeout=120000",
    connectionTimeoutMillis: 10_000,
  });
  try {
    try {
      await migrateDb(
        db,
        fileURLToPath(new URL("../migrations", import.meta.url)),
      );
    } finally {
      await closeDb(db);
    }
  } catch {
    throw new Error(
      "Native migration failed; database state requires verification",
    );
  }
}
