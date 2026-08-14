#!/usr/bin/env bash
set -Eeuo pipefail

action="${1:-}"
case "$action" in
  validate | deploy | rollback) ;;
  *) printf 'usage: %s <validate|deploy|rollback>\n' "$0" >&2; exit 2 ;;
esac

deploy_host="${DEPLOY_HOST:?DEPLOY_HOST is required}"
deploy_user="${DEPLOY_USER:-ii_tonya}"
deploy_port="${DEPLOY_PORT:-22}"
deploy_root="${DEPLOY_ROOT:-/opt/ii-tonya-platform}"
ssh_key="${SSH_KEY_FILE:?SSH_KEY_FILE is required}"
known_hosts="${KNOWN_HOSTS_FILE:?KNOWN_HOSTS_FILE is required}"
release_sha="${RELEASE_SHA:?RELEASE_SHA is required}"
[[ "$release_sha" =~ ^[0-9a-f]{40}$ ]] || {
  printf 'RELEASE_SHA must be a full lowercase Git SHA.\n' >&2
  exit 2
}
test -f "$ssh_key"
test -s "$known_hosts"
[[ "$deploy_root" == /opt/ii-tonya-platform ]] || {
  printf 'Unexpected production deployment root.\n' >&2
  exit 2
}

ssh_options=(
  -o BatchMode=yes
  -o IdentitiesOnly=yes
  -o StrictHostKeyChecking=yes
  -o "UserKnownHostsFile=$known_hosts"
  -i "$ssh_key"
  -p "$deploy_port"
)
remote="$deploy_user@$deploy_host"

if [[ "$action" == validate ]]; then
  exit 0
fi

if [[ "$action" == rollback ]]; then
  ssh "${ssh_options[@]}" "$remote" bash -s -- "$deploy_root" <<'REMOTE'
set -Eeuo pipefail
deploy_root="$1"
cd "$deploy_root"
previous="$(cat .previous-release)"
[[ "$previous" =~ ^releases/[0-9a-f]{40}$ ]]
test -d "$previous"
install_release_units() {
  release_dir="$1"
  test -f "$release_dir/systemd/ii-tonya-api.service"
  test -f "$release_dir/systemd/ii-tonya-worker.service"
  test -f "$release_dir/systemd/ii-tonya-migrate.service"
  sudo install -m 0644 "$release_dir/systemd/ii-tonya-api.service" /etc/systemd/system/
  sudo install -m 0644 "$release_dir/systemd/ii-tonya-worker.service" /etc/systemd/system/
  sudo install -m 0644 "$release_dir/systemd/ii-tonya-migrate.service" /etc/systemd/system/
  sudo systemctl daemon-reload
}
install_release_units "$deploy_root/$previous"
ln -sfn "$previous" .current.next
mv -Tf .current.next current
sudo systemctl restart ii-tonya-api.service
sudo systemctl restart ii-tonya-worker.service
curl --fail --silent --show-error http://127.0.0.1:3000/health/ready >/dev/null
REMOTE
  exit 0
fi

bundle="${RELEASE_BUNDLE:?RELEASE_BUNDLE is required}"
checksum="${RELEASE_CHECKSUM:?RELEASE_CHECKSUM is required}"
signature="${RELEASE_SIGNATURE:?RELEASE_SIGNATURE is required}"
signing_public_key="${SIGNING_PUBLIC_KEY_FILE:?SIGNING_PUBLIC_KEY_FILE is required}"
sbom="${RELEASE_SBOM:?RELEASE_SBOM is required}"
provenance="${RELEASE_PROVENANCE:?RELEASE_PROVENANCE is required}"
test -f "$bundle"
test -f "$checksum"
test -f "$signature"
test -f "$signing_public_key"
test -f "$sbom"
test -f "$provenance"
test "$(basename "$bundle")" = native-release.tar.gz
test "$(basename "$checksum")" = native-release.sha256
test "$(basename "$sbom")" = native-release.spdx.json
test "$(basename "$provenance")" = native-release.provenance.json
grep -Eq '^[0-9a-f]{64}  native-release\.tar\.gz$' "$checksum"
cosign verify-blob --key "$signing_public_key" --signature "$signature" "$checksum" >/dev/null

incoming="ii-tonya-$release_sha"
ssh "${ssh_options[@]}" "$remote" bash -s -- "$deploy_root/incoming/$incoming" <<'REMOTE'
set -Eeuo pipefail
install -d -m 0700 -- "$1"
REMOTE
scp -q -P "$deploy_port" -i "$ssh_key" \
  -o BatchMode=yes -o IdentitiesOnly=yes -o StrictHostKeyChecking=yes \
  -o "UserKnownHostsFile=$known_hosts" \
  "$bundle" "$checksum" "$signature" "$sbom" "$provenance" \
  "$remote:$deploy_root/incoming/$incoming/"

ssh "${ssh_options[@]}" "$remote" bash -s -- "$deploy_root" "$release_sha" <<'REMOTE'
set -Eeuo pipefail
deploy_root="$1"
release_sha="$2"
incoming="$deploy_root/incoming/ii-tonya-$release_sha"
RELEASE_SHA="$release_sha"
release_dir="$deploy_root/releases/$RELEASE_SHA"
previous=""
install_release_units() {
  unit_release_dir="$1"
  test -f "$unit_release_dir/systemd/ii-tonya-api.service"
  test -f "$unit_release_dir/systemd/ii-tonya-worker.service"
  test -f "$unit_release_dir/systemd/ii-tonya-migrate.service"
  sudo install -m 0644 "$unit_release_dir/systemd/ii-tonya-api.service" /etc/systemd/system/
  sudo install -m 0644 "$unit_release_dir/systemd/ii-tonya-worker.service" /etc/systemd/system/
  sudo install -m 0644 "$unit_release_dir/systemd/ii-tonya-migrate.service" /etc/systemd/system/
  sudo systemctl daemon-reload
}
if [[ -L "$deploy_root/current" ]]; then
  previous="$(readlink "$deploy_root/current")"
  [[ "$previous" =~ ^releases/[0-9a-f]{40}$ ]]
fi

release_created="false"
unit_install_started="false"
symlink_switched="false"
rollback_on_error() {
  original_status="$?"
  trap - ERR
  if [[ -n "$previous" ]]; then
    if [[ "$unit_install_started" == "true" ]]; then
      install_release_units "$deploy_root/$previous" || true
    fi
    if [[ "$symlink_switched" == "true" ]]; then
      ln -sfn "$previous" "$deploy_root/.current.next" || true
      mv -Tf "$deploy_root/.current.next" "$deploy_root/current" || true
    fi
    if [[ "$unit_install_started" == "true" || "$symlink_switched" == "true" ]]; then
      sudo systemctl restart ii-tonya-api.service || true
      sudo systemctl restart ii-tonya-worker.service || true
    fi
  fi
  if [[ "$release_created" == "true" && -d "$release_dir" ]]; then
    find "$release_dir" -mindepth 1 -delete || true
    rmdir "$release_dir" || true
  fi
  if [[ -d "$incoming" ]]; then
    find "$incoming" -mindepth 1 -delete || true
    rmdir "$incoming" || true
  fi
  exit "$original_status"
}
trap rollback_on_error ERR

cd "$incoming"
sha256sum -c native-release.sha256
test ! -e "$release_dir"
install -d -m 0750 "$release_dir"
release_created="true"
tar -xzf native-release.tar.gz -C "$release_dir" --no-same-owner --no-same-permissions
test "$(cat "$release_dir/SOURCE_SHA")" = "$release_sha"
bash "$release_dir/scripts/validate-runtime-env.sh" /etc/ii-tonya/runtime.env "$release_sha"
unit_install_started="true"
install_release_units "$release_dir"

if [[ -n "$previous" ]]; then
  printf '%s\n' "$previous" > "$deploy_root/.previous-release"
fi
ln -sfn "releases/$release_sha" "$deploy_root/.current.next"
mv -Tf "$deploy_root/.current.next" "$deploy_root/current"
symlink_switched="true"

sudo systemctl start ii-tonya-migrate.service
sudo systemctl restart ii-tonya-api.service
sudo systemctl restart ii-tonya-worker.service
curl --retry 20 --retry-delay 2 --fail --silent --show-error \
  http://127.0.0.1:3000/health/ready >/dev/null
sudo systemctl is-active --quiet ii-tonya-api.service
sudo systemctl is-active --quiet ii-tonya-worker.service
find "$incoming" -mindepth 1 -delete
rmdir "$incoming"
trap - ERR
REMOTE
