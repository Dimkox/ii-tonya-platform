#!/usr/bin/env bash
set -euo pipefail

: "${SANDBOX_DATABASE_URL:?SANDBOX_DATABASE_URL is required}"
project="ii-tonya-sandbox-${VCS_REF:-local}"
cleanup() {
  docker compose --project-name "$project" --file compose.sandbox.yaml --profile sandbox down --volumes --remove-orphans >/dev/null 2>&1 || true
}
trap cleanup EXIT INT TERM

docker compose --project-name "$project" --file compose.sandbox.yaml --profile sandbox up --build --wait sandbox-api
node scripts/sandbox-container-lifecycle.mjs
