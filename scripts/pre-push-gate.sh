#!/usr/bin/env bash
set -Eeuo pipefail

# Pre-push gate for this repository.
#
# Why it exists: local verification catches failures before pushing, independently of hosted CI.
# Not hypothetical: 87f6270 changed scripts/deploy-native-remote.sh without
# re-registering its automation hash and left main red until PR #79.
#
# Usage
#   bash scripts/pre-push-gate.sh                      # branch-sized gate
#   bash scripts/pre-push-gate.sh --full               # also typecheck (used for pushes to main)
#   bash scripts/pre-push-gate.sh --range A..B         # commit range for the whitespace check
#   bash scripts/pre-push-gate.sh --changed-file LIST  # newline-separated paths to lint
#
# Exit 0 = every executed check passed. Bypass on purpose with `git push --no-verify`.

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo_root"

full="false"
changed_file=""
range=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --full) full="true" ;;
    --range)
      shift
      [[ $# -gt 0 ]] || { printf -- '--range needs a value\n' >&2; exit 2; }
      range="$1"
      ;;
    --changed-file)
      shift
      [[ $# -gt 0 ]] || { printf -- '--changed-file needs a value\n' >&2; exit 2; }
      changed_file="$1"
      ;;
    -h | --help)
      sed -n '3,20p' "${BASH_SOURCE[0]}"
      exit 0
      ;;
    *)
      printf 'unknown argument: %s\n' "$1" >&2
      exit 2
      ;;
  esac
  shift
done

results_dir="$(mktemp -d)"
trap 'rm -rf "$results_dir"' EXIT

# record <name> <command...>: store exit status and wall time, keep output per check so that
# concurrent checks cannot interleave their logs.
#
# `if ! cmd; then code=$?; fi` would capture the status of the negation, which is always 0, and
# every check would then report success without having run. Assign from $? with `||`.
record() {
  local name="$1"
  shift
  local started=$SECONDS code=0
  "$@" >"$results_dir/$name.log" 2>&1 || code=$?
  printf '%s\t%s\n' "$code" "$((SECONDS - started))" >"$results_dir/$name.result"
}

# bash -n takes ONE script per invocation: extra operands become positional parameters of the
# first, so `bash -n a.sh b.sh` silently validates only a.sh. Loop, and refuse to report success
# when nothing was checked.
syntax_all() {
  local file count=0
  shopt -s nullglob
  for file in scripts/*.sh deploy/bootstrap/*.sh deploy/claw/*.sh; do
    bash -n "$file" || return $?
    count=$((count + 1))
  done
  (( count > 0 )) || {
    printf 'no shell scripts found; refusing to report syntax success\n' >&2
    return 1
  }
  printf 'checked %s shell scripts\n' "$count"
}

for tool in vitest eslint prettier; do
  if [[ ! -x "$repo_root/node_modules/.bin/$tool" ]]; then
    printf 'cannot run the gate: node_modules/.bin/%s is missing.\n' "$tool" >&2
    printf 'install dependencies (pnpm install) and retry.\n' >&2
    exit 1
  fi
done

changed_paths=()
if [[ -n "$changed_file" ]]; then
  if [[ ! -f "$changed_file" ]]; then
    printf 'changed-file list not found: %s\n' "$changed_file" >&2
    exit 2
  fi
  while IFS= read -r line; do
    [[ -n "$line" && -f "$line" ]] || continue
    case "$line" in
      *.cjs | *.js | *.mjs | *.ts | *.tsx) changed_paths+=("$line") ;;
    esac
  done <"$changed_file"
fi

# Derived from package.json so the gate cannot drift from `pnpm format:check`.
prettier_targets="$(
  node -e 'const s = require("./package.json").scripts["format:check"]; process.stdout.write(s.replace(/^prettier\s+--check\s+/, ""))'
)"

# Group 1 - cheap checks, safe in parallel: none of them touches PostgreSQL or shared state.
record shell-syntax bash -c "$(declare -f syntax_all); syntax_all" &
record format-check node_modules/.bin/prettier --check $prettier_targets &
record claw-evidence node scripts/verify-claw-evidence.mjs &
if [[ -n "$range" ]]; then
  record whitespace git diff --check "$range" &
else
  printf '2\t0\n' >"$results_dir/whitespace.result"
fi
if [[ ${#changed_paths[@]} -gt 0 ]]; then
  record eslint node_modules/.bin/eslint "${changed_paths[@]}" &
else
  printf '2\t0\n' >"$results_dir/eslint.result"
fi
wait

# Group 2 - the pin suite, alone and after the parallel group.
#
# tests/repo spends ~27s of collect time and one of its checks is pinned at 30s; running the
# 34s `eslint .` next to it failed two tests on an unchanged tree (30.9s test time against 7.1s
# in a quiet run). The variable is host load, not worker count (issue #71), so this check does
# not share the CPU with anything else in the gate.
record repo-tests node_modules/.bin/vitest run tests/repo

if [[ "$full" == "true" ]]; then
  record tests-typecheck node_modules/.bin/tsc --noEmit -p tsconfig.tests.json
fi

declare -A labels=(
  [shell-syntax]="bash -n"
  [format-check]="prettier"
  [whitespace]="git diff --check"
  [claw-evidence]="claw evidence"
  [eslint]="eslint (changed)"
  [repo-tests]="tests/repo"
  [tests-typecheck]="tests typecheck"
)

printf '\npre-push gate · mode %s%s\n\n' "$([[ "$full" == "true" ]] && printf 'full' || printf 'branch')" \
  "$([[ -n "$range" ]] && printf ' · range %s' "$range" || printf ' · range -')"

failed="false"
skipped=""
for name in shell-syntax format-check whitespace claw-evidence eslint repo-tests tests-typecheck; do
  result="$results_dir/$name.result"
  [[ -f "$result" ]] || continue
  IFS=$'\t' read -r code seconds <"$result"
  case "$code" in
    0) printf '  ok       %-18s %ss\n' "${labels[$name]}" "$seconds" ;;
    2)
      printf '  skipped  %-18s\n' "${labels[$name]}"
      skipped+=" ${labels[$name]}"
      ;;
    *)
      printf '  FAILED   %-18s exit %s\n' "${labels[$name]}" "$code"
      tail -c 600 "$results_dir/$name.log" | tr -d '\r' | grep -v '^[[:space:]]*$' | tail -2 |
        sed 's/^/           /'
      failed="true"
      ;;
  esac
done

if [[ "$failed" == "true" ]]; then
  printf '\npush refused. Fix the failing checks, or bypass on purpose: git push --no-verify\n'
  exit 1
fi

if [[ -n "$skipped" ]]; then
  printf '\ngate green (skipped:%s).\n' "$skipped"
else
  printf '\ngate green.\n'
fi
