#!/usr/bin/env bash
set -Eeuo pipefail

# Install or verify this repository's pre-push gate.
#
#   bash scripts/install-git-hooks.sh            # install for this clone
#   bash scripts/install-git-hooks.sh --check    # exit 1 when the gate is not active
#   bash scripts/install-git-hooks.sh --force    # replace a foreign hook, after backing it up
#
# Why a dispatcher in the common hooks directory instead of core.hooksPath=scripts/git-hooks:
# core.hooksPath is resolved against the checked-out worktree, so a checkout of any commit or
# branch that predates scripts/git-hooks silently has no hook at all - git does not warn, the
# push just goes through ungated. That was measured, not assumed. The dispatcher lives outside
# the worktree, is shared by every linked worktree of this clone, and refuses loudly when the
# versioned hook it is supposed to run is not in the checkout.

quiet_dispatcher='#!/usr/bin/env bash
# ii-tonya-platform pre-push gate dispatcher. Managed by scripts/install-git-hooks.sh.
set -Eeuo pipefail
top="$(git rev-parse --show-toplevel)"
hook="$top/scripts/git-hooks/pre-push"
if [[ ! -f "$hook" ]]; then
  printf "pre-push: REFUSING - this checkout (%s) has no scripts/git-hooks/pre-push, so the\n" \
    "$(git rev-parse --short HEAD)" >&2
  printf "pre-push: repository gate cannot run. Rebase onto a commit that carries the gate, or\n" >&2
  printf "pre-push: bypass knowingly: git push --no-verify\n" >&2
  exit 1
fi
exec bash "$hook" "$@"
'

repo_root="$(git rev-parse --show-toplevel)"
common_dir="$(cd "$(git rev-parse --git-common-dir)" && pwd)"
hooks_dir="$common_dir/hooks"
dispatcher="$hooks_dir/pre-push"
versioned="scripts/git-hooks/pre-push"
mode="install"
[[ "${1:-}" == "--check" ]] && mode="check"
[[ "${1:-}" == "--force" ]] && mode="force"

cd "$repo_root"

if [[ ! -f "$versioned" ]]; then
  printf 'missing %s in this checkout; nothing to install.\n' "$versioned" >&2
  exit 1
fi

mkdir -p "$hooks_dir"

same_content="false"
# printf '%s' writes the body without adding a newline, so compare against the same shape:
# trailing-newline drift would make --check fail forever on a correctly installed hook.
if [[ -f "$dispatcher" ]] && [[ "$(cat "$dispatcher")" == "${quiet_dispatcher%$'\n'}" ]]; then
  same_content="true"
fi

if [[ "$mode" == "check" ]]; then
  if [[ "$same_content" != "true" ]]; then
    printf 'gate NOT active: %s is missing or not the dispatcher this installer writes.\n' "$dispatcher" >&2
    printf 'fix: bash scripts/install-git-hooks.sh\n' >&2
    exit 1
  fi
  if [[ ! -x "$dispatcher" ]]; then
    printf 'gate NOT active: %s is not executable (git skips such hooks without a word).\n' "$dispatcher" >&2
    printf 'fix: chmod +x %s\n' "$dispatcher" >&2
    exit 1
  fi
  printf 'gate active: %s -> %s (executable)\n' "$dispatcher" "$versioned"
  exit 0
fi

if [[ -f "$dispatcher" && "$same_content" != "true" && "$mode" != "force" ]]; then
  printf 'refusing to overwrite an existing foreign hook: %s\n' "$dispatcher" >&2
  printf 'inspect it, then re-run with --force (a timestamped copy will be kept next to it).\n' >&2
  exit 1
fi

if [[ -f "$dispatcher" && "$same_content" != "true" ]]; then
  backup="$dispatcher.foreign.$(date +%Y%m%dT%H%M%SZ)"
  mv "$dispatcher" "$backup"
  printf 'kept the previous hook at %s\n' "$backup"
fi

printf '%s' "$quiet_dispatcher" >"$dispatcher"
chmod +x "$dispatcher"

# core.hooksPath would override the common hooks directory entirely, reintroducing the
# per-checkout disappearance this installer exists to avoid.
current_path="$(git config --get core.hooksPath || true)"
if [[ -n "$current_path" ]]; then
  git config --unset core.hooksPath
  printf 'cleared core.hooksPath (%s) so the dispatcher is the single mechanism\n' "$current_path"
fi

printf 'installed gate dispatcher: %s\n' "$dispatcher"
printf 'shared by every worktree of this clone; runs %s from whichever checkout pushes\n' "$versioned"
