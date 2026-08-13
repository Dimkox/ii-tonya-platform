#!/usr/bin/env bash
set -euo pipefail

: "${SOURCE_ARCHIVE:?SOURCE_ARCHIVE is required}"
: "${SOURCE_ARCHIVE_SHA:?SOURCE_ARCHIVE_SHA is required}"
: "${SOURCE_SHA:?SOURCE_SHA is required}"
: "${SANDBOX_IMAGE_REF:?SANDBOX_IMAGE_REF is required}"
git_source_sha="$SOURCE_SHA"
source_archive_sha256="$(sha256sum "$SOURCE_ARCHIVE" | cut -d' ' -f1)"
[[ "$git_source_sha" =~ ^[0-9a-f]{40}$ ]]
test "$SOURCE_ARCHIVE_SHA" = "$source_archive_sha256"
test "$(git rev-parse "$git_source_sha^{commit}")" = "$git_source_sha"
test "$(docker image inspect ii-tonya-test:7d71646347d560ff2b5d8ebc4c0aad5b48230254 --format '{{.Id}}')" = "sha256:a8f8d4bb072b4ef94f5cdf36a077a3be158bc314282c37fe026ffbe468746cb8"

fixture="$(mktemp -d)"
cleanup() { rm -rf "$fixture"; }
trap cleanup EXIT INT TERM
mkdir -p "$fixture/source" "$fixture/expected" "$fixture/context/sandbox-api" "$fixture/context/sandbox-migrations"
tar -xf "$SOURCE_ARCHIVE" -C "$fixture/source"
GIT_INDEX_FILE="$fixture/expected.index" git read-tree "$git_source_sha"
GIT_INDEX_FILE="$fixture/expected.index" git checkout-index --all --prefix="$fixture/expected/"
diff -qr "$fixture/expected" "$fixture/source"

docker run --rm --network none --read-only --tmpfs /tmp:rw,size=256m \
  --cap-drop ALL --security-opt no-new-privileges \
  --volume "$fixture/source:/work:rw" \
  --entrypoint sh ii-tonya-test:7d71646347d560ff2b5d8ebc4c0aad5b48230254 -lc '
    set -eu
    cp -a /seed/node_modules /work/node_modules
    cp -a /seed/.pnpm-store /work/.pnpm-store
    for path in apps packages; do find "/seed/$path" -mindepth 2 -maxdepth 2 -type d -name node_modules -exec sh -c '"'"'target=/work/${1#/seed/}; mkdir -p "$(dirname "$target")"; cp -a "$1" "$target"'"'"' sh {} \;; done
    cd /work
    CI=true pnpm install --store-dir /work/.pnpm-store --offline --frozen-lockfile
    pnpm --filter @ii-tonya/sandbox-api... build
    pnpm --filter @ii-tonya/sandbox-api --prod deploy /work/.sandbox-artifact
    find /work/.sandbox-artifact -type f -name package.json -print0 | xargs -0 node -e '"'"'
      const fs=require("node:fs");
      for(const path of process.argv.slice(1)) {
        const manifest=JSON.parse(fs.readFileSync(path,"utf8"));
        delete manifest.devDependencies;
        fs.writeFileSync(path, `${JSON.stringify(manifest,null,2)}\n`);
      }
    '"'"'
  '
artifact="$fixture/source/.sandbox-artifact"
test -f "$artifact/package.json"
test -f "$artifact/dist/server.js"
test -d "$artifact/node_modules"
test -z "$(find "$artifact" -type l -print -quit)"
if find "$artifact" -type f -name package.json -print0 | xargs -0 node -e '
  const fs=require("node:fs");
  for(const path of process.argv.slice(1)) {
    const manifest=JSON.parse(fs.readFileSync(path,"utf8"));
    if(manifest.devDependencies) process.exit(1);
  }
'; then :; else echo "sandbox artifact contains devDependencies" >&2; exit 1; fi
if grep -R -l -E '/workspace/|workspace:' "$artifact" >/dev/null; then
  echo "sandbox artifact contains workspace paths" >&2
  exit 1
fi
cp -a "$artifact/." "$fixture/context/sandbox-api/"
cp -a "$fixture/source/packages/sandbox-payments/migrations/." "$fixture/context/sandbox-migrations/"
cp "$fixture/source/Dockerfile.sandbox" "$fixture/context/Dockerfile.sandbox"
find "$fixture/context" -type l -exec test -e {} \;
(cd "$fixture/context" && find . -type f ! -name SHA256SUMS -print0 | sort -z | xargs -0 sha256sum > SHA256SUMS)
docker build --network none --file "$fixture/context/Dockerfile.sandbox" --target sandbox-api \
  --build-arg VCS_REF="$git_source_sha" --tag "$SANDBOX_IMAGE_REF" "$fixture/context"
printf 'git_source_sha=%s\n' "$git_source_sha"
printf 'source_archive_sha256=%s\n' "$source_archive_sha256"
printf 'sandbox_artifact_sha256=%s\n' "$(sha256sum "$fixture/context/SHA256SUMS" | cut -d' ' -f1)"
printf 'sandbox_image_id=%s\n' "$(docker image inspect "$SANDBOX_IMAGE_REF" --format '{{.Id}}')"
