import { closeDb, createDb, migrateDb } from "@ii-tonya/db";
import { fileURLToPath } from "node:url";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required");

const db = createDb(databaseUrl);
try {
  await migrateDb(db, fileURLToPath(new URL("../migrations", import.meta.url)));
} finally {
  await closeDb(db);
}
