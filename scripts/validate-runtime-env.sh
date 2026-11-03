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
  # Flags without a merged live integration (or blocked by legal/provider choice) stay false.
  for flag in MINOR_ONBOARDING_ENABLED PLANERKA_ENABLED LLM_ENABLED INTENT_MODEL_ENABLED \
    MAKE_PROJECTION_ENABLED GOOGLE_SHEETS_PROJECTION_ENABLED RAW_CONVERSATION_LOGGING; do
    grep -Fx "$flag=false" "$runtime_env" >/dev/null || fail "$flag must be false"
  done
  # Integration flags may be true only when their required keys are present and non-empty.
  has_key() { grep -Eq "^$1=[^[:space:]]+$" "$runtime_env"; }
  flag_value() {
    [[ "$(grep -c "^$1=" "$runtime_env")" -eq 1 ]] || fail "$1 must occur exactly once"
    local value
    value="$(sed -n "s/^$1=//p" "$runtime_env")"
    [[ "$value" == true || "$value" == false ]] || fail "$1 must be true or false"
    printf '%s' "$value"
  }
  require_keys() {
    local flag="$1"
    shift
    local key
    for key in "$@"; do has_key "$key" || fail "$flag=true requires $key"; done
  }
  [[ "$(flag_value SELARTI_ENABLED)" == false ]] ||
    require_keys SELARTI_ENABLED SELARTI_API_KEY SELARTI_WEBHOOK_SECRET \
      SELARTI_COMPANY_ID SELARTI_TASK_ID SELARTI_AI_ID
  [[ "$(flag_value TELEGRAM_ENABLED)" == false ]] ||
    require_keys TELEGRAM_ENABLED TELEGRAM_BOT_TOKEN TELEGRAM_WEBHOOK_SECRET
  payments="$(flag_value PAYMENTS_ENABLED)"
  if [[ "$payments" == true ]]; then
    grep -Eqx 'PAYMENT_PROVIDER=(yookassa|yookassa_gateway)' "$runtime_env" ||
      fail "PAYMENTS_ENABLED=true requires a YooKassa PAYMENT_PROVIDER"
    require_keys PAYMENTS_ENABLED YOOKASSA_SHOP_ID
  else
    grep -Fx 'PAYMENT_PROVIDER=disabled' "$runtime_env" >/dev/null || fail "payments must be disabled"
  fi
  for flag in EXPERT_REFERRAL_ENABLED EXPERT_TELEGRAM_QUERIES_ENABLED EXPERT_RESIDENCY_BILLING_ENABLED; do
    [[ "$(flag_value "$flag")" == false ]] || require_keys "$flag" EXPERT_TELEGRAM_BOT_TOKEN
  done
  [[ "$(flag_value EXPERT_RESIDENCY_BILLING_ENABLED)" == false || "$payments" == true ]] ||
    fail "EXPERT_RESIDENCY_BILLING_ENABLED=true requires PAYMENTS_ENABLED=true"
  grep -Fx 'SELARTI_OUTBOUND_BILLING_MODE=disabled' "$runtime_env" >/dev/null || fail "Selarti billing must be disabled"
  grep -Fx 'LLM_PROVIDER=disabled' "$runtime_env" >/dev/null || fail "LLM provider must be disabled"
  if grep -Eiq '(<[^>]+>|placeholder|change[-_]?me|example\.invalid)' "$runtime_env"; then
    fail "placeholder marker found"
  fi
fi
