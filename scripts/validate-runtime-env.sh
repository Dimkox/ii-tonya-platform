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
  for flag in MINOR_ONBOARDING_ENABLED LLM_ENABLED INTENT_MODEL_ENABLED \
    MAKE_PROJECTION_ENABLED GOOGLE_SHEETS_PROJECTION_ENABLED RAW_CONVERSATION_LOGGING; do
    grep -Fx "$flag=false" "$runtime_env" >/dev/null || fail "$flag must be false"
  done
  # Integration flags may be true only when their required keys are present and non-empty.
  has_key() { grep -Eq "^$1=[^[:space:]]+$" "$runtime_env"; }
  for flag in SELARTI_ENABLED TELEGRAM_ENABLED PAYMENTS_ENABLED EXPERT_REFERRAL_ENABLED \
    EXPERT_TELEGRAM_QUERIES_ENABLED EXPERT_RESIDENCY_BILLING_ENABLED; do
    grep -Eqx "$flag=(true|false)" "$runtime_env" || fail "$flag must be true or false"
    [[ "$(grep -c "^$flag=" "$runtime_env")" -eq 1 ]] || fail "$flag must occur exactly once"
  done
  for flag in PLANERKA_ENABLED PLANERKA_RECOVERY_ENABLED PLANERKA_AVAILABILITY_ENABLED PLANERKA_CREATE_ENABLED; do
    [[ "$(grep -c "^$flag=" "$runtime_env")" -le 1 ]] || fail "$flag must occur at most once"
    ! grep -Eq "^$flag=" "$runtime_env" || grep -Eqx "$flag=(true|false)" "$runtime_env" ||
      fail "$flag must be true or false"
  done
  flag_value() { grep -Fxq "$1=true" "$runtime_env" && printf true || printf false; }
  require_keys() {
    local flag="$1"
    shift
    local key
    for key in "$@"; do has_key "$key" || fail "$flag=true requires $key"; done
  }
  # Legacy PLANERKA_ENABLED is retired; if present it must stay false.
  [[ "$(flag_value PLANERKA_ENABLED)" == false ]] || fail "PLANERKA_ENABLED must be false"
  planerka_recovery="$(flag_value PLANERKA_RECOVERY_ENABLED)"
  [[ "$planerka_recovery" == false ]] ||
    require_keys PLANERKA_RECOVERY_ENABLED PLANERKA_API_KEY PLANERKA_ACCOUNT_ID
  for flag in PLANERKA_AVAILABILITY_ENABLED PLANERKA_CREATE_ENABLED; do
    [[ "$(flag_value "$flag")" == false || "$planerka_recovery" == true ]] ||
      fail "$flag=true requires PLANERKA_RECOVERY_ENABLED=true"
  done
  [[ "$(flag_value SELARTI_ENABLED)" == false ]] ||
    require_keys SELARTI_ENABLED SELARTI_API_KEY SELARTI_WEBHOOK_SECRET \
      SELARTI_COMPANY_ID SELARTI_TASK_ID SELARTI_AI_ID
  [[ "$(flag_value TELEGRAM_ENABLED)" == false ]] ||
    require_keys TELEGRAM_ENABLED TELEGRAM_BOT_TOKEN TELEGRAM_WEBHOOK_SECRET
  # SCRUM-518: payments may be enabled only as a guarded live pilot: direct YooKassa,
  # exactly one allow-listed principal and a cap of at most 10 RUB. Otherwise off.
  for key in PAYMENT_PROVIDER YOOKASSA_ENABLED PAYMENTS_PILOT_ALLOWLIST PAYMENTS_PILOT_MAX_AMOUNT_RUB PAYMENTS_PILOT_CHECKOUT_ENABLED; do
    [[ "$(grep -c "^$key=" "$runtime_env")" -le 1 ]] || fail "$key must occur at most once"
  done
  if [[ "$(flag_value PAYMENTS_ENABLED)" == true ]]; then
    grep -Fx 'PAYMENT_PROVIDER=yookassa' "$runtime_env" >/dev/null ||
      fail "PAYMENTS_ENABLED=true requires PAYMENT_PROVIDER=yookassa"
    grep -Fx 'YOOKASSA_ENABLED=true' "$runtime_env" >/dev/null ||
      fail "PAYMENTS_ENABLED=true requires YOOKASSA_ENABLED=true"
    grep -Fx 'YOOKASSA_MODE=live' "$runtime_env" >/dev/null ||
      fail "payments pilot requires YOOKASSA_MODE=live"
    grep -Eqx 'PAYMENTS_PILOT_ALLOWLIST=([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|[1-9][0-9]{0,19})' "$runtime_env" ||
      fail "PAYMENTS_ENABLED=true requires PAYMENTS_PILOT_ALLOWLIST with exactly one id"
    grep -Eqx 'PAYMENTS_PILOT_MAX_AMOUNT_RUB=([1-9]|10)' "$runtime_env" ||
      fail "PAYMENTS_ENABLED=true requires PAYMENTS_PILOT_MAX_AMOUNT_RUB between 1 and 10"
    grep -Eqx 'YOOKASSA_SHOP_ID=[0-9]{1,32}' "$runtime_env" || fail "payments pilot requires numeric YOOKASSA_SHOP_ID"
    grep -Eqx 'YOOKASSA_SECRET_KEY=[^[:space:]]{8,256}' "$runtime_env" || fail "payments pilot requires YOOKASSA_SECRET_KEY"
    grep -Fx 'YOOKASSA_SECRET_REF=env://YOOKASSA_SECRET_KEY' "$runtime_env" >/dev/null ||
      fail "payments pilot requires YOOKASSA_SECRET_REF=env://YOOKASSA_SECRET_KEY"
    grep -Eqx 'YOOKASSA_RETURN_URL=https://ii-tonya\.ru(/[^[:space:]]*)?' "$runtime_env" ||
      fail "payments pilot requires YOOKASSA_RETURN_URL on https://ii-tonya.ru"
    grep -Eqx 'YOOKASSA_RECEIPT_VAT_CODE=([1-9]|1[0-2])' "$runtime_env" || fail "payments pilot requires YOOKASSA_RECEIPT_VAT_CODE"
    require_keys PAYMENTS_ENABLED YOOKASSA_RECEIPT_PAYMENT_SUBJECT YOOKASSA_RECEIPT_PAYMENT_MODE
    ! grep -Eq '^YOOKASSA_GATEWAY_(WORKER_)?CONFIG_FILE=[^[:space:]]' "$runtime_env" ||
      fail "payments pilot must not configure the YooKassa gateway"
    # The pilot checkout route stays off unless explicitly enabled for a client-session UUID.
    if grep -Fxq 'PAYMENTS_PILOT_CHECKOUT_ENABLED=true' "$runtime_env"; then
      grep -Eqx 'PAYMENTS_PILOT_ALLOWLIST=[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}' "$runtime_env" ||
        fail "PAYMENTS_PILOT_CHECKOUT_ENABLED=true requires a UUID PAYMENTS_PILOT_ALLOWLIST"
      grep -Fxq 'CLIENT_SESSION_ENABLED=true' "$runtime_env" ||
        fail "PAYMENTS_PILOT_CHECKOUT_ENABLED=true requires CLIENT_SESSION_ENABLED=true"
    fi
  else
    grep -Fx 'PAYMENT_PROVIDER=disabled' "$runtime_env" >/dev/null || fail "payments must be disabled"
    ! grep -Fxq 'YOOKASSA_ENABLED=true' "$runtime_env" || fail "YOOKASSA_ENABLED=true requires PAYMENTS_ENABLED=true"
    ! grep -Fxq 'PAYMENTS_PILOT_CHECKOUT_ENABLED=true' "$runtime_env" ||
      fail "PAYMENTS_PILOT_CHECKOUT_ENABLED=true requires PAYMENTS_ENABLED=true"
  fi
  for flag in EXPERT_REFERRAL_ENABLED EXPERT_TELEGRAM_QUERIES_ENABLED EXPERT_RESIDENCY_BILLING_ENABLED; do
    [[ "$(flag_value "$flag")" == false ]] || require_keys "$flag" EXPERT_TELEGRAM_BOT_TOKEN
  done
  # Residency billing is outside the SCRUM-518 pilot and stays off.
  [[ "$(flag_value EXPERT_RESIDENCY_BILLING_ENABLED)" == false ]] ||
    fail "EXPERT_RESIDENCY_BILLING_ENABLED must be false during the payments pilot"
  grep -Fx 'SELARTI_OUTBOUND_BILLING_MODE=disabled' "$runtime_env" >/dev/null || fail "Selarti billing must be disabled"
  grep -Fx 'LLM_PROVIDER=disabled' "$runtime_env" >/dev/null || fail "LLM provider must be disabled"
  if grep -Eiq '(<[^>]+>|placeholder|change[-_]?me|example\.invalid)' "$runtime_env"; then
    fail "placeholder marker found"
  fi
  # SCRUM-518 activation lock: the native API (apps/api/src/server.ts) has no direct
  # YooKassa runtime yet, so PAYMENTS_ENABLED=true would stop the API at startup.
  # Keep the pilot rejected until the checkout runtime is wired and startup-tested.
  payments_pilot_runtime_wired=false
  [[ "$(flag_value PAYMENTS_ENABLED)" == false || "$payments_pilot_runtime_wired" == true ]] ||
    fail "payments pilot activation is locked until the API wires the direct YooKassa runtime"
fi
