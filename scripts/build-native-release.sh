#!/usr/bin/env bash
set -Eeuo pipefail

source_sha="${SOURCE_SHA:?SOURCE_SHA is required}"
[[ "$source_sha" =~ ^[0-9a-f]{40}$ ]] || {
  printf 'SOURCE_SHA must be a full lowercase Git SHA.\n' >&2
  exit 2
}
test "$(git rev-parse HEAD)" = "$source_sha"
test -z "$(git status --porcelain --untracked-files=no)"

output_dir="$(realpath -m "${OUTPUT_DIR:-.native-release}")"
work_dir="$(mktemp -d)"
cleanup() {
  find "$work_dir" -mindepth 1 -delete
  rmdir "$work_dir"
}
trap cleanup EXIT
mkdir -p "$output_dir" "$work_dir/release"

git archive --format=tar "$source_sha" > "$work_dir/source.tar"
source_archive_sha="$(sha256sum "$work_dir/source.tar" | awk '{print $1}')"
pnpm build
pnpm --offline --frozen-lockfile --trust-lockfile --filter @ii-tonya/api --prod deploy \
  "$work_dir/release/api"
pnpm --offline --frozen-lockfile --trust-lockfile --filter @ii-tonya/app-worker --prod deploy \
  "$work_dir/release/worker"
cp scripts/migrate-native.mjs "$work_dir/release/api/migrate-native.mjs"
mkdir -p "$work_dir/release/scripts"
cp scripts/validate-runtime-env.sh "$work_dir/release/scripts/validate-runtime-env.sh"
mkdir -p "$work_dir/release/scripts/sql"
cp scripts/provision-early-bird-runtime-roles.mjs \
  scripts/early-bird-role-capabilities.json "$work_dir/release/scripts/"
cp scripts/sql/provision-early-bird-runtime-roles.sql \
  scripts/sql/provision-early-bird-legacy-coverage.sql "$work_dir/release/scripts/sql/"
cp -R packages/db/migrations "$work_dir/release/migrations"
mkdir -p "$work_dir/release/gateway"
for gateway_file in launcher.py bound_gateway.py durable_state.py gateway.py ipc.py nonce_registry.py pg_authority.py provider_reader.py subject_tokens.py readiness.sql; do
  cp "scripts/experimental/yookassa_gateway/$gateway_file" "$work_dir/release/gateway/$gateway_file"
done
cp -R deploy/systemd "$work_dir/release/systemd"
cp -R deploy/gateway-provision "$work_dir/release/gateway-provision"
printf '%s\n' "$source_sha" > "$work_dir/release/SOURCE_SHA"
printf '{"source_sha":"%s","source_archive_sha256":"%s","format":"ii-tonya-native-v1"}\n' \
  "$source_sha" "$source_archive_sha" \
  > "$work_dir/release/provenance.json"

find "$work_dir/release" -type f \( -name '*.pem' -o -name '*.key' \) -print -quit | \
  grep -q . && { printf 'Credential-like file found in release.\n' >&2; exit 1; }

tar --sort=name --mtime='UTC 1970-01-01' --owner=0 --group=0 --numeric-owner \
  -C "$work_dir/release" -czf "$output_dir/native-release.tar.gz" .
cp "$work_dir/release/provenance.json" "$output_dir/native-release.provenance.json"
command -v syft >/dev/null 2>&1 || {
  printf 'Syft is required to create the release SBOM.\n' >&2
  exit 1
}
syft "dir:$work_dir/release" -o spdx-json="$output_dir/native-release.spdx.json"
(cd "$output_dir" && sha256sum native-release.tar.gz native-release.spdx.json \
  native-release.provenance.json > native-release.sha256)
