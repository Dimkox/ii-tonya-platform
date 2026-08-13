#!/usr/bin/env bash
set -Eeuo pipefail

release_root="$(realpath "${1:?release root is required}")"
source_sha="${SOURCE_SHA:?SOURCE_SHA is required}"
admin_url="${II_TONYA_TEST_POSTGRES_ADMIN_URL:?Claw PostgreSQL admin URL is required}"
[[ "$source_sha" =~ ^[0-9a-f]{40}$ ]] || exit 2
test "$(cat "$release_root/SOURCE_SHA")" = "$source_sha"
test -f "$release_root/api/dist/server.js"
test -f "$release_root/worker/dist/main.js"

db_name="ii_tonya_native_smoke"
export RELEASE_ROOT="$release_root" ADMIN_URL="$admin_url" DB_NAME="$db_name"
api_pid=""
worker_pid=""
database_ready=false

reset_database() {
  node --input-type=module <<'NODE'
import { createRequire } from "node:module";
import { realpathSync } from "node:fs";
const dbRoot = realpathSync(`${process.env.RELEASE_ROOT}/api/node_modules/@ii-tonya/db`);
const require = createRequire(`${dbRoot}/package.json`);
const { Client } = require("pg");
const name = process.env.DB_NAME;
if (name !== "ii_tonya_native_smoke") process.exit(2);
const url = new URL(process.env.ADMIN_URL);
url.pathname = `/${name}`;
url.search = "";
const client = new Client({ connectionString: url.toString() });
await client.connect();
try {
  await client.query("DROP SCHEMA IF EXISTS public CASCADE");
  await client.query("CREATE SCHEMA public");
}
finally { await client.end(); }
NODE
}

cleanup() {
  set +e
  [[ -z "$worker_pid" ]] || { kill -TERM "$worker_pid" 2>/dev/null; wait "$worker_pid" 2>/dev/null; }
  [[ -z "$api_pid" ]] || { kill -TERM "$api_pid" 2>/dev/null; wait "$api_pid" 2>/dev/null; }
  [[ "$database_ready" != true ]] || reset_database >/dev/null 2>&1
  rm -f /tmp/ii-tonya-worker-heartbeat /tmp/ii-tonya-native-api.log /tmp/ii-tonya-native-worker.log
}
trap cleanup EXIT

node --input-type=module <<'NODE'
import { createRequire } from "node:module";
import { realpathSync } from "node:fs";
const dbRoot = realpathSync(`${process.env.RELEASE_ROOT}/api/node_modules/@ii-tonya/db`);
const require = createRequire(`${dbRoot}/package.json`);
const { Client } = require("pg");
const name = process.env.DB_NAME;
if (name !== "ii_tonya_native_smoke") process.exit(2);
const client = new Client({ connectionString: process.env.ADMIN_URL });
await client.connect();
try {
  const existing = await client.query("SELECT 1 FROM pg_database WHERE datname = $1", [name]);
  if (existing.rowCount === 0) await client.query(`CREATE DATABASE "${name}"`);
}
finally { await client.end(); }
NODE
database_ready=true

database_url="$(node --input-type=module <<'NODE'
const url = new URL(process.env.ADMIN_URL);
url.pathname = `/${process.env.DB_NAME}`;
url.search = "";
process.stdout.write(url.toString());
NODE
)"
reset_database

runtime_env=(
  NODE_ENV=production
  "DATABASE_URL=$database_url"
  ALLOW_INSECURE_LOCAL_DATABASE=true
  HOST=127.0.0.1
  PORT=3000
  RAW_CONVERSATION_LOGGING=false
  EXPERT_REFERRAL_ENABLED=false
  EXPERT_RESIDENCY_BILLING_ENABLED=false
  EXPERT_TELEGRAM_QUERIES_ENABLED=false
)

env -u II_TONYA_TEST_POSTGRES_ADMIN_URL "${runtime_env[@]}" \
  node "$release_root/api/migrate-native.mjs"
env -u II_TONYA_TEST_POSTGRES_ADMIN_URL "${runtime_env[@]}" \
  node "$release_root/api/dist/server.js" >/tmp/ii-tonya-native-api.log 2>&1 &
api_pid=$!

ready=false
for _ in $(seq 1 30); do
  if node -e 'fetch("http://127.0.0.1:3000/health/ready").then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))'; then
    ready=true
    break
  fi
  kill -0 "$api_pid" 2>/dev/null || break
  sleep 1
done
if [[ "$ready" != true ]]; then
  tail -20 /tmp/ii-tonya-native-api.log >&2
  exit 1
fi
printf 'native_api_ready=PASS\n'

rm -f /tmp/ii-tonya-worker-heartbeat
env -u II_TONYA_TEST_POSTGRES_ADMIN_URL "${runtime_env[@]}" WORKER_POLL_INTERVAL_MS=200 \
  node "$release_root/worker/dist/main.js" >/tmp/ii-tonya-native-worker.log 2>&1 &
worker_pid=$!
heartbeat=false
for _ in $(seq 1 30); do
  if [[ -s /tmp/ii-tonya-worker-heartbeat ]]; then heartbeat=true; break; fi
  kill -0 "$worker_pid" 2>/dev/null || break
  sleep 1
done
if [[ "$heartbeat" != true ]]; then
  tail -20 /tmp/ii-tonya-native-worker.log >&2
  exit 1
fi
printf 'native_worker_heartbeat=PASS\n'

kill -TERM "$worker_pid"
wait "$worker_pid"
worker_pid=""
kill -TERM "$api_pid"
wait "$api_pid"
api_pid=""
reset_database
database_ready=false
printf 'native_database_cleanup=PASS\n'
