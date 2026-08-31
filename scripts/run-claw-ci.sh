#!/usr/bin/env bash
set -Eeuo pipefail

mode="${1:-}"
case "$mode" in
  ci | database | release | client-booking) ;;
  *) printf 'usage: %s <ci|database|release|client-booking>\n' "$0" >&2; exit 2 ;;
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
git_common_dir="$(git -C "$source_root" rev-parse --path-format=absolute --git-common-dir)"
git_marker="$source_root/.git"
test -d "$git_common_dir"
test -e "$git_marker"
if [[ "$mode" == client-booking ]]; then
  test -z "$(git -C "$source_root" status --porcelain --untracked-files=all)"
  test ! -e "$source_root/node_modules"
  test ! -e "$source_root/.claw-client-booking-node-modules"
  : "${II_TONYA_TEST_POSTGRES_ADMIN_URL:?II_TONYA_TEST_POSTGRES_ADMIN_URL is required}"
fi
missing_git_object="$(git -C "$source_root" rev-list --objects --all --missing=print | sed -n '/^?/ { p; q; }')"
[[ -z "$missing_git_object" ]] || {
  printf 'Git history is incomplete; refusing security scan.\n' >&2
  exit 1
}

compose_root=/home/pall/app-stack
claw_store=$compose_root/ii-tonya-test-workspace/.pnpm-store
test_image=29993b4fe96facf8c07781833dc7f2d5f560aa7e
test_image_ref="ii-tonya-test:$test_image"
expected_test_image_id=sha256:fd31ecb001fea3e4c6d044a420ce2b607586dfa4441ee98b3f7ae6e20abedd63
test -d "$claw_store"
test "$(docker image inspect "$test_image_ref" --format '{{.Id}}')" = "$expected_test_image_id"
claw_syft=""
if [[ "$mode" == release ]]; then
  claw_syft="$(bash "$source_root/scripts/provision-claw-syft.sh")"
  test -x "$claw_syft"
fi
container_script="$(mktemp)"
evidence_dir="$source_root/docs/test-evidence/claw/$source_sha"
release_output="$source_root/.native-release"
mkdir -p "$evidence_dir" "$release_output"

cleanup() {
  rm -f "$container_script"
  if [[ "$mode" == client-booking && -f "$source_root/.claw-client-booking-node-modules" ]]; then
    rm -rf "$source_root/node_modules" "$source_root/.claw-client-booking-node-modules"
  fi
  cd "$compose_root"
  docker compose --profile test rm -f -s ii-tonya-test >/dev/null 2>&1 || true
}
trap cleanup EXIT

cat > "$container_script" <<'SCRIPT'
set -Eeuo pipefail
cd /workspace/source
export CI=true
if [[ "$CLAW_GATE_MODE" != client-booking ]]; then
  pnpm install --offline --frozen-lockfile --trust-lockfile --store-dir /workspace/.pnpm-store
fi
case "$CLAW_GATE_MODE" in
  ci)
    pnpm build
    pnpm exec vitest run tests/repo/env-policy.test.ts --maxWorkers=1
    pnpm format:check
    pnpm verify:deploy
    pnpm lint
    NODE_OPTIONS=--max-old-space-size=1024 pnpm typecheck
    pnpm exec vitest run --coverage --maxWorkers=1
    docker run --rm \
      -v "$CLAW_HOST_SOURCE_ROOT:/repo:ro" \
      -v "$CLAW_HOST_GIT_COMMON_DIR:$CLAW_HOST_GIT_COMMON_DIR:ro" \
      ghcr.io/gitleaks/gitleaks:v8.28.0 \
      detect --source=/repo --config=/repo/.gitleaks.toml \
      --gitleaks-ignore-path=/repo/.gitleaksignore --no-banner --redact --exit-code=1
    ;;
  database)
    pnpm build
    pnpm exec drizzle-kit check --config packages/db/drizzle.config.ts
    pnpm exec vitest run tests/integration/schema.test.ts tests/repo/db-schema-parity.test.ts --maxWorkers=1
    pnpm exec vitest run tests/integration/expert-referral-schema.test.ts tests/integration/expert-referral-migration-upgrade.test.ts --maxWorkers=1
    pnpm exec vitest run tests/integration/message-ledger-concurrency.test.ts --maxWorkers=1
    pnpm exec vitest run tests/integration/conversation-message-repository.test.ts --maxWorkers=1
    pnpm exec vitest run tests/integration/booking-concurrency.test.ts --maxWorkers=1
    pnpm exec vitest run tests/integration/expert-referral-redemption-concurrency.test.ts --maxWorkers=1
    pnpm exec vitest run tests/integration/expert-residency-checkout-concurrency.test.ts --maxWorkers=1
    pnpm exec vitest run tests/integration/expert-residency-settlement-concurrency.test.ts --maxWorkers=1
    pnpm exec vitest run tests/integration/expert-residency-deadline.test.ts --maxWorkers=1
    pnpm exec vitest run tests/integration/expert-residency-hold-replay.test.ts --maxWorkers=1
    pnpm exec vitest run tests/integration/test-expert-trial-postgres.test.ts --maxWorkers=1
    pnpm exec vitest run tests/integration/yookassa-migration-upgrade.test.ts --maxWorkers=1
    pnpm exec vitest run tests/integration/yookassa-operation-concurrency.test.ts --maxWorkers=1
    pnpm exec vitest run tests/integration/yookassa-reconciliation.test.ts --maxWorkers=1
    pnpm exec vitest run tests/e2e/sandbox-payment-provider.test.ts tests/integration/sandbox-payment-reconciliation.test.ts --maxWorkers=1
    ;;
  release)
    SOURCE_SHA="$CLAW_SOURCE_SHA" OUTPUT_DIR=/workspace/release-output \
      bash scripts/build-native-release.sh
    test -f /workspace/release-output/native-release.tar.gz
    ;;
  client-booking)
    mkdir node_modules
    : > .claw-client-booking-node-modules
    test -d /seed/node_modules/.pnpm
    ln -s /seed/node_modules/.pnpm node_modules/.pnpm
    test "$(readlink -f node_modules/.pnpm)" = /seed/node_modules/.pnpm
    resolve_seed_package() {
      local package_name="$1" package_version="$2" pnpm_prefix="$3"
      local candidate
      local -a candidates
      shopt -s nullglob
      candidates=(/seed/node_modules/.pnpm/"$pnpm_prefix"*/node_modules/"$package_name")
      shopt -u nullglob
      test "${#candidates[@]}" -eq 1 || {
        printf 'Expected exactly one seeded package for %s@%s; found %s.\n' \
          "$package_name" "$package_version" "${#candidates[@]}" >&2
        exit 1
      }
      candidate="${candidates[0]}"
      test -f "$candidate/package.json"
      node -e '
        const fs = require("node:fs");
        const [packageJson, expectedName, expectedVersion] = process.argv.slice(1);
        const actual = JSON.parse(fs.readFileSync(packageJson, "utf8"));
        if (actual.name !== expectedName || actual.version !== expectedVersion) process.exit(1);
      ' "$candidate/package.json" "$package_name" "$package_version"
      printf '%s\n' "$candidate"
    }
    for package_spec in \
      "drizzle-orm|0.45.2|drizzle-orm@" \
      "pg|8.22.0|pg@" \
      "pino|9.14.0|pino@" \
      "fastify|5.10.0|fastify@"; do
      IFS='|' read -r package_name package_version pnpm_prefix <<< "$package_spec"
      package_path="$(resolve_seed_package "$package_name" "$package_version" "$pnpm_prefix")"
      ln -s "$package_path" "node_modules/$package_name"
      test "$(readlink -f "node_modules/$package_name")" = "$package_path"
    done
    mkdir node_modules/@fastify
    rate_limit_package="$(resolve_seed_package "@fastify/rate-limit" 10.3.0 "@fastify+rate-limit@")"
    ln -s "$rate_limit_package" node_modules/@fastify/rate-limit
    test "$(readlink -f node_modules/@fastify/rate-limit)" = "$rate_limit_package"
    zod_package="$(resolve_seed_package zod 4.4.3 zod@)"
    rm -f node_modules/zod
    ln -s "$zod_package" node_modules/zod
    test "$(readlink -f node_modules/zod)" = "$zod_package"
    vitest_package="$(resolve_seed_package vitest 3.2.7 vitest@)"
    rm -f node_modules/vitest
    ln -s "$vitest_package" node_modules/vitest
    test "$(readlink -f node_modules/vitest)" = "$vitest_package"
    mkdir node_modules/@opentelemetry
    opentelemetry_api_package="$(resolve_seed_package "@opentelemetry/api" 1.9.1 "@opentelemetry+api@")"
    ln -s "$opentelemetry_api_package" node_modules/@opentelemetry/api
    test "$(readlink -f node_modules/@opentelemetry/api)" = "$opentelemetry_api_package"
    mkdir node_modules/@testcontainers
    testcontainers_postgresql_package="$(resolve_seed_package "@testcontainers/postgresql" 10.28.0 "@testcontainers+postgresql@")"
    ln -s "$testcontainers_postgresql_package" node_modules/@testcontainers/postgresql
    test "$(readlink -f node_modules/@testcontainers/postgresql)" = "$testcontainers_postgresql_package"
    node scripts/assert-client-booking-postgres.mjs
    rm -f node_modules/@ii-tonya
    mkdir node_modules/@ii-tonya
    workspace_packages=(domain config contracts application integrations db observability worker)
    for workspace_package in "${workspace_packages[@]}"; do
      ln -sfn "/workspace/source/packages/$workspace_package" "node_modules/@ii-tonya/$workspace_package"
    done
    for workspace_package in "${workspace_packages[@]}"; do
      (
        cd "packages/$workspace_package"
        /seed/node_modules/.bin/tsup src/index.ts --format esm --clean --tsconfig ../../tsconfig.base.json
      )
    done
    for workspace_package in "${workspace_packages[@]}"; do
      test "$(readlink -f "node_modules/@ii-tonya/$workspace_package")" = "/workspace/source/packages/$workspace_package"
      test -f "packages/$workspace_package/dist/index.js"
    done
    /seed/node_modules/.bin/vitest run tests/integration/client-booking-schema.test.ts tests/repo/db-schema-parity.test.ts tests/integration/client-catalog-booking-choice.test.ts tests/integration/client-booking-repository.test.ts tests/integration/client-booking-privacy.test.ts tests/e2e/client-booking-boundary.test.ts tests/repo/client-booking-boundaries.test.ts apps/api/src/client-booking-principal-resolver.test.ts apps/api/src/routes/client-booking.test.ts packages/worker/src/client-booking-erasure.test.ts packages/contracts/src/worker-outbox.test.ts apps/worker/src/main.test.ts apps/worker/src/runtime.test.ts packages/observability/src/logger.test.ts packages/observability/src/metrics.test.ts tests/repo/workflow-semantics.test.ts --maxWorkers=1
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
  -e "CLAW_HOST_GIT_COMMON_DIR=$git_common_dir"
  -v "$source_root:/workspace/source"
  -v "$git_common_dir:$git_common_dir:ro"
  -v "$git_marker:/workspace/source/.git:ro"
  -v "$claw_store:/workspace/.pnpm-store"
  -v "$release_output:/workspace/release-output"
  -v "$container_script:/tmp/ii-tonya-claw-gate.sh:ro"
)
if [[ -n "$claw_syft" ]]; then
  compose_args+=( -v "$claw_syft:/usr/local/bin/syft:ro" )
fi
if [[ "$mode" == client-booking ]]; then
  compose_args+=( -e II_TONYA_TEST_POSTGRES_ADMIN_URL )
fi

II_TONYA_SOURCE_SHA="$test_image" docker compose "${compose_args[@]}" \
  --entrypoint bash ii-tonya-test /tmp/ii-tonya-claw-gate.sh

test "$(git -C "$source_root" rev-parse HEAD)" = "$source_sha"
test -z "$(git -C "$source_root" status --porcelain --untracked-files=no)"

cat > "$evidence_dir/${mode}.md" <<EOF
# Direct Claw ${mode} gate

- source_sha: $source_sha
- started_at_utc: $started_at
- completed_at_utc: $(date -u +%Y-%m-%dT%H:%M:%SZ)
- status: PASS
- claw_test_container: true
- production_container: false
- repeat_limit: 1
- github_actions: not_used
EOF
