import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
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
