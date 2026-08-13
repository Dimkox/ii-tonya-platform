import assert from "node:assert/strict";
import { Client } from "pg";

const required = (name) => {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
};
const base = required("SANDBOX_BASE_URL");
const databaseUrl = required("SANDBOX_DATABASE_URL");
const orderId = required("SANDBOX_FIXTURE_ORDER_ID");
const requester = required("SANDBOX_REQUESTER_TOKEN");
const approver = required("SANDBOX_APPROVER_TOKEN");
const request = async (path, token, payload) => {
  const response = await fetch(new URL(path, base), {
    method: payload === undefined ? "GET" : "POST",
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(payload === undefined ? {} : { "content-type": "application/json" }),
    },
    body: payload === undefined ? undefined : JSON.stringify(payload),
  });
  const body = await response.json();
  assert.ok(response.ok, `${path}: ${response.status} ${JSON.stringify(body)}`);
  return body;
};
const nonce = (kind) => `${kind}-container-nonce-0001`;
const key = (kind) => `${kind}-container-idempotency-0001`;
const checkout = await request("/sandbox/v1/checkouts", null, {
  orderId,
  amountMinor: "25000",
  currency: "RUB",
  idempotencyKey: "checkout-container-idempotency-0001",
});
assert.match(checkout.paymentId, /^sandbox_payment_/u);

for (const [transition, version] of [
  ["settled", 0],
  ["refunded", 1],
]) {
  const action = `expert_residency.sandbox_${transition === "settled" ? "settle" : "refund"}`;
  const approval = await request(
    `/sandbox/v1/admin/approvals/${action}/${checkout.paymentId}/request`,
    requester,
    {
      nonce: nonce(transition),
      expectedVersion: version,
      idempotencyKey: key(transition),
    },
  );
  await request(
    `/sandbox/v1/admin/approvals/${approval.approvalId}/approve`,
    approver,
    {},
  );
  await request(
    `/sandbox/v1/admin/payments/${checkout.paymentId}/transitions/${transition}`,
    requester,
    {
      approvalId: approval.approvalId,
      nonce: nonce(transition),
      expectedVersion: version,
      idempotencyKey: key(transition),
      correlationId: `${transition}-container-correlation-0001`,
    },
  );
}

const db = new Client({ connectionString: databaseUrl });
await db.connect();
try {
  const facts = (
    await db.query(
      `select o.status,
      extract(epoch from (o.residency_ends_at-o.residency_starts_at))::bigint::text interval_seconds,
      (select count(*)::int from expert_residency_provider_event_inbox where payment_id=$1 and status='processed') processed,
      (select status from expert_residency_payment_attempts where provider='sandbox' and provider_request_id=$1) attempt_status,
      (select count(*)::int from audit_events where action in ('expert_residency.sandbox_settle','expert_residency.sandbox_refund')) audit_facts,
      (select count(*)::int from integration_outbox where reconciliation_key='expert-residency:' || $2::text) outbox_facts,
      (select count(*)::int from expert_residency_provider_event_inbox where payment_id=$1 and event_kind='refunded' and status='processed' and result_schema_version=1) reversal_facts,
      (select count(*)::int from sandbox_expert_residency_events where payment_id=$1 and processed_at is null) pending,
      (select count(*)::int from expert_referral_ledger_entries where source_type like 'sandbox%') sandbox_ledger
     from expert_residency_orders o where o.id=$2::uuid`,
      [checkout.paymentId, orderId],
    )
  ).rows[0];
  assert.deepEqual(facts, {
    status: "refunded",
    interval_seconds: "86400",
    processed: 2,
    attempt_status: "refunded",
    audit_facts: 2,
    outbox_facts: 1,
    reversal_facts: 1,
    pending: 0,
    sandbox_ledger: 0,
  });
} finally {
  await db.end();
}
process.stdout.write("sandbox_http_lifecycle=PASS\n");
