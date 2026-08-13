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
trap 'rm -rf "$work_dir"' EXIT
mkdir -p "$output_dir" "$work_dir/release"

git archive --format=tar "$source_sha" > "$work_dir/source.tar"
source_archive_sha="$(sha256sum "$work_dir/source.tar" | awk '{print $1}')"
pnpm build
pnpm --filter @ii-tonya/api --prod deploy "$work_dir/release/api"
pnpm --filter @ii-tonya/app-worker --prod deploy "$work_dir/release/worker"
cp scripts/migrate-native.mjs "$work_dir/release/api/migrate-native.mjs"
cp -R packages/db/migrations "$work_dir/release/migrations"
cp -R deploy/systemd "$work_dir/release/systemd"
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
