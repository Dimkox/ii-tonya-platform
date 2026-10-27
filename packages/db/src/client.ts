import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { readMigrationFiles } from "drizzle-orm/migrator";
import { sql } from "drizzle-orm";
import { fileURLToPath } from "node:url";
import { Pool, type PoolConfig } from "pg";
import * as schema from "./schema/index.js";

export type DrizzleDb = ReturnType<typeof drizzle<typeof schema>>;
export const defaultMigrationsFolder = fileURLToPath(
  new URL("../migrations", import.meta.url),
);

export type DbConnectionSettings = Pick<
  PoolConfig,
  "options" | "connectionTimeoutMillis"
>;

export function createDb(
  connectionString: string,
  settings: DbConnectionSettings = {},
): DrizzleDb {
  return drizzle(new Pool({ ...settings, connectionString }), { schema });
}

export async function migrateDb(
  db: DrizzleDb,
  migrationsFolder: string,
): Promise<void> {
  const expected = readMigrationFiles({ migrationsFolder });
  const presence = await db.execute<{
    journal: boolean;
    existing: boolean;
  }>(sql`
    select to_regclass('drizzle.__drizzle_migrations') is not null as journal,
      to_regclass('public.users') is not null as existing
  `);
  if (!presence.rows[0]?.journal) {
    if (presence.rows[0]?.existing)
      throw new Error("migration_history_reconciliation_required");
  } else {
    const applied = await db.execute<{ hash: string; created_at: string }>(sql`
      select hash, created_at::text from drizzle.__drizzle_migrations order by id
    `);
    // Both branches used indexes 0039–0041 for different SQL. Timestamp-only
    // Drizzle replay would skip required migrations on the old main lineage.
    // Require an exact prefix of the deployed RC history before touching SQL;
    // an operator must reconcile any other history separately.
    if (
      (presence.rows[0]?.existing && applied.rows.length === 0) ||
      applied.rows.some((row, index) => {
        const migration = expected[index];
        return (
          !migration ||
          row.hash !== migration.hash ||
          row.created_at !== String(migration.folderMillis)
        );
      })
    )
      throw new Error("migration_history_reconciliation_required");
  }
  await migrate(db, { migrationsFolder });
}

export async function checkDbReadiness(
  db: DrizzleDb,
): Promise<{ postgres: boolean; migrations: boolean; workerLease: boolean }> {
  try {
    await db.execute(sql`select 1`);
    const migration = await db.execute<{ present: boolean }>(
      sql`select to_regclass('drizzle.__drizzle_migrations') is not null as present`,
    );
    const leases = await db.execute<{ fresh: boolean }>(sql`
      select not exists (
        select 1 from integration_outbox
        where (status = 'processing' and lease_until < now())
           or (status = 'reconciling' and reconciliation_lease_until < now())
      ) as fresh
    `);
    return {
      postgres: true,
      migrations: migration.rows[0]?.present === true,
      workerLease: leases.rows[0]?.fresh === true,
    };
  } catch {
    return { postgres: false, migrations: false, workerLease: false };
  }
}

export async function closeDb(db: DrizzleDb): Promise<void> {
  await db.$client.end();
}
