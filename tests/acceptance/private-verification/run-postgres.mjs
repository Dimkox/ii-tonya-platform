import { readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
// Reuses an already-running task-owned PostgreSQL17.5 cluster. Never creates a cluster.
const config = JSON.parse(
  readFileSync(
    process.env.PRIVATE_EVIDENCE_COMPOSE_CONFIG ??
      "/tmp/verification-form-20261026.compose.json",
    "utf8",
  ),
).services.postgres.environment;
const port = process.env.PRIVATE_EVIDENCE_POSTGRES_PORT ?? "55483";
if (!/^\d{1,5}$/.test(port)) throw Error("invalid_local_port");
const url = `postgresql://${encodeURIComponent(config.POSTGRES_USER)}:${encodeURIComponent(config.POSTGRES_PASSWORD)}@127.0.0.1:${port}/${encodeURIComponent(config.POSTGRES_DB)}`;
const [output, ...args] = process.argv.slice(2);
if (!output || !args.length)
  throw Error("usage: run-postgres.mjs output.log test-path [vitest-options]");
const result = spawnSync(
  process.execPath,
  ["node_modules/vitest/vitest.mjs", "run", ...args],
  {
    encoding: "utf8",
    env: { ...process.env, II_TONYA_TEST_POSTGRES_ADMIN_URL: url },
    timeout: 180000,
  },
);
const safe = (result.stdout + "\n" + result.stderr)
  .split(url)
  .join("[redacted]")
  .split(config.POSTGRES_PASSWORD)
  .join("[redacted]");
writeFileSync(output, safe);
process.stdout.write(safe);
process.exit(result.status ?? 1);
