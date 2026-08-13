#!/usr/bin/env bash
set -Eeuo pipefail

mode="${1:-}"
case "$mode" in
  ci | database) ;;
  *) printf 'usage: %s <ci|database>\n' "$0" >&2; exit 2 ;;
esac

[[ "$(hostname -s)" == "claw" ]] || {
  printf 'This CI adapter may run only on the Claw host.\n' >&2
  exit 2
}
workspace="$(realpath "${GITHUB_WORKSPACE:?GITHUB_WORKSPACE is required}")"
[[ "$workspace" == /home/pall/actions-runner-ii-tonya/_work/* ]] || {
  printf 'Unexpected runner workspace.\n' >&2
  exit 2
}

compose_root=/home/pall/app-stack
test_image=7d71646347d560ff2b5d8ebc4c0aad5b48230254
container_script="$(mktemp)"
trap 'rm -f "$container_script"' EXIT

if [[ "$mode" == ci ]]; then
  cat > "$container_script" <<'SCRIPT'
set -Eeuo pipefail
cd /workspace/source
export CI=true
proxy_ip="$(getent ahostsv4 proxy-gateway | awk 'NR == 1 { print $1 }')"
printf '%s\n' strict_chain proxy_dns 'tcp_read_time_out 15000' \
  'tcp_connect_time_out 8000' '[ProxyList]' "socks5 $proxy_ip 1080" > /workspace/.proxychains4.conf
proxychains4 -q -f /workspace/.proxychains4.conf pnpm install --frozen-lockfile --store-dir /workspace/source/.pnpm-store
pnpm build
pnpm exec vitest run tests/repo/env-policy.test.ts --maxWorkers=1
pnpm format:check
pnpm verify:deploy
pnpm lint
pnpm typecheck
pnpm exec vitest run --maxWorkers=1
proxychains4 -q -f /workspace/.proxychains4.conf pnpm audit --prod --audit-level high
pnpm exec vitest run --coverage --reporter=default --reporter=junit --outputFile.junit=test-results/junit.xml --maxWorkers=1
docker run --rm -v "$CLAW_HOST_WORKSPACE:/repo:ro" ghcr.io/gitleaks/gitleaks:v8.28.0 \
  detect --source=/repo --config=/repo/.gitleaks.toml \
  --gitleaks-ignore-path=/repo/.gitleaksignore --no-banner --redact
sandbox_ci_root="$(mktemp -d /workspace/source/.ii-tonya-sandbox-ci.XXXXXX)"
trap 'rm -rf "$sandbox_ci_root"' EXIT
source_sha="$(git rev-parse HEAD)"
test "$source_sha" = "$GITHUB_SHA"
export SANDBOX_SOURCE_ARCHIVE="$sandbox_ci_root/source.tar"
export SOURCE_BUNDLE="$sandbox_ci_root/source.bundle"
export SANDBOX_BUILD_ROOT="$sandbox_ci_root/build"
export LOCAL_SOURCE_ROOT=/workspace/source
export DOCKER_HOST_SOURCE_ROOT="$CLAW_HOST_WORKSPACE"
export DOCKER_HOST_INSTALLED_ROOT="$CLAW_HOST_WORKSPACE"
export DOCKER_HOST_STORE_ROOT="$CLAW_HOST_WORKSPACE/.pnpm-store"
mkdir -p "$SANDBOX_BUILD_ROOT"
git archive --format=tar --output="$SANDBOX_SOURCE_ARCHIVE" "$source_sha"
git bundle create "$SOURCE_BUNDLE" --all
VCS_REF="$source_sha" pnpm test:container
SCRIPT
else
  cat > "$container_script" <<'SCRIPT'
set -Eeuo pipefail
cd /workspace/source
export CI=true
proxy_ip="$(getent ahostsv4 proxy-gateway | awk 'NR == 1 { print $1 }')"
printf '%s\n' strict_chain proxy_dns 'tcp_read_time_out 15000' \
  'tcp_connect_time_out 8000' '[ProxyList]' "socks5 $proxy_ip 1080" > /workspace/.proxychains4.conf
proxychains4 -q -f /workspace/.proxychains4.conf pnpm install --frozen-lockfile --store-dir /workspace/.pnpm-store
pnpm build
pnpm exec drizzle-kit check --config packages/db/drizzle.config.ts
pnpm exec vitest run tests/integration/schema.test.ts --maxWorkers=1
pnpm exec vitest run tests/repo/db-schema-parity.test.ts tests/integration/expert-referral-schema.test.ts tests/integration/expert-referral-migration-upgrade.test.ts --maxWorkers=1
pnpm exec vitest run tests/integration/webhook-inbox.test.ts tests/integration/catalog-repository.test.ts tests/integration/feedback-transaction.test.ts tests/integration/admin-approval.test.ts tests/integration/admin-ledger.test.ts tests/e2e/mvp-smoke.test.ts tests/integration/admin-api.test.ts --maxWorkers=1
pnpm test:repeat -- 3 tests/integration/message-ledger-concurrency.test.ts
pnpm test:repeat -- 3 tests/integration/conversation-message-repository.test.ts
pnpm test:repeat -- 3 tests/integration/booking-concurrency.test.ts
pnpm test:repeat -- 3 tests/integration/outbox-runner.test.ts tests/integration/outbox-repository.test.ts
pnpm test:repeat -- 3 tests/integration/telegram-callback-migration.test.ts tests/integration/telegram-callback-repository.test.ts
pnpm test:repeat -- 3 tests/integration/expert-referral-redemption-concurrency.test.ts
pnpm test:repeat -- 3 tests/integration/expert-residency-checkout-concurrency.test.ts
pnpm test:repeat -- 3 tests/integration/expert-residency-settlement-concurrency.test.ts
pnpm test:repeat -- 3 tests/integration/expert-residency-deadline.test.ts
pnpm test:repeat -- 3 tests/integration/expert-residency-hold-replay.test.ts
pnpm exec vitest run packages/sandbox-payments/src/repository.test.ts packages/sandbox-payments/src/workflow.test.ts packages/sandbox-payments/src/verifier.test.ts packages/sandbox-payments/src/adapter.test.ts apps/sandbox-api/src/server.test.ts apps/sandbox-api/src/routes.test.ts tests/e2e/sandbox-payment-provider.test.ts tests/integration/sandbox-payment-reconciliation.test.ts tests/repo/sandbox-production-isolation.test.ts --maxWorkers=1
pnpm test:repeat -- 3 tests/integration/sandbox-payment-reconciliation.test.ts
SCRIPT
fi

chmod 0700 "$container_script"
cd "$compose_root"
II_TONYA_SOURCE_SHA="$test_image" docker compose --profile test run --rm --no-deps \
  -e CI=true \
  -e "GITHUB_SHA=${GITHUB_SHA:?GITHUB_SHA is required}" \
  -e "CLAW_HOST_WORKSPACE=$workspace" \
  -v "$workspace:/workspace/source" \
  -v "$container_script:/tmp/ii-tonya-actions-job.sh:ro" \
  --entrypoint bash ii-tonya-test /tmp/ii-tonya-actions-job.sh
