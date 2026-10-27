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
[[ "$release_sha" =~ ^[0-9a-f]{40}$ ]]
[[ "$deploy_root" == /opt/ii-tonya-platform ]]
[[ "$deploy_host" =~ ^[a-zA-Z0-9.-]+$ && "$deploy_user" =~ ^[a-z_][a-z0-9_-]*$ && "$deploy_port" =~ ^[0-9]+$ ]]
test -f "$ssh_key"
test -s "$known_hosts"
ssh_common=( -o BatchMode=yes -o IdentitiesOnly=yes -o StrictHostKeyChecking=yes
  -o ConnectTimeout=10 -o ServerAliveInterval=5 -o ServerAliveCountMax=3
  -o "UserKnownHostsFile=$known_hosts" -i "$ssh_key" )
ssh_options=( "${ssh_common[@]}" -p "$deploy_port" )
remote="$deploy_user@$deploy_host"

files=()
checksum_digest=none
if [[ "$action" != rollback ]]; then
  bundle="${RELEASE_BUNDLE:?RELEASE_BUNDLE is required}"
  checksum="${RELEASE_CHECKSUM:?RELEASE_CHECKSUM is required}"
  signature="${RELEASE_SIGNATURE:?RELEASE_SIGNATURE is required}"
  signing_public_key="${SIGNING_PUBLIC_KEY_FILE:?SIGNING_PUBLIC_KEY_FILE is required}"
  sbom="${RELEASE_SBOM:?RELEASE_SBOM is required}"
  provenance="${RELEASE_PROVENANCE:?RELEASE_PROVENANCE is required}"
  for file in "$bundle" "$checksum" "$signature" "$signing_public_key" "$sbom" "$provenance"; do test -f "$file"; done
  test "$(basename "$bundle")" = native-release.tar.gz
  test "$(basename "$checksum")" = native-release.sha256
  test "$(basename "$sbom")" = native-release.spdx.json
  test "$(basename "$provenance")" = native-release.provenance.json
  # Bind the remote checksum file to local signature verification over pinned SSH.
  grep -Eq '^[0-9a-f]{64}  native-release\.tar\.gz$' "$checksum"
  cosign verify-blob --key "$signing_public_key" --bundle "$signature" "$checksum" >/dev/null
  checksum_digest="$(sha256sum "$checksum" | cut -d ' ' -f1)"
  files=( "$bundle" "$checksum" "$sbom" "$provenance" )
fi

# Uploads never reuse a SHA directory. No application state is changed here.
incoming="$(ssh "${ssh_options[@]}" "$remote" bash -s -- "$deploy_root" <<'REMOTE'
set -Eeuo pipefail
test -d "$1/incoming"
umask 077
mktemp -d "$1/incoming/cutover.XXXXXXXXXXXX"
REMOTE
)"
[[ "$incoming" =~ ^/opt/ii-tonya-platform/incoming/cutover\.[a-zA-Z0-9]+$ ]]
if (( ${#files[@]} )); then
  scp -q "${ssh_common[@]}" -P "$deploy_port" "${files[@]}" "$remote:$incoming/"
fi
if [[ -n "${RELEASE_COMPATIBILITY_EVIDENCE:-}" ]]; then
  test -s "$RELEASE_COMPATIBILITY_EVIDENCE"
  scp -q "${ssh_common[@]}" -P "$deploy_port" "$RELEASE_COMPATIBILITY_EVIDENCE" "$remote:$incoming/compatibility.json"
fi

ssh "${ssh_options[@]}" "$remote" bash -s -- "$deploy_root" "$release_sha" "$incoming" "$action" "$checksum_digest" <<'REMOTE'
set -Eeuo pipefail
deploy_root="$1"
release_sha="$2"
incoming="$3"
action="$4"
checksum_digest="$5"
cd "$deploy_root"
exec 9>"$deploy_root/.deployment.lock"
flock -w 10 9 || { printf 'Another deployment holds the lock.\n' >&2; exit 1; }
[[ ! -e "$deploy_root/.deployment-in-progress" && ! -L "$deploy_root/.deployment-in-progress" ]] || {
  printf 'Unresolved deployment marker; manual recovery required.\n' >&2; exit 70;
}

fail() { printf '%s\n' "$1" >&2; return 1; }
# timeout runs unprivileged; sudo only receives existing install/systemctl/rm.
ctl() {
  local budget=10 remaining
  if [[ -n "${service_deadline:-}" ]]; then
    remaining=$(( service_deadline - SECONDS ))
    (( remaining > 0 )) || return 1
    if (( remaining < budget )); then budget="$remaining"; fi
  fi
  timeout -k 2s "${budget}s" sudo -n systemctl "$@"
}
property() { ctl show "$1" --property="$2" --value; }
stopped() {
  local state pid
  state="$(property "$1" ActiveState)" || return 1
  pid="$(property "$1" MainPID)" || return 1
  [[ "$state" == inactive || "$state" == failed ]] && [[ "$pid" == 0 ]]
}
stop_unit() {
  local deadline service_deadline=$(( SECONDS + 30 ))
  ctl stop "$1" --no-block || return 1
  deadline=$(( $(date +%s) + 30 ))
  while (( SECONDS < service_deadline )) && (( $(date +%s) < deadline )); do
    if stopped "$1"; then
      (( SECONDS < service_deadline )) || return 1
      # Bare return inside ERR recovery can reuse the pre-trap failure status.
      return 0
    fi
    sleep 1
  done
  fail "Service did not stop within deadline."
}
stop_apps() {
  local failed=0
  stop_unit ii-tonya-api.service || failed=1
  stop_unit ii-tonya-worker.service || failed=1
  return "$failed"
}
install_release_units() {
  local unit unit_release_dir="$1"
  for unit in api worker migrate; do
    timeout -k 2s 10s sudo -n install -m 0644 "$unit_release_dir/systemd/ii-tonya-$unit.service" /etc/systemd/system/ || return 1
  done
  ctl daemon-reload
}
select_release() {
  ln -sfn "$1" "$deploy_root/.current.next" || return 1
  mv -Tf "$deploy_root/.current.next" "$deploy_root/current" || return 1
  [[ "$(readlink "$deploy_root/current")" == "$1" ]]
}

worker_budget=60
health() {
  local deadline pid identity start sample current_pid current_identity
  local baseline="" baseline_pid="" baseline_identity=""
  local service_deadline=$(( SECONDS + 60 )) curl_budget remaining
  deadline=$(( $(date +%s) + 60 ))
  while :; do
    remaining=$(( service_deadline - SECONDS ))
    (( remaining > 0 )) || return 1
    curl_budget=5
    if (( remaining < curl_budget )); then curl_budget="$remaining"; fi
    if curl --max-time "$curl_budget" --connect-timeout 2 --fail --silent http://127.0.0.1:3000/health/ready >/dev/null; then break; fi
    (( $(date +%s) < deadline )) || return 1
    sleep 1
  done
  (( SECONDS < service_deadline )) || return 1
  deadline=$(( $(date +%s) + worker_budget ))
  service_deadline=$(( SECONDS + worker_budget ))
  while (( SECONDS < service_deadline )) && (( $(date +%s) < deadline )); do
    if [[ "$(property ii-tonya-api.service ActiveState)" != active || "$(property ii-tonya-worker.service ActiveState)" != active ]]; then baseline=""; sleep 1; continue; fi
    pid="$(property ii-tonya-worker.service MainPID)" || return 1
    identity="$(property ii-tonya-worker.service ExecMainStartTimestampMonotonic)" || return 1
    [[ "$pid" =~ ^[1-9][0-9]*$ && "$identity" =~ ^[1-9][0-9]*$ ]] || return 1
    start="$(property ii-tonya-worker.service ExecMainStartTimestamp)" || return 1
    start="$(date -d "$start" +%s)" || return 1
    sample="$(stat -c %Y "/proc/$pid/root/tmp/ii-tonya-worker-heartbeat" 2>/dev/null)" || { baseline=""; sleep 1; continue; }
    current_pid="$(property ii-tonya-worker.service MainPID)" || return 1
    current_identity="$(property ii-tonya-worker.service ExecMainStartTimestampMonotonic)" || return 1
    if [[ "$pid" == "$current_pid" && "$identity" == "$current_identity" && "$sample" =~ ^[0-9]+$ ]] && (( sample > start )); then
      if [[ -n "$baseline" && "$baseline_pid" == "$pid" && "$baseline_identity" == "$identity" ]] && (( sample > baseline )); then
        [[ "$(property ii-tonya-api.service ActiveState)" == active && "$(property ii-tonya-worker.service ActiveState)" == active ]] || return 1
        (( SECONDS < service_deadline )) || return 1
        return 0
      fi
      # Retain a valid baseline across poll iterations, including updates that
      # occur between iterations. Never carry it across a changed process.
      if [[ -z "$baseline" || "$baseline_pid" != "$pid" || "$baseline_identity" != "$identity" ]] || (( sample < baseline )); then
        baseline="$sample"
        baseline_pid="$pid"
        baseline_identity="$identity"
      fi
    else
      baseline=""
    fi
    sleep 1
  done
  fail "Worker readiness deadline expired."
}
start_apps() {
  local failed=0
  ctl start ii-tonya-api.service --no-block || failed=1
  ctl start ii-tonya-worker.service --no-block || failed=1
  (( failed == 0 )) || return 1
  health
}
phase() {
  printf 'previous=%s\ncandidate=%s\nphase=%s\n' "$previous" "$target" "$1" > "$deploy_root/.deployment-in-progress"
}

previous=""
if [[ -L "$deploy_root/current" ]]; then
  previous="$(readlink "$deploy_root/current")"
  [[ "$previous" =~ ^releases/[0-9a-f]{40}$ ]]
  test -d "$deploy_root/$previous"
  test "$(cat "$deploy_root/$previous/SOURCE_SHA")" = "${previous#releases/}"
  for unit in api worker migrate; do test -f "$deploy_root/$previous/systemd/ii-tonya-$unit.service"; done
else
  test ! -e "$deploy_root/current"
fi
quiescence_started=false
unit_install_started=false
migration_started=false
migration_completed=false
target="releases/$release_sha"
release_dir="$deploy_root/$target"

cleanup_first_install() {
  local failed=0 unit
  for unit in api worker; do
    ctl disable "ii-tonya-$unit.service" || failed=1
  done
  if [[ "$unit_install_started" == true ]]; then
    for unit in api worker migrate; do
      timeout -k 2s 10s sudo -n rm -f "/etc/systemd/system/ii-tonya-$unit.service" || failed=1
    done
    ctl daemon-reload || failed=1
  fi
  if [[ -L "$deploy_root/current" && "$(readlink "$deploy_root/current")" == "$target" ]]; then
    rm -f "$deploy_root/current" || failed=1
  fi
  test ! -e "$deploy_root/current" && test ! -L "$deploy_root/current" || failed=1
  stopped ii-tonya-api.service || failed=1
  stopped ii-tonya-worker.service || failed=1
  printf 'Recovery has no previous release.\n' >&2
  return "$failed"
}

recover() {
  # Bash locals are dynamically scoped: ERR can enter here from an expired
  # health() deadline. Recovery commands get their own per-command bounds;
  # stop_unit() and health() establish fresh local polling deadlines.
  local original_status="$1" failed=0 service_deadline=""
  # Inherited ERR traps in substitutions must only propagate failure, never run
  # recovery concurrently with the parent shell that owns the transaction.
  if (( BASH_SUBSHELL > 0 )); then exit "$original_status"; fi
  trap - ERR HUP TERM INT
  set +e
  printf 'Cutover failed; preserving release and incoming artifacts.\n' >&2
  if [[ "$quiescence_started" != true ]]; then exit "$original_status"; fi
  if [[ "$migration_started" == true && "$migration_completed" != true ]]; then
    stop_unit ii-tonya-migrate.service || { failed=1; printf 'Migrator termination could not be verified.\n' >&2; }
    stop_apps || { failed=1; printf 'Application stop could not be verified.\n' >&2; }
    # Termination permits first-install executable cleanup, not a claim that SQL
    # rolled back. Unknown commit/backend state always retains the marker.
    if (( failed == 0 )) && [[ -z "$previous" ]]; then
      cleanup_first_install || { failed=1; printf 'First-install recovery failed.\n' >&2; }
    fi
    printf 'Database backend termination/commit state unknown; manual recovery required.\n' >&2
    exit 70
  fi
  stop_apps || failed=1
  # A failed stop makes changing executable paths unsafe.
  if (( failed == 0 )); then
    if [[ -n "$previous" ]]; then
      if [[ "$unit_install_started" == true ]]; then install_release_units "$deploy_root/$previous" || failed=1; fi
      select_release "$previous" || failed=1
      if (( failed == 0 )); then start_apps || failed=1; fi
    else
      cleanup_first_install || failed=1
    fi
  fi
  if (( failed )); then
    printf 'Application recovery failed; manual recovery required.\n' >&2
    exit 70
  fi
  rm -f "$deploy_root/.deployment-in-progress" || exit 70
  printf 'Application recovery verified; database migrations were not rolled back.\n' >&2
  exit "$original_status"
}
trap 'recover "$?"' ERR
trap 'recover 129' HUP
trap 'recover 143' TERM
trap 'recover 130' INT

if [[ "$action" == rollback ]]; then
  test -n "$previous"
  target="$(cat "$deploy_root/.previous-release")"
  [[ "$target" =~ ^releases/[0-9a-f]{40}$ && "$target" != "$previous" ]]
  # RELEASE_SHA binds the currently selected candidate whose schema remains.
  test "${previous#releases/}" = "$release_sha"
  release_dir="$deploy_root/$target"
  test "$(cat "$release_dir/SOURCE_SHA")" = "${target#releases/}"
  schema_dir="$deploy_root/$previous/migrations"
  compatibility_old="${target#releases/}"
else
  cd "$incoming"
  test "$(sha256sum native-release.sha256 | cut -d ' ' -f1)" = "$checksum_digest"
  awk 'NF != 2 || $1 !~ /^[0-9a-f]+$/ || length($1) != 64 || $2 !~ /^native-release\.(tar\.gz|spdx\.json|provenance\.json)$/ {exit 1}' native-release.sha256
  sha256sum -c native-release.sha256
  test ! -e "$release_dir"
  install -d -m 0750 "$incoming/candidate"
  tar -xzf native-release.tar.gz -C "$incoming/candidate" --no-same-owner --no-same-permissions
  release_dir="$incoming/candidate"
  test "$(cat "$release_dir/SOURCE_SHA")" = "$release_sha"
  schema_dir="$release_dir/migrations"
  compatibility_old="${previous#releases/}"
fi
bash "$release_dir/scripts/validate-runtime-env.sh" /etc/ii-tonya/runtime.env "$release_sha"
for unit in api worker migrate; do test -f "$release_dir/systemd/ii-tonya-$unit.service"; done
if [[ "$action" != rollback ]]; then
  grep -Fx 'TimeoutStartSec=180s' "$release_dir/systemd/ii-tonya-migrate.service" >/dev/null
  grep -Fx 'TimeoutStopSec=15s' "$release_dir/systemd/ii-tonya-migrate.service" >/dev/null
  # Use the candidate's actual configuration guard before downtime. Parse only
  # the needed canonical assignments; never execute runtime.env as shell code.
  timeout -k 2s 15s node --input-type=module - "$release_dir/api/migrate-native.mjs" /etc/ii-tonya/runtime.env <<'CONFIG'
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
try {
  const env = {};
  for (const line of readFileSync(process.argv[3], 'utf8').split('\n')) {
    const match = /^(DATABASE_URL|PGOPTIONS)=(.*)$/.exec(line);
    if (match) { if (Object.hasOwn(env, match[1])) throw new Error(); env[match[1]] = match[2]; }
  }
  const result = spawnSync(process.execPath, [process.argv[2], '--validate-config'], { env, stdio: 'ignore', timeout: 10000 });
  if (result.status !== 0) throw new Error();
} catch { console.error('Native migration configuration preflight failed.'); process.exit(1); }
CONFIG
fi
# Do not source a shell environment file. Accept only the worker's validated range.
poll_interval="$(sed -n 's/^WORKER_POLL_INTERVAL_MS=//p' /etc/ii-tonya/runtime.env)"
poll_interval="${poll_interval:-1000}"
[[ "$poll_interval" =~ ^[0-9]{1,5}$ ]]
poll_interval=$((10#$poll_interval))
(( poll_interval >= 1 && poll_interval <= 60000 ))
worker_budget=$(( (2 * poll_interval + 999) / 1000 + 10 ))
(( worker_budget <= 300 ))
if (( worker_budget < 60 )); then worker_budget=60; fi

if [[ -n "$previous" ]]; then
  manifest_digest="$(cd "$schema_dir" && find . -type f -print0 | LC_ALL=C sort -z | xargs -0 sha256sum | sha256sum | cut -d ' ' -f1)"
  # Evidence is supplied by the release reviewer, never generated by this script.
  timeout -k 2s 10s node --input-type=module - "$incoming/compatibility.json" "$compatibility_old" "$release_sha" "$manifest_digest" <<'EVIDENCE'
import { readFileSync } from 'node:fs';
try {
  const [path, old, candidate, manifest] = process.argv.slice(2);
  const evidence = JSON.parse(readFileSync(path, 'utf8'));
  const check = value => value?.result === 'pass' && /^[0-9a-f]{64}$/.test(value.evidence_sha256);
  if (evidence.format !== 'ii-tonya-schema-compatibility-v1' || evidence.previous_sha !== old ||
    evidence.candidate_sha !== candidate || evidence.migration_manifest_sha256 !== manifest ||
    !check(evidence.old_schema) || !check(evidence.candidate_schema)) throw new Error();
} catch { console.error('Missing or mismatched schema compatibility evidence.'); process.exit(1); }
EVIDENCE
  health
else
  for unit in api worker; do
    stopped "ii-tonya-$unit.service"
    test "$(property "ii-tonya-$unit.service" LoadState)" = not-found
  done
fi
stopped ii-tonya-migrate.service
if [[ "$action" == validate ]]; then
  printf 'Target and candidate preflight verified; no cutover performed.\n'
  exit 0
fi

phase prepared
quiescence_started=true
phase quiescing
stop_apps
if [[ "$action" != rollback ]]; then
  mv -T "$release_dir" "$deploy_root/$target"
  release_dir="$deploy_root/$target"
fi
phase installing
unit_install_started=true
install_release_units "$release_dir"
phase selecting
select_release "$target"
if [[ "$action" != rollback ]]; then
  phase migrating
  migration_started=true
  timeout -k 5s 205s sudo -n systemctl start ii-tonya-migrate.service
  stopped ii-tonya-migrate.service
  test "$(property ii-tonya-migrate.service Result)" = success
  migration_completed=true
fi
phase starting
start_apps
phase verified
if [[ -n "$previous" ]]; then
  printf '%s\n' "$previous" > "$deploy_root/.previous-release.next"
  mv -T "$deploy_root/.previous-release.next" "$deploy_root/.previous-release"
fi
rm -f "$deploy_root/.deployment-in-progress"
trap - ERR HUP TERM INT
# Only a verified success may clean this invocation's uniquely allocated upload.
find "$incoming" -mindepth 1 -delete
rmdir "$incoming"
printf 'Application verified; database migrations were not rolled back.\n'
REMOTE
