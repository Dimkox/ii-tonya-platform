import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema/index.js";

export type DrizzleDb = ReturnType<typeof drizzle<typeof schema>>;

export function createDb(connectionString: string): DrizzleDb {
  return drizzle(new Pool({ connectionString }), { schema });
}
