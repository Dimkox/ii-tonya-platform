#!/usr/bin/env bash
set -euo pipefail

command_name="${1:-}"

fail() {
  printf 'deployment error: %s\n' "$1" >&2
  exit 2
}

require_value() {
  local name="$1"
  [[ -n "${!name:-}" ]] || fail "$name is required"
}

for name in DEPLOY_HOST DEPLOY_USER DEPLOY_PORT DEPLOY_PATH RUNTIME_ENV_FILE \
  SSH_KEY_FILE KNOWN_HOSTS_FILE DEPLOY_ENVIRONMENT API_IMAGE_REF \
  WORKER_IMAGE_REF RELEASE_SHA; do
  require_value "$name"
done

[[ "$command_name" =~ ^(validate|capture-current|preflight|migration|migration-recover|deploy|reconcile|rollback|rollback-complete)$ ]] || \
  fail "unsupported deployment command"
[[ "$DEPLOY_HOST" =~ ^[A-Za-z0-9.-]+$ ]] || fail "DEPLOY_HOST is invalid"
[[ "$DEPLOY_USER" =~ ^[A-Za-z_][A-Za-z0-9_-]*$ ]] || fail "DEPLOY_USER is invalid"
[[ "$DEPLOY_PORT" =~ ^[1-9][0-9]{0,4}$ ]] || fail "DEPLOY_PORT is invalid"
(( DEPLOY_PORT <= 65535 )) || fail "DEPLOY_PORT is out of range"
[[ "$DEPLOY_ENVIRONMENT" =~ ^(staging|production)$ ]] || \
  fail "DEPLOY_ENVIRONMENT must be staging or production"
[[ "$DEPLOY_PATH" == "/opt/ii-tonya-$DEPLOY_ENVIRONMENT" || \
  "$DEPLOY_PATH" == "/srv/ii-tonya-$DEPLOY_ENVIRONMENT" ]] || \
  fail "DEPLOY_PATH must match DEPLOY_ENVIRONMENT"
[[ "$RUNTIME_ENV_FILE" == "/etc/ii-tonya/$DEPLOY_ENVIRONMENT.env" ]] || \
  fail "RUNTIME_ENV_FILE must match the dedicated environment path"
[[ "$RELEASE_SHA" =~ ^[0-9a-f]{40}$ ]] || fail "RELEASE_SHA must be a full commit SHA"
[[ "$API_IMAGE_REF" =~ ^ghcr\.io/[a-z0-9._/-]+@sha256:[0-9a-f]{64}$ ]] || \
  fail "API_IMAGE_REF must be an immutable GHCR digest"
[[ "$WORKER_IMAGE_REF" =~ ^ghcr\.io/[a-z0-9._/-]+@sha256:[0-9a-f]{64}$ ]] || \
  fail "WORKER_IMAGE_REF must be an immutable GHCR digest"
API_BIND_PORT="${API_BIND_PORT:-3000}"
[[ "$API_BIND_PORT" =~ ^[1-9][0-9]{0,4}$ ]] || fail "API_BIND_PORT is invalid"
(( API_BIND_PORT <= 65535 )) || fail "API_BIND_PORT is out of range"
[[ -s "$SSH_KEY_FILE" ]] || fail "SSH_KEY_FILE is missing or empty"
[[ -s "$KNOWN_HOSTS_FILE" ]] || fail "KNOWN_HOSTS_FILE is missing or empty"

repository_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
compose_source="$repository_root/deploy/compose.remote.yml"
validator_source="$repository_root/scripts/validate-runtime-env.sh"
[[ -f "$compose_source" ]] || fail "remote Compose manifest is missing"
[[ -f "$validator_source" ]] || fail "runtime validator is missing"

if [[ "$command_name" == validate ]]; then
  exit 0
fi

ssh_options=(
  -i "$SSH_KEY_FILE"
  -p "$DEPLOY_PORT"
  -o BatchMode=yes
  -o IdentitiesOnly=yes
  -o StrictHostKeyChecking=yes
  -o "UserKnownHostsFile=$KNOWN_HOSTS_FILE"
  -o ConnectTimeout=15
)
scp_options=(
  -i "$SSH_KEY_FILE"
  -P "$DEPLOY_PORT"
  -o BatchMode=yes
  -o IdentitiesOnly=yes
  -o StrictHostKeyChecking=yes
  -o "UserKnownHostsFile=$KNOWN_HOSTS_FILE"
  -o ConnectTimeout=15
)
remote="$DEPLOY_USER@$DEPLOY_HOST"
release_dir="$DEPLOY_PATH/releases/$RELEASE_SHA"

run_remote() {
  ssh "${ssh_options[@]}" "$remote" bash -s -- "$@"
}

prepare_release() {
  local release_env
  release_env="$(mktemp)"
  trap 'rm -f "${release_env:-}"' EXIT
  umask 077
  printf '%s\n' \
    "DEPLOY_ENVIRONMENT=$DEPLOY_ENVIRONMENT" \
    "API_IMAGE_REF=$API_IMAGE_REF" \
    "WORKER_IMAGE_REF=$WORKER_IMAGE_REF" \
    "RUNTIME_ENV_FILE=$RUNTIME_ENV_FILE" \
    "API_BIND_ADDRESS=127.0.0.1" \
    "API_BIND_PORT=$API_BIND_PORT" > "$release_env"

  run_remote "$DEPLOY_PATH" "$RELEASE_SHA" "$DEPLOY_USER" <<'REMOTE'
set -euo pipefail
deploy_path="$1"
release_id="$2"
expected_user="$3"
assert_safe_dir() {
  local path="$1" mode
  test -d "$path"
  test ! -L "$path"
  test "$(stat -c '%U' "$path")" = "$expected_user"
  mode="$(stat -c '%a' "$path")"
  (( (8#$mode & 0022) == 0 ))
}
if test -e "$deploy_path"; then
  test ! -L "$deploy_path"
fi
umask 077
mkdir -p "$deploy_path"
test "$(readlink -f "$deploy_path")" = "$deploy_path"
assert_safe_dir "$deploy_path"
mkdir -p "$deploy_path/releases"
assert_safe_dir "$deploy_path/releases"
release_dir="$deploy_path/releases/$release_id"
test ! -e "$release_dir"
mkdir -m 700 "$release_dir"
assert_safe_dir "$release_dir"
REMOTE
  scp "${scp_options[@]}" "$compose_source" "$remote:$release_dir/compose.yml"
  scp "${scp_options[@]}" "$release_env" "$remote:$release_dir/deployment.env"
  scp "${scp_options[@]}" "$validator_source" "$remote:$release_dir/validate-runtime-env.sh"
  run_remote "$release_dir" "$DEPLOY_USER" <<'REMOTE'
set -euo pipefail
release_dir="$1"
expected_user="$2"
for file in compose.yml deployment.env validate-runtime-env.sh; do
  path="$release_dir/$file"
  test -f "$path"
  test ! -L "$path"
  test "$(stat -c '%U' "$path")" = "$expected_user"
done
chmod 600 "$release_dir/compose.yml" "$release_dir/deployment.env"
chmod 700 "$release_dir/validate-runtime-env.sh"
REMOTE
  rm -f "$release_env"
  trap - EXIT
}

case "$command_name" in
  capture-current)
    captured="$(run_remote "$DEPLOY_PATH" "$DEPLOY_ENVIRONMENT" <<'REMOTE'
set -euo pipefail
deploy_path="$1"
environment="$2"
project="ii-tonya-$environment"
test ! -e "$deploy_path/.rollback-in-progress"
if ! test -L "$deploy_path/current"; then
  printf 'none||\n'
  exit 0
fi
target="$(readlink "$deploy_path/current")"
[[ "$target" =~ ^releases/[0-9a-f]{40}$ ]]
api_id="$(docker ps -q --filter "label=com.docker.compose.project=$project" --filter 'label=com.docker.compose.service=api')"
worker_id="$(docker ps -q --filter "label=com.docker.compose.project=$project" --filter 'label=com.docker.compose.service=worker')"
test -n "$api_id"
test -n "$worker_id"
api_ref="$(docker inspect -f '{{.Config.Image}}' "$api_id")"
worker_ref="$(docker inspect -f '{{.Config.Image}}' "$worker_id")"
target_sha="${target#releases/}"
test "$(docker inspect -f '{{index .Config.Labels \"org.opencontainers.image.revision\"}}' "$api_id")" = "$target_sha"
test "$(docker inspect -f '{{index .Config.Labels \"org.opencontainers.image.revision\"}}' "$worker_id")" = "$target_sha"
printf '%s|%s|%s\n' "$target" "$api_ref" "$worker_ref"
REMOTE
)"
    IFS='|' read -r rollback_target rollback_api rollback_worker rollback_extra <<< "$captured"
    [[ -z "${rollback_extra:-}" ]] || fail "current release capture is malformed"
    if [[ "$rollback_target" == none ]]; then
      [[ -z "$rollback_api" && -z "$rollback_worker" ]] || fail "first-release capture is malformed"
    else
      [[ "$rollback_target" =~ ^releases/[0-9a-f]{40}$ ]] || fail "rollback target is invalid"
      [[ "$rollback_api" =~ ^ghcr\.io/[a-z0-9._/-]+@sha256:[0-9a-f]{64}$ ]] || fail "rollback API ref is invalid"
      [[ "$rollback_worker" =~ ^ghcr\.io/[a-z0-9._/-]+@sha256:[0-9a-f]{64}$ ]] || fail "rollback worker ref is invalid"
    fi
    printf 'ROLLBACK_TARGET=%s\nROLLBACK_API_IMAGE_REF=%s\nROLLBACK_WORKER_IMAGE_REF=%s\n' \
      "$rollback_target" "$rollback_api" "$rollback_worker"
    ;;
  preflight)
    prepare_release
    run_remote "$DEPLOY_PATH" "$RELEASE_SHA" "$RUNTIME_ENV_FILE" "$DEPLOY_ENVIRONMENT" <<'REMOTE'
set -eu
deploy_path="$1"
release_id="$2"
runtime_env="$3"
environment="$4"
release_dir="$deploy_path/releases/$release_id"
project="ii-tonya-$environment"

command -v docker >/dev/null
docker compose version >/dev/null
test -f "$runtime_env"
test ! -L "$runtime_env"
test "$(stat -c '%U' "$runtime_env")" = root
test "$(stat -c '%G' "$runtime_env")" = ii-tonya
mode="$(stat -c '%a' "$runtime_env")"
case "$mode" in 440|640) ;; *) echo "runtime env permissions must be 440 or 640" >&2; exit 2 ;; esac
runtime_parent="$(dirname "$runtime_env")"
test ! -L "$runtime_parent"
test "$(stat -c '%U:%G:%a' "$runtime_parent")" = root:ii-tonya:750
"$release_dir/validate-runtime-env.sh" "$runtime_env" "$release_id"
docker compose --project-name "$project" --env-file "$release_dir/deployment.env" \
  -f "$release_dir/compose.yml" config --quiet
docker compose --project-name "$project" --env-file "$release_dir/deployment.env" \
  -f "$release_dir/compose.yml" pull
cd "$release_dir"
sha256sum compose.yml deployment.env validate-runtime-env.sh > .preflight-manifest.sha256
printf '%s\n' "$release_id" > .preflight-passed
REMOTE
    ;;
  migration)
    run_remote "$DEPLOY_PATH" "$RELEASE_SHA" "$DEPLOY_ENVIRONMENT" <<'REMOTE'
set -eu
deploy_path="$1"
release_id="$2"
environment="$3"
release_dir="$deploy_path/releases/$release_id"
project="ii-tonya-$environment"
test "$(cat "$release_dir/.preflight-passed")" = "$release_id"
(cd "$release_dir" && sha256sum -c .preflight-manifest.sha256)

restart_previous_worker=false
if test -L "$deploy_path/current"; then
  current_target="$(readlink "$deploy_path/current")"
  [[ "$current_target" =~ ^releases/[0-9a-f]{40}$ ]]
  current_dir="$deploy_path/$current_target"
  if docker compose --project-name "$project" --env-file "$current_dir/deployment.env" \
    -f "$current_dir/compose.yml" ps --status running --services | grep -Fx worker >/dev/null; then
    docker compose --project-name "$project" --env-file "$current_dir/deployment.env" \
      -f "$current_dir/compose.yml" stop --timeout 30 worker
    restart_previous_worker=true
  fi
fi

if ! docker compose --project-name "$project" --env-file "$release_dir/deployment.env" \
  -f "$release_dir/compose.yml" run --rm migrate; then
  if test "$restart_previous_worker" = true; then
    docker compose --project-name "$project" --env-file "$current_dir/deployment.env" \
      -f "$current_dir/compose.yml" up -d --wait --wait-timeout 120 worker
  fi
  exit 1
fi
if test "$restart_previous_worker" = true; then
  docker compose --project-name "$project" --env-file "$current_dir/deployment.env" \
    -f "$current_dir/compose.yml" up -d --wait --wait-timeout 120 worker
fi
printf '%s\n' "$release_id" > "$release_dir/.migration-passed"
REMOTE
    ;;
  migration-recover)
    require_value ROLLBACK_TARGET
    if [[ "$ROLLBACK_TARGET" == none ]]; then
      printf 'migration recovery PASS no-current-release environment=%s\n' "$DEPLOY_ENVIRONMENT"
      exit 0
    fi
    require_value ROLLBACK_WORKER_IMAGE_REF
    [[ "$ROLLBACK_TARGET" =~ ^releases/[0-9a-f]{40}$ ]] || fail "ROLLBACK_TARGET is invalid"
    [[ "$ROLLBACK_WORKER_IMAGE_REF" =~ ^ghcr\.io/[a-z0-9._/-]+@sha256:[0-9a-f]{64}$ ]] || fail "ROLLBACK_WORKER_IMAGE_REF is invalid"
    run_remote "$DEPLOY_PATH" "$DEPLOY_ENVIRONMENT" "$ROLLBACK_TARGET" "$ROLLBACK_WORKER_IMAGE_REF" <<'REMOTE'
set -euo pipefail
deploy_path="$1"
environment="$2"
expected_target="$3"
expected_worker_ref="$4"
project="ii-tonya-$environment"
test -L "$deploy_path/current"
current_target="$(readlink "$deploy_path/current")"
test "$current_target" = "$expected_target"
worker_id="$(docker ps -aq --filter "label=com.docker.compose.project=$project" --filter 'label=com.docker.compose.service=worker')"
test -n "$worker_id"
test "$(docker inspect -f '{{.Config.Image}}' "$worker_id")" = "$expected_worker_ref"
docker start "$worker_id" >/dev/null
for _ in $(seq 1 24); do
  test "$(docker inspect -f '{{.State.Health.Status}}' "$worker_id")" = healthy && break
  sleep 5
done
test "$(docker inspect -f '{{.State.Health.Status}}' "$worker_id")" = healthy
printf 'migration recovery PASS release=%s environment=%s\n' "$current_target" "$environment"
REMOTE
    ;;
  deploy)
    run_remote "$DEPLOY_PATH" "$RELEASE_SHA" "$DEPLOY_ENVIRONMENT" <<'REMOTE'
set -eu
deploy_path="$1"
release_id="$2"
environment="$3"
release_dir="$deploy_path/releases/$release_id"
project="ii-tonya-$environment"
test "$(cat "$release_dir/.preflight-passed")" = "$release_id"
test "$(cat "$release_dir/.migration-passed")" = "$release_id"
(cd "$release_dir" && sha256sum -c .preflight-manifest.sha256)
printf '%s\n' "$release_id" > "$release_dir/.switch-started"
if test -L "$deploy_path/current"; then
  current_target="$(readlink "$deploy_path/current")"
  [[ "$current_target" =~ ^releases/[0-9a-f]{40}$ ]]
  if test "$current_target" != "releases/$release_id"; then
    test -f "$deploy_path/$current_target/.deployed"
    ln -sfn "$current_target" "$deploy_path/previous.next"
    mv -Tf "$deploy_path/previous.next" "$deploy_path/previous"
  fi
fi
ln -sfn "releases/$release_id" "$deploy_path/current.next"
mv -Tf "$deploy_path/current.next" "$deploy_path/current"
docker compose --project-name "$project" --env-file "$deploy_path/current/deployment.env" \
  -f "$deploy_path/current/compose.yml" up -d --remove-orphans --wait --wait-timeout 120 api worker
docker compose --project-name "$project" --env-file "$deploy_path/current/deployment.env" \
  -f "$deploy_path/current/compose.yml" ps
printf '%s\n' "$release_id" > "$release_dir/.deployed"
REMOTE
    ;;
  reconcile)
    run_remote "$DEPLOY_PATH" "$RELEASE_SHA" "$DEPLOY_ENVIRONMENT" <<'REMOTE'
set -eu
deploy_path="$1"
release_id="$2"
environment="$3"
project="ii-tonya-$environment"
current_target="$(readlink "$deploy_path/current")"
test "$current_target" = "releases/$release_id"
[[ "$current_target" =~ ^releases/[0-9a-f]{40}$ ]]
current_dir="$deploy_path/$current_target"
(cd "$current_dir" && sha256sum -c .preflight-manifest.sha256)
set -a
. "$current_dir/deployment.env"
set +a
compose() {
  docker compose --project-name "$project" --env-file "$current_dir/deployment.env" \
    -f "$current_dir/compose.yml" "$@"
}
test "$(compose ps --status running --services | sort | tr '\n' ' ')" = "api worker "
api_id="$(compose ps -q api)"
worker_id="$(compose ps -q worker)"
test -n "$api_id"
test -n "$worker_id"
test "$(docker inspect -f '{{.State.Health.Status}}' "$api_id")" = healthy
test "$(docker inspect -f '{{.State.Health.Status}}' "$worker_id")" = healthy
test "$(docker inspect -f '{{.Config.Image}}' "$api_id")" = "$API_IMAGE_REF"
test "$(docker inspect -f '{{.Config.Image}}' "$worker_id")" = "$WORKER_IMAGE_REF"
compose exec -T api node --input-type=module --eval \
  "const r=await fetch('http://127.0.0.1:3000/health/ready');if(!r.ok)process.exit(1);const b=await r.json();if(b.status!=='ready')process.exit(1)"
compose exec -T api node --input-type=module --eval \
  "import {closeDb,createDb} from '@ii-tonya/db';import {sql} from 'drizzle-orm';const db=createDb(process.env.DATABASE_URL);try{const r=await db.execute(sql.raw(\"select (select count(*) from integration_outbox where status in ('unknown_outcome','reconciling') or (status='processing' and lease_until < now())) + (select count(*) from webhook_inbox where status='processing' and lease_until < now()) as unresolved\"));const n=Number(r.rows[0]?.unresolved??-1);console.log('internal reconciliation unresolved='+n);if(n!==0)process.exitCode=1}finally{await closeDb(db)}"
printf 'reconciliation PASS release=%s environment=%s\n' "$release_id" "$environment"
REMOTE
    ;;
  rollback)
    require_value ROLLBACK_TARGET
    rollback_api_ref="${ROLLBACK_API_IMAGE_REF:-}"
    rollback_worker_ref="${ROLLBACK_WORKER_IMAGE_REF:-}"
    if [[ "$ROLLBACK_TARGET" == none ]]; then
      [[ -z "$rollback_api_ref" && -z "$rollback_worker_ref" ]] || fail "first-release rollback refs must be empty"
      rollback_api_ref="$API_IMAGE_REF"
      rollback_worker_ref="$WORKER_IMAGE_REF"
    else
      [[ "$ROLLBACK_TARGET" =~ ^releases/[0-9a-f]{40}$ ]] || fail "ROLLBACK_TARGET is invalid"
      [[ "$rollback_api_ref" =~ ^ghcr\.io/[a-z0-9._/-]+@sha256:[0-9a-f]{64}$ ]] || fail "ROLLBACK_API_IMAGE_REF is invalid"
      [[ "$rollback_worker_ref" =~ ^ghcr\.io/[a-z0-9._/-]+@sha256:[0-9a-f]{64}$ ]] || fail "ROLLBACK_WORKER_IMAGE_REF is invalid"
    fi
    rollback_env="$(mktemp)"
    rollback_compose="$(mktemp)"
    trap 'rm -f "${rollback_env:-}" "${rollback_compose:-}"' EXIT
    umask 077
    printf '%s\n' \
      "DEPLOY_ENVIRONMENT=$DEPLOY_ENVIRONMENT" \
      "API_IMAGE_REF=$rollback_api_ref" \
      "WORKER_IMAGE_REF=$rollback_worker_ref" \
      "RUNTIME_ENV_FILE=$RUNTIME_ENV_FILE" \
      "API_BIND_ADDRESS=127.0.0.1" \
      "API_BIND_PORT=$API_BIND_PORT" > "$rollback_env"
    if [[ "$ROLLBACK_TARGET" == none ]]; then
      cp "$compose_source" "$rollback_compose"
    else
      rollback_sha="${ROLLBACK_TARGET#releases/}"
      git cat-file -e "$rollback_sha^{commit}"
      git merge-base --is-ancestor "$rollback_sha" "$RELEASE_SHA"
      git show "$rollback_sha:deploy/compose.remote.yml" > "$rollback_compose"
    fi
    recovery_dir="$DEPLOY_PATH/recoveries/$RELEASE_SHA"
    run_remote "$DEPLOY_PATH" "$RELEASE_SHA" <<'REMOTE'
set -euo pipefail
deploy_path="$1"
release_id="$2"
mkdir -p "$deploy_path/recoveries"
test -d "$deploy_path/recoveries"
test ! -L "$deploy_path/recoveries"
recovery_dir="$deploy_path/recoveries/$release_id"
rm -rf "$recovery_dir"
mkdir -m 700 "$recovery_dir"
REMOTE
    scp "${scp_options[@]}" "$rollback_compose" "$remote:$recovery_dir/compose.yml"
    scp "${scp_options[@]}" "$rollback_env" "$remote:$recovery_dir/deployment.env"
    compose_sha="$(sha256sum "$rollback_compose" | awk '{print $1}')"
    env_sha="$(sha256sum "$rollback_env" | awk '{print $1}')"
    run_remote "$DEPLOY_PATH" "$RELEASE_SHA" "$DEPLOY_ENVIRONMENT" "$ROLLBACK_TARGET" \
      "$rollback_api_ref" "$rollback_worker_ref" "$compose_sha" "$env_sha" <<'REMOTE'
set -euo pipefail
deploy_path="$1"
release_id="$2"
environment="$3"
rollback_target="$4"
expected_api_ref="$5"
expected_worker_ref="$6"
expected_compose_sha="$7"
expected_env_sha="$8"
project="ii-tonya-$environment"
if ! test -L "$deploy_path/current"; then
  printf 'rollback PASS no-current-release environment=%s\n' "$environment"
  exit 0
fi
current_target="$(readlink "$deploy_path/current")"
[[ "$current_target" =~ ^releases/[0-9a-f]{40}$ ]]
if test "$current_target" != "releases/$release_id"; then
  printf 'rollback PASS current-release-was-not-switched environment=%s\n' "$environment"
  exit 0
fi
current_dir="$deploy_path/$current_target"
recovery_dir="$deploy_path/recoveries/$release_id"
test "$(sha256sum "$recovery_dir/compose.yml" | awk '{print $1}')" = "$expected_compose_sha"
test "$(sha256sum "$recovery_dir/deployment.env" | awk '{print $1}')" = "$expected_env_sha"
compose() {
  docker compose --project-name "$project" --env-file "$recovery_dir/deployment.env" \
    -f "$recovery_dir/compose.yml" "$@"
}
if test "$rollback_target" = none; then
  compose down --remove-orphans
  rm -f "$deploy_path/current"
  printf 'rollback PASS stopped-first-release environment=%s\n' "$environment"
  exit 0
fi
test -L "$deploy_path/previous"
test "$(readlink "$deploy_path/previous")" = "$rollback_target"
test -f "$deploy_path/$rollback_target/.deployed"
printf '%s\n' "$release_id" > "$deploy_path/.rollback-in-progress"
rm -f "$deploy_path/current"
compose up -d --remove-orphans --wait --wait-timeout 120 api worker
api_id="$(compose ps -q api)"
worker_id="$(compose ps -q worker)"
test -n "$api_id"
test -n "$worker_id"
test "$(docker inspect -f '{{.State.Health.Status}}' "$api_id")" = healthy
test "$(docker inspect -f '{{.State.Health.Status}}' "$worker_id")" = healthy
test "$(docker inspect -f '{{.Config.Image}}' "$api_id")" = "$expected_api_ref"
test "$(docker inspect -f '{{.Config.Image}}' "$worker_id")" = "$expected_worker_ref"
compose exec -T api node --input-type=module --eval \
  "import {closeDb,createDb} from '@ii-tonya/db';import {sql} from 'drizzle-orm';const db=createDb(process.env.DATABASE_URL);try{const r=await db.execute(sql.raw(\"select (select count(*) from integration_outbox where status in ('unknown_outcome','reconciling') or (status='processing' and lease_until < now())) + (select count(*) from webhook_inbox where status='processing' and lease_until < now()) as unresolved\"));const n=Number(r.rows[0]?.unresolved??-1);console.log('rollback reconciliation unresolved='+n);if(n!==0)process.exitCode=1}finally{await closeDb(db)}"
ln -sfn "$rollback_target" "$deploy_path/current.next"
mv -Tf "$deploy_path/current.next" "$deploy_path/current"
printf 'rollback PASS target=%s environment=%s\n' "$rollback_target" "$environment"
REMOTE
    rm -f "$rollback_env" "$rollback_compose"
    trap - EXIT
    ;;
  rollback-complete)
    require_value ROLLBACK_TARGET
    [[ "$ROLLBACK_TARGET" =~ ^releases/[0-9a-f]{40}$ ]] || fail "ROLLBACK_TARGET is invalid"
    run_remote "$DEPLOY_PATH" "$ROLLBACK_TARGET" "$RELEASE_SHA" <<'REMOTE'
set -euo pipefail
deploy_path="$1"
rollback_target="$2"
release_id="$3"
test -f "$deploy_path/.rollback-in-progress"
test "$(cat "$deploy_path/.rollback-in-progress")" = "$release_id"
test -L "$deploy_path/current"
test "$(readlink "$deploy_path/current")" = "$rollback_target"
rm -f "$deploy_path/.rollback-in-progress"
printf 'rollback external verification complete target=%s\n' "$rollback_target"
REMOTE
    ;;
esac
