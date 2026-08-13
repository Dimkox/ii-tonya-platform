#!/usr/bin/env bash
set -euo pipefail

project="ii-tonya-sandbox-${VCS_REF:-local}"
cleanup() {
  docker compose --project-name "$project" --file compose.sandbox.yaml --profile sandbox down --volumes --remove-orphans >/dev/null 2>&1 || true
}
trap cleanup EXIT INT TERM

compose=(docker compose --project-name "$project" --file compose.sandbox.yaml --profile sandbox)
"${compose[@]}" up --wait sandbox-postgres
for migration in packages/db/migrations/*.sql; do
  "${compose[@]}" exec -T sandbox-postgres psql -v ON_ERROR_STOP=1 -U ii_tonya_sandbox -d ii_tonya_sandbox < "$migration"
done
"${compose[@]}" exec -T sandbox-postgres psql -v ON_ERROR_STOP=1 -U ii_tonya_sandbox -d ii_tonya_sandbox < packages/sandbox-payments/migrations/0000_sandbox_expert_residency.sql

requester_token=requester-container-token-00000001
approver_token=approver-container-token-000000001
requester_hash="sha256:$(printf %s "$requester_token" | sha256sum | cut -d' ' -f1)"
approver_hash="sha256:$(printf %s "$approver_token" | sha256sum | cut -d' ' -f1)"
order_id=00000000-0000-4000-8000-000000000105
"${compose[@]}" exec -T sandbox-postgres psql -v ON_ERROR_STOP=1 \
  -v requester_hash="$requester_hash" -v approver_hash="$approver_hash" \
  -U ii_tonya_sandbox -d ii_tonya_sandbox <<'SQL'
insert into users(id) values
 ('00000000-0000-4000-8000-000000000101'),
 ('00000000-0000-4000-8000-000000000102'),
 ('00000000-0000-4000-8000-000000000103');
insert into admin_sessions(session_id_hash,admin_id,mfa_verified_at,expires_at) values
 (:'requester_hash','00000000-0000-4000-8000-000000000101',now(),now()+interval '1 hour'),
 (:'approver_hash','00000000-0000-4000-8000-000000000102',now(),now()+interval '1 hour');
insert into admin_role_assignments(admin_id,role) values
 ('00000000-0000-4000-8000-000000000101','entitlement_admin'),
 ('00000000-0000-4000-8000-000000000102','entitlement_admin');
insert into experts(id,user_id,active,verified) values
 ('00000000-0000-4000-8000-000000000104','00000000-0000-4000-8000-000000000103',true,true);
insert into admin_approvals(id,action,object_type,object_id,requester_id,approver_id,
 expires_at,nonce,consumed_at) values
 ('00000000-0000-4000-8000-000000000106','expert_residency.tariff_create',
  'expert_residency_tariff_version','00000000-0000-4000-8000-000000000107',
  '00000000-0000-4000-8000-000000000101','00000000-0000-4000-8000-000000000102',
  now()+interval '1 hour','legacy-container-tariff',now());
insert into expert_residency_tariff_versions(id,tariff_key,display_name,price_minor,duration_seconds,
 active_from,active_to,approval_id,admin_session_id_hash) values
 ('00000000-0000-4000-8000-000000000107','container','Container sandbox',25000,86400,
  now()-interval '1 hour',now()+interval '1 day','00000000-0000-4000-8000-000000000106',:'requester_hash');
insert into expert_residency_orders(id,expert_id,tariff_version_id,snapshot_display_name,price_minor,
 duration_seconds,credit_minor,cash_minor,payment_deadline,provider_deadline,idempotency_key) values
 ('00000000-0000-4000-8000-000000000105','00000000-0000-4000-8000-000000000104',
  '00000000-0000-4000-8000-000000000107','Container sandbox',25000,86400,0,25000,
  now()+interval '1 hour',now()+interval '1 hour','container-order-0001');
SQL
"${compose[@]}" up --build --wait sandbox-api
"${compose[@]}" exec -T \
  -e SANDBOX_BASE_URL=http://127.0.0.1:3001 \
  -e SANDBOX_DATABASE_URL=postgresql://ii_tonya_sandbox:local-placeholder-only@sandbox-postgres:5432/ii_tonya_sandbox \
  -e SANDBOX_FIXTURE_ORDER_ID="$order_id" \
  -e SANDBOX_REQUESTER_TOKEN="$requester_token" \
  -e SANDBOX_APPROVER_TOKEN="$approver_token" \
  sandbox-api node /app/sandbox-container-lifecycle.mjs
