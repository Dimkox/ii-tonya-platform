# YooKassa Provider Adapter Design

**Date:** 2026-08-14  
**Status:** approved architecture; implementation not started  
**Requirement:** `PAY-PROV-001`  
**Release posture:** disabled by default; no merchant credentials or live activation

## 1. Objective

Implement a narrow TypeScript adapter for the YooKassa Merchant API that connects the
existing provider-neutral expert residency payment port to payment creation, authoritative
status reads, refunds, webhook ingestion, and bounded reconciliation. PostgreSQL remains
the financial authority. A YooKassa response or webhook is provider evidence, not direct
permission to mutate balances, residency intervals, referral rewards, or debt.

The first increment must be useful without a merchant account: it compiles, validates
strict fixture contracts, stays disabled in every shipped environment, and fails startup
closed if enabled without complete configuration. Test-shop and live evidence are later
activation gates.

## 2. Selected approach

Use a first-party TypeScript HTTP client in `@ii-tonya/integrations`, built on the runtime
`fetch` interface and local schemas that strictly validate every authority-bearing field
while discarding unrelated provider response fields. Do not add a payment SDK.

Reasons:

- the application is TypeScript and already has a provider-neutral payment port;
- the official YooKassa documentation exposes a small REST subset needed by this product;
- request retries, unknown outcomes, redaction, reconciliation, and financial-event
  branding must follow this repository's existing rules rather than an SDK's defaults;
- the suggested `AlekseyKorshuk/yoomoney-api` project is a GPL-3.0 Python client for the
  personal YooMoney Wallet API, not the YooKassa Merchant API at
  `https://api.yookassa.ru/v3/`.

Rejected alternatives:

1. **Generated full OpenAPI client.** It imports a much broader mutable surface than the
   four operations required here and creates large generated-code review and upgrade
   costs.
2. **Python wallet sidecar.** It targets the wrong API and language, introduces another
   runtime and IPC boundary, and does not provide YooKassa payment/refund/webhook
   semantics.

## 3. Requirements

- **YKP-001 — Strict endpoint boundary.** Production code calls only the fixed HTTPS
  origin `https://api.yookassa.ru` and the versioned `/v3` payment/refund resources.
  Tests inject a transport, not an arbitrary production base URL.
- **YKP-002 — Merchant authentication.** Server-to-server requests use HTTP Basic Auth
  from separate `YOOKASSA_SHOP_ID` and `YOOKASSA_SECRET_KEY` secret inputs. Authorization
  values, request bodies containing customer contacts, and raw provider bodies never
  enter logs, metrics, errors, evidence, or persistence.
- **YKP-003 — Durable idempotency.** Every POST uses one locally persisted UUID-v4
  idempotency key of at most 64 characters. Retries reuse the exact key and body. Local
  PostgreSQL idempotency remains permanent because YooKassa guarantees provider-side
  idempotency for only 24 hours.
- **YKP-004 — Exact money.** The adapter accepts integer minor units, permits only RUB,
  and converts kopecks to a two-decimal string without floating-point arithmetic. It
  rejects zero, negative, unsafe, malformed, mismatched, or provider-rounded amounts.
- **YKP-005 — Single-stage redirect checkout.** Residency checkout creates a payment with
  `capture: true`, `confirmation.type: redirect`, a server-selected HTTPS return URL,
  bounded non-sensitive description, and opaque server-owned metadata. Only a validated
  YooKassa payment ID and HTTPS confirmation URL are returned.
- **YKP-006 — Authoritative provider read.** Settlement, cancellation, refund, webhook,
  and unknown-outcome handling read the current payment or refund object from YooKassa
  before minting a verified internal provider event. The adapter verifies provider ID,
  order binding, currency, amount, refundable facts, test/live mode, and expected status.
- **YKP-007 — Webhook is a signal.** The inbound route accepts only supported notification
  events, a bounded body, and an allowlisted effective peer address supplied by the
  trusted nginx boundary. It never trusts forwarded headers from the public request.
  Notification envelope facts are strict-parsed, then re-read through the authenticated API.
  Duplicate delivery is handled by the existing PostgreSQL provider inbox.
- **YKP-008 — Unknown outcome safety.** Timeouts, connection failures, HTTP 429, and HTTP
  5xx are retryable/unknown outcomes. The system reconciles before retrying a financial
  operation. Deterministic 4xx contract or credential failures are terminal and
  sanitized. A transport error never becomes an implicit settlement or refund.
- **YKP-009 — Refund integrity.** Refund requests use a stable local command and
  idempotency key, cannot exceed the canonical refundable cash amount, and include
  receipt data when the configured fiscal mode requires it. A successful provider refund
  is still routed through the existing canonical reversal inbox.
- **YKP-010 — Fiscal fail-closed gate.** Receipt customer contact, item description,
  quantity, payment subject/mode, VAT code, and receipt scenario are explicit typed
  inputs. No VAT code or legal/fiscal scenario is invented by code. Enabling YooKassa is
  rejected until the approved legal-entity configuration is complete.
- **YKP-011 — Disabled composition.** `YOOKASSA_ENABLED=false` is the default. Empty
  placeholders are permitted only while disabled. Enabling requires every credential,
  return URL, webhook trust setting, environment mode, and fiscal setting; incomplete or
  contradictory input stops startup before a network call.
- **YKP-012 — Bounded observability.** Metrics expose operation and bounded outcome only.
  Logs may include a correlation ID and one-way hashes of internal/provider identifiers,
  but never IDs themselves, idempotency keys, customer contacts, payment URLs, metadata,
  authorization, or provider payloads.
- **YKP-013 — Test/live separation.** Test-shop responses must carry `test: true`; a test
  adapter rejects live objects. A live adapter rejects test objects. No single runtime
  accepts both modes.
- **YKP-014 — Recovery.** Disabling the flag stops new provider calls while existing
  durable unknown outcomes and webhook inbox facts remain available for operator-led
  reconciliation. Rollback never deletes provider mappings or financial audit records.
- **YKP-015 — Consent-bound receipt contact.** A receipt contact may be selected only
  from an approved source with a current consent decision matching an explicit purpose
  and policy version. Missing, revoked, stale, or mismatched consent fails closed before
  a provider call. Neither a contact source nor consent semantics are invented by code;
  `YOOKASSA_RECEIPT_CONTACT_CONSENT_PURPOSE=` and
  `YOOKASSA_RECEIPT_CONTACT_POLICY_VERSION=` remain empty activation inputs.
- **YKP-016 — Encrypted exact-body unbound recovery.** Autonomous recovery of an unknown
  POST that has no bound provider object requires encrypted persistence of the exact
  request body and reuse of its original idempotency key. Recovery is bounded by an
  approved window and retention rule, never scans payment history, and is disabled when
  any policy input is empty. The encryption key is reference-only; the empty activation
  inputs are `YOOKASSA_RECOVERY_ENCRYPTION_KEY_REFERENCE=`,
  `YOOKASSA_RECOVERY_RETENTION_DAYS=`, `YOOKASSA_UNBOUND_RECOVERY_ENABLED=`, and
  `YOOKASSA_UNBOUND_RECOVERY_WINDOW_HOURS=`.

## 4. Components

### 4.1 YooKassa client

`packages/integrations/src/yookassa/client.ts` owns HTTP Basic Auth, request timeouts,
idempotency headers, minimized response parsing, safe status classification, and transport
injection for tests. It exposes only:

- `createPayment`;
- `getPayment`;
- `createRefund`;
- `getRefund`.

The client does not know referral credit rules, residency duration, database schema, or
HTTP routes.

### 4.2 Payment adapter and verifier

`packages/integrations/src/yookassa/payment-adapter.ts` implements the existing
`ExpertResidencyPaymentPort`. It converts the provider-neutral checkout command to a
YooKassa request, validates the response, and delegates durable operation mapping to a
repository port. A separate verifier may mint `VerifiedExpertResidencyPaymentEvent`
only after the authoritative re-read and exact redundant-fact comparison.

### 4.3 PostgreSQL operation repository

The database boundary durably binds local order/payment/refund command IDs to provider
IDs, request digests, idempotency keys, expected amounts, environment mode, and terminal
outcomes. Claiming, replay, unknown-outcome reconciliation, and event delivery use row
locks and existing provider-inbox idempotency. Raw provider payloads and secrets are not
stored.

### 4.4 Webhook route

`apps/api` exposes a dedicated default-off YooKassa notification route. Nginx is the only
trusted source of the normalized peer address. The route performs size, content type,
schema, event, and source-network checks, claims the notification, performs the
authoritative provider read, hands a verified event to the canonical inbox, and returns
HTTP 200 only after durable acceptance. Failures remain sanitized and retryable where
appropriate.

### 4.5 Worker reconciliation

The bounded worker claims unresolved provider operations from PostgreSQL, reads exact
provider objects, resolves applied/not-applied/unknown outcomes, and emits bounded alerts
for mismatches. It does not poll unbounded payment history or use webhook payloads as
authority. The current reader can reconcile only operations with a durably bound provider
object ID. It does not autonomously recover an unbound POST outcome; YKP-016 remains an
activation blocker until exact-body encrypted recovery is implemented and approved.

## 5. Data flow

### Checkout

1. The existing residency service creates and reserves an authoritative order.
2. PostgreSQL assigns the YooKassa operation and stable idempotency key.
3. The adapter creates one single-stage redirect payment.
4. The validated provider ID and request digest are bound to the order.
5. The API returns only the validated confirmation URL and local payment reference.
6. Redirect completion does not settle the order.

### Settlement or cancellation

1. A webhook or reconciliation claim supplies a provider object ID as a signal.
2. The adapter fetches the current object with merchant authentication.
3. Redundant provider facts are compared to the durable local mapping.
4. A verified event enters the existing canonical PostgreSQL inbox.
5. Existing settlement/reversal transactions own residency, referral reward, credit,
   debt, audit, and outbox changes.

### Refund

1. An approved internal refund command determines the refundable cash amount.
2. PostgreSQL assigns and persists the refund idempotency key and request digest.
3. The adapter creates the refund and records its provider ID.
4. Webhook/reconciliation authoritatively confirms the refund.
5. The existing reversal path applies canonical local effects exactly once.

## 6. Failure handling

- Malformed provider JSON, invalid authority-bearing fields, ID/amount/
  currency/environment mismatch, and unsupported status fail closed.
- Connection loss after POST is `unknown`, never `failed`; reconciliation precedes any
  further financial mutation.
- Provider 401/403 disables provider calls and emits a bounded credential incident.
- Provider 429/5xx uses bounded backoff through existing worker scheduling; request
  handlers do not loop.
- Webhook source mismatch or untrusted forwarding metadata is rejected without an API
  call and without revealing whether a provider object exists.
- Database failure prevents webhook acknowledgement so YooKassa may retry delivery.

## 7. Verification

Development uses TDD and one focused Claw run per completed test target. A passing first
run is not repeated. Verification covers:

- exact request method/path/headers and secret redaction;
- stable idempotency and body-digest replay;
- integer money conversion and mismatch rejection;
- strict request and notification-envelope parsing plus minimized payment/refund response parsing;
- webhook IP/proxy boundary and authoritative API re-read;
- timeout/429/5xx unknown outcomes and deterministic 4xx handling;
- test/live cross-mode rejection;
- fiscal configuration fail-closed behavior;
- duplicate webhook and concurrent reconciliation idempotency on PostgreSQL;
- default-off composition and zero network calls while disabled;
- scope guards proving no YooKassa SDK, Python runtime, wallet API, or sandbox package
  enters the native production dependency boundary.

The later activation gate requires a YooKassa test shop, contract fixtures captured
without secrets or personal data, payment/refund/receipt webhook evidence, daily registry
reconciliation, and an independent security/financial review.

## 8. Non-goals for the first increment

- live merchant activation or real-money operations;
- storing merchant credentials in Git, evidence, BMad artifacts, or prompts;
- card-data collection, embedded card forms, PCI DSS card handling, saved payment methods,
  recurring payments, payouts, invoices, split payments, or OAuth partner APIs;
- choosing the legal entity, VAT code, fiscal receipt scenario, or chargeback policy;
- treating YooKassa history or email registries as PostgreSQL financial authority;
- reusing the personal YooMoney Wallet API or the suggested Python library.

## 9. Open activation inputs

These inputs do not block code implementation but keep staging/live disabled:

1. YooKassa test and live shop identifiers and secret keys from approved secret storage.
2. Contracting legal entity and accountant-approved 54-FZ receipt scenario, VAT code,
   payment subject, and payment mode.
3. Customer receipt contact policy and privacy/retention approval.
4. Merchant-account webhook configuration and trusted nginx effective-client-IP setup.
5. A sample official daily operations registry and approved import/reconciliation process.
6. YooKassa-documented chargeback/dispute operational contract applicable to the merchant.

## 10. Official references

- YooKassa interaction format, authentication, idempotency, and request handling:
  <https://yookassa.ru/developers/using-api/interaction-format>
- YooKassa API reference: <https://yookassa.ru/developers/api>
- YooKassa incoming notifications and authenticity checks:
  <https://yookassa.ru/developers/using-api/webhooks>
- YooKassa test shop behavior:
  <https://yookassa.ru/developers/payment-acceptance/testing-and-going-live/testing>
- YooKassa 54-FZ options:
  <https://yookassa.ru/developers/payment-acceptance/receipts/54fz/basics>
- YooKassa operations registries:
  <https://yookassa.ru/docs/support/merchant/payments/reports/overview>
- Rejected wallet client: <https://github.com/AlekseyKorshuk/yoomoney-api>
