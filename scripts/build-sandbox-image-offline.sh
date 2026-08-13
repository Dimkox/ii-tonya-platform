#!/usr/bin/env bash
set -euo pipefail

: "${SOURCE_ARCHIVE:?SOURCE_ARCHIVE is required}"
: "${SOURCE_SHA:?SOURCE_SHA is required}"
test "$SOURCE_SHA" = "$(sha256sum "$SOURCE_ARCHIVE" | cut -d' ' -f1)"
test "$(docker image inspect ii-tonya-test:7d71646347d560ff2b5d8ebc4c0aad5b48230254 --format '{{.Id}}')" = "sha256:a8f8d4bb072b4ef94f5cdf36a077a3be158bc314282c37fe026ffbe468746cb8"

fixture="$(mktemp -d)"
cleanup() { rm -rf "$fixture"; }
trap cleanup EXIT INT TERM
mkdir -p "$fixture/source" "$fixture/context/sandbox-api" "$fixture/context/sandbox-migrations"
tar -xf "$SOURCE_ARCHIVE" -C "$fixture/source"

docker run --rm --network none --read-only --tmpfs /tmp:rw,size=256m \
  --cap-drop ALL --security-opt no-new-privileges \
  --volume "$fixture/source:/work:rw" \
  --entrypoint sh ii-tonya-test:7d71646347d560ff2b5d8ebc4c0aad5b48230254 -lc '
    set -eu
    cp -a /seed/node_modules /work/node_modules
    cp -a /seed/.pnpm-store /work/.pnpm-store
    for path in apps packages; do find "/seed/$path" -mindepth 2 -maxdepth 2 -type d -name node_modules -exec sh -c '"'"'target=/work/${1#/seed/}; mkdir -p "$(dirname "$target")"; cp -a "$1" "$target"'"'"' sh {} \;; done
    cd /work
    pnpm install --store-dir /work/.pnpm-store --offline --frozen-lockfile
    pnpm --filter @ii-tonya/sandbox-api... build
  '
cp -a "$fixture/source/apps/sandbox-api/dist/." "$fixture/context/sandbox-api/dist/"
cp "$fixture/source/apps/sandbox-api/package.json" "$fixture/context/sandbox-api/package.json"
cp -a "$fixture/source/node_modules" "$fixture/context/sandbox-api/node_modules"
cp -a "$fixture/source/packages/sandbox-payments/migrations/." "$fixture/context/sandbox-migrations/"
cp "$fixture/source/Dockerfile.sandbox" "$fixture/context/Dockerfile.sandbox"
find "$fixture/context" -type l -exec test -e {} \;
find "$fixture/context" -type f -print0 | sort -z | xargs -0 sha256sum > "$fixture/context/SHA256SUMS"
docker build --network none --file "$fixture/context/Dockerfile.sandbox" --target sandbox-api \
  --build-arg VCS_REF="$SOURCE_SHA" --tag "ii-tonya-sandbox-smoke:$SOURCE_SHA" "$fixture/context"
printf 'sandbox_artifact_sha256=%s\n' "$(sha256sum "$fixture/context/SHA256SUMS" | cut -d' ' -f1)"
