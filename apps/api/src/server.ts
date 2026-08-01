import { pathToFileURL } from "node:url";
import { loadEnv } from "@ii-tonya/config";
import { createDb, type DrizzleDb } from "@ii-tonya/db";
import { createLogger } from "@ii-tonya/observability";
import { buildApp, type AppDependencies } from "./app.js";

export interface ServerLifecycle {
  dependencies(config: ReturnType<typeof loadEnv>, db: DrizzleDb): Promise<AppDependencies>;
  migrate(db: DrizzleDb): Promise<void>;
  close(): Promise<void>;
}
export async function main(lifecycle?: ServerLifecycle): Promise<void> {
  const config = loadEnv(process.env);
  if (lifecycle === undefined) throw new Error("Production composition lifecycle is not configured");
  const db = createDb(config.databaseUrl);
  await lifecycle.migrate(db);
  const app = await buildApp(await lifecycle.dependencies(config, db));
  const host = process.env.HOST ?? "127.0.0.1"; const port = Number(process.env.PORT ?? "3000");
  const shutdown = async () => { await app.close(); await lifecycle.close(); };
  process.once("SIGTERM", shutdown); process.once("SIGINT", shutdown);
  await app.listen({ host, port });
}
const invokedPath = process.argv[1];
if (invokedPath !== undefined && import.meta.url === pathToFileURL(invokedPath).href) {
  void main().catch((error: unknown) => { createLogger().fatal({ err: error }, "api startup failed"); process.exitCode = 1; });
}
