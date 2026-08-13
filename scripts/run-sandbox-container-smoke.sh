#!/usr/bin/env bash
set -euo pipefail

: "${SANDBOX_DATABASE_URL:?SANDBOX_DATABASE_URL is required}"
project="ii-tonya-sandbox-${VCS_REF:-local}"
cleanup() {
  docker compose --project-name "$project" --file compose.sandbox.yaml --profile sandbox down --volumes --remove-orphans >/dev/null 2>&1 || true
}
trap cleanup EXIT INT TERM

# The focused PostgreSQL fixture proves checkout -> two-admin approval -> settlement
# -> canonical reconciliation -> refund before the same database is admitted to the image.
CI=true pnpm exec vitest run tests/e2e/sandbox-payment-provider.test.ts --maxWorkers=1
docker compose --project-name "$project" --file compose.sandbox.yaml --profile sandbox up --build --wait sandbox-api
status="$(docker compose --project-name "$project" --file compose.sandbox.yaml exec -T sandbox-api node --input-type=module --eval "const r=await fetch('http://127.0.0.1:3001/sandbox/v1/payments/sandbox_payment_abcdefghijklmnopqrstuv');process.stdout.write(String(r.status))")"
test "$status" = 200
printf 'sandbox_container_lifecycle=PASS\n'
