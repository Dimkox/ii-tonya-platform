#!/usr/bin/env bash
set -euo pipefail

: "${SOURCE_ARCHIVE:?SOURCE_ARCHIVE is required}"
: "${SOURCE_ARCHIVE_SHA:?SOURCE_ARCHIVE_SHA is required}"
: "${SOURCE_BUNDLE:?SOURCE_BUNDLE is required}"
: "${SOURCE_SHA:?SOURCE_SHA is required}"
: "${SANDBOX_IMAGE_REF:?SANDBOX_IMAGE_REF is required}"
git_source_sha="$SOURCE_SHA"
source_archive_sha256="$(sha256sum "$SOURCE_ARCHIVE" | cut -d' ' -f1)"
[[ "$git_source_sha" =~ ^[0-9a-f]{40}$ ]]
test "$SOURCE_ARCHIVE_SHA" = "$source_archive_sha256"
test "$(docker image inspect ii-tonya-test:7d71646347d560ff2b5d8ebc4c0aad5b48230254 --format '{{.Id}}')" = "sha256:a8f8d4bb072b4ef94f5cdf36a077a3be158bc314282c37fe026ffbe468746cb8"

build_root="${SANDBOX_BUILD_ROOT:-${TMPDIR:-/tmp}}"
mkdir -p "$build_root"
fixture="$(mktemp -d "$build_root/ii-tonya-sandbox-build.XXXXXX")"
cleanup() { rm -rf "$fixture"; }
trap cleanup EXIT INT TERM
mkdir -p "$fixture/source" "$fixture/expected" "$fixture/context/sandbox-api" "$fixture/context/sandbox-migrations"
git clone --quiet --no-checkout "$SOURCE_BUNDLE" "$fixture/trusted-repo"
test "$(git -C "$fixture/trusted-repo" rev-parse "$git_source_sha^{commit}")" = "$git_source_sha"
tar -xf "$SOURCE_ARCHIVE" -C "$fixture/source"
GIT_INDEX_FILE="$fixture/expected.index" git -C "$fixture/trusted-repo" read-tree "$git_source_sha"
GIT_INDEX_FILE="$fixture/expected.index" git -C "$fixture/trusted-repo" checkout-index --all --prefix="$fixture/expected/"
diff -qr "$fixture/expected" "$fixture/source"

docker_source_mount="$fixture/source"
if [[ -n "${DOCKER_HOST_SOURCE_ROOT:-}" || -n "${LOCAL_SOURCE_ROOT:-}" ]]; then
  : "${DOCKER_HOST_SOURCE_ROOT:?DOCKER_HOST_SOURCE_ROOT and LOCAL_SOURCE_ROOT must be set together}"
  : "${LOCAL_SOURCE_ROOT:?DOCKER_HOST_SOURCE_ROOT and LOCAL_SOURCE_ROOT must be set together}"
  local_source_root="$(realpath "$LOCAL_SOURCE_ROOT")"
  case "$docker_source_mount" in
    "$local_source_root"/*)
      docker_source_mount="${DOCKER_HOST_SOURCE_ROOT%/}/${docker_source_mount#"$local_source_root"/}"
      ;;
    *)
      printf 'Sandbox build root must be inside LOCAL_SOURCE_ROOT.\n' >&2
      exit 1
      ;;
  esac
fi

docker run --rm --network none --read-only --tmpfs /tmp:rw,size=256m \
  --cpus 1 --memory 1g \
  --cap-drop ALL --security-opt no-new-privileges \
  --volume "$docker_source_mount:/work:rw" \
  --entrypoint sh ii-tonya-test:7d71646347d560ff2b5d8ebc4c0aad5b48230254 -lc '
    set -eu
    cp -a /seed/node_modules /work/node_modules
    cp -a /seed/.pnpm-store /work/.pnpm-store
    for path in apps packages; do find "/seed/$path" -mindepth 2 -maxdepth 2 -type d -name node_modules -exec sh -c '"'"'target=/work/${1#/seed/}; mkdir -p "$(dirname "$target")"; cp -a "$1" "$target"'"'"' sh {} \;; done
    cd /work
    CI=true pnpm --offline --store-dir /work/.pnpm-store --filter @ii-tonya/sandbox-api... install --frozen-lockfile
    npm --prefix apps/sandbox-api run build:bounded
    test -f apps/sandbox-api/dist/server.js
    pnpm --offline --store-dir /work/.pnpm-store --filter @ii-tonya/sandbox-api --prod deploy /work/.sandbox-artifact
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
printf 'source_bundle_sha256=%s\n' "$(sha256sum "$SOURCE_BUNDLE" | cut -d' ' -f1)"
printf 'sandbox_artifact_sha256=%s\n' "$(sha256sum "$fixture/context/SHA256SUMS" | cut -d' ' -f1)"
printf 'sandbox_image_id=%s\n' "$(docker image inspect "$SANDBOX_IMAGE_REF" --format '{{.Id}}')"
