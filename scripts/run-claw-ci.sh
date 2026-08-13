#!/usr/bin/env bash
set -Eeuo pipefail

mode="${1:-}"
case "$mode" in
  ci | database | release) ;;
  *) printf 'usage: %s <ci|database|release>\n' "$0" >&2; exit 2 ;;
esac

[[ "$(hostname -s)" == "claw" ]] || {
  printf 'This verification adapter may run only on the Claw host.\n' >&2
  exit 2
}

source_root="$(realpath "${SOURCE_ROOT:?SOURCE_ROOT is required}")"
source_sha="${SOURCE_SHA:?SOURCE_SHA is required}"
[[ "$source_sha" =~ ^[0-9a-f]{40}$ ]] || {
  printf 'SOURCE_SHA must be a full lowercase Git SHA.\n' >&2
  exit 2
}
test "$(git -C "$source_root" rev-parse HEAD)" = "$source_sha"
test -z "$(git -C "$source_root" status --porcelain --untracked-files=no)"

compose_root=/home/pall/app-stack
claw_store=$compose_root/ii-tonya-test-workspace/.pnpm-store
test_image=7d71646347d560ff2b5d8ebc4c0aad5b48230254
test -d "$claw_store"
claw_syft=""
if [[ "$mode" == release ]]; then
  claw_syft="$($source_root/scripts/provision-claw-syft.sh)"
  test -x "$claw_syft"
fi
container_script="$(mktemp)"
evidence_dir="$source_root/docs/test-evidence/claw/$source_sha"
release_output="$source_root/.native-release"
mkdir -p "$evidence_dir" "$release_output"

cleanup() {
  rm -f "$container_script"
  cd "$compose_root"
  docker compose --profile test rm -f -s ii-tonya-test >/dev/null 2>&1 || true
}
trap cleanup EXIT

cat > "$container_script" <<'SCRIPT'
set -Eeuo pipefail
cd /workspace/source
export CI=true
pnpm install --offline --frozen-lockfile --trust-lockfile --store-dir /workspace/.pnpm-store
pnpm build
case "$CLAW_GATE_MODE" in
  ci)
    pnpm exec vitest run tests/repo/env-policy.test.ts --maxWorkers=1
    pnpm format:check
    pnpm verify:deploy
    pnpm lint
    pnpm typecheck
    pnpm exec vitest run --coverage --maxWorkers=1
    docker run --rm -v "$CLAW_HOST_SOURCE_ROOT:/repo:ro" ghcr.io/gitleaks/gitleaks:v8.28.0 \
      detect --source=/repo --config=/repo/.gitleaks.toml \
      --gitleaks-ignore-path=/repo/.gitleaksignore --no-banner --redact
    ;;
  database)
    pnpm exec drizzle-kit check --config packages/db/drizzle.config.ts
    pnpm exec vitest run tests/integration/schema.test.ts tests/repo/db-schema-parity.test.ts --maxWorkers=1
    pnpm exec vitest run tests/integration/expert-referral-schema.test.ts tests/integration/expert-referral-migration-upgrade.test.ts --maxWorkers=1
    pnpm test:repeat -- 3 tests/integration/message-ledger-concurrency.test.ts
    pnpm test:repeat -- 3 tests/integration/conversation-message-repository.test.ts
    pnpm test:repeat -- 3 tests/integration/booking-concurrency.test.ts
    pnpm test:repeat -- 3 tests/integration/expert-referral-redemption-concurrency.test.ts
    pnpm test:repeat -- 3 tests/integration/expert-residency-checkout-concurrency.test.ts
    pnpm test:repeat -- 3 tests/integration/expert-residency-settlement-concurrency.test.ts
    pnpm test:repeat -- 3 tests/integration/expert-residency-deadline.test.ts
    pnpm test:repeat -- 3 tests/integration/expert-residency-hold-replay.test.ts
    pnpm exec vitest run tests/e2e/sandbox-payment-provider.test.ts tests/integration/sandbox-payment-reconciliation.test.ts --maxWorkers=1
    pnpm test:repeat -- 3 tests/integration/sandbox-payment-reconciliation.test.ts
    ;;
  release)
    SOURCE_SHA="$CLAW_SOURCE_SHA" OUTPUT_DIR=/workspace/release-output \
      bash scripts/build-native-release.sh
    test -f /workspace/release-output/native-release.tar.gz
    ;;
esac
SCRIPT

chmod 0700 "$container_script"
started_at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
cd "$compose_root"
compose_args=(
  --profile test run --rm --no-deps
  -e CI=true
  -e "CLAW_GATE_MODE=$mode"
  -e "CLAW_SOURCE_SHA=$source_sha"
  -e "CLAW_HOST_SOURCE_ROOT=$source_root"
  -v "$source_root:/workspace/source"
  -v "$claw_store:/workspace/.pnpm-store"
  -v "$release_output:/workspace/release-output"
  -v "$container_script:/tmp/ii-tonya-claw-gate.sh:ro"
)
if [[ -n "$claw_syft" ]]; then
  compose_args+=( -v "$claw_syft:/usr/local/bin/syft:ro" )
fi

II_TONYA_SOURCE_SHA="$test_image" docker compose "${compose_args[@]}" \
  --entrypoint bash ii-tonya-test /tmp/ii-tonya-claw-gate.sh

cat > "$evidence_dir/${mode}.md" <<EOF
# Direct Claw ${mode} gate

- source_sha: $source_sha
- started_at_utc: $started_at
- completed_at_utc: $(date -u +%Y-%m-%dT%H:%M:%SZ)
- status: PASS
- claw_test_container: true
- production_container: false
- repeat_limit: 3
- github_actions: not_used
EOF
