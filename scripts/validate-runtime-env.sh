#!/usr/bin/env bash
set -euo pipefail

runtime_env="${1:?runtime env file is required}"
release_sha="${2:-}"

fail() {
  printf 'runtime env error: %s\n' "$1" >&2
  exit 2
}

[[ -f "$runtime_env" && ! -L "$runtime_env" ]] || fail "file must be regular and not a symlink"
if grep -q '^NODE_OPTIONS=' "$runtime_env"; then
  fail "NODE_OPTIONS is reserved by systemd"
fi
[[ "$(grep -c '^NODE_ENV=' "$runtime_env")" -eq 1 ]] || fail "NODE_ENV must occur exactly once"
grep -Fx 'NODE_ENV=production' "$runtime_env" >/dev/null || fail "NODE_ENV must be production"
[[ "$(grep -c '^DATABASE_URL=' "$runtime_env")" -eq 1 ]] || fail "DATABASE_URL must occur exactly once"
database_url="$(sed -n 's/^DATABASE_URL=//p' "$runtime_env")"
[[ "$database_url" =~ ^postgres(ql)?://[^[:space:]]+$ ]] || fail "DATABASE_URL must be PostgreSQL without whitespace"
[[ "$database_url" == *\?* ]] || fail "DATABASE_URL must include query parameters"
query="${database_url#*\?}"
sslmode_count=0
sslmode_value=""
IFS='&' read -r -a query_parts <<< "$query"
for query_part in "${query_parts[@]}"; do
  query_key="${query_part%%=*}"
  [[ "$query_key" != *%* ]] || fail "percent-encoded query keys are forbidden"
  if [[ "$query_part" == sslmode=* ]]; then
    sslmode_count=$((sslmode_count + 1))
    sslmode_value="${query_part#sslmode=}"
  fi
done
[[ "$sslmode_count" -eq 1 ]] || fail "DATABASE_URL must contain exactly one sslmode"
[[ "$sslmode_value" =~ ^(verify-ca|verify-full)$ ]] || fail "DATABASE_URL sslmode must verify the server"

if [[ -n "$release_sha" ]]; then
  [[ "$release_sha" =~ ^[0-9a-f]{40}$ ]] || fail "release SHA must be full length"
  grep -Fx 'ALLOW_INSECURE_LOCAL_DATABASE=false' "$runtime_env" >/dev/null || fail "local database downgrade must be disabled"
  grep -Fx "MIGRATION_COMPATIBILITY_APPROVED_SHA=$release_sha" "$runtime_env" >/dev/null || fail "migration approval must match the release"
  for flag in MINOR_ONBOARDING_ENABLED SELARTI_ENABLED PLANERKA_ENABLED TELEGRAM_ENABLED \
    PAYMENTS_ENABLED LLM_ENABLED INTENT_MODEL_ENABLED MAKE_PROJECTION_ENABLED \
    GOOGLE_SHEETS_PROJECTION_ENABLED EXPERT_REFERRAL_ENABLED \
    EXPERT_RESIDENCY_BILLING_ENABLED EXPERT_TELEGRAM_QUERIES_ENABLED \
    RAW_CONVERSATION_LOGGING; do
    grep -Fx "$flag=false" "$runtime_env" >/dev/null || fail "$flag must be false"
  done
  grep -Fx 'SELARTI_OUTBOUND_BILLING_MODE=disabled' "$runtime_env" >/dev/null || fail "Selarti billing must be disabled"
  grep -Fx 'PAYMENT_PROVIDER=disabled' "$runtime_env" >/dev/null || fail "payments must be disabled"
  grep -Fx 'LLM_PROVIDER=disabled' "$runtime_env" >/dev/null || fail "LLM provider must be disabled"
  if grep -Eiq '(<[^>]+>|placeholder|change[-_]?me|example\.invalid)' "$runtime_env"; then
    fail "placeholder marker found"
  fi
fi
