# Phase 0 YooKassa test readiness

Local connector verification supports `payment.waiting_for_capture`. This event
represents held funds; it creates no paid entitlement, settlement event or automatic
capture. The notification body supplies only the lookup ID. An authenticated GET
must match the stored provider ID, order metadata, amount, RUB currency and test
mode. Pending, unpaid holds, unavailable GETs and mismatches remain retryable.

A delayed hold notification may find an authoritative succeeded or canceled payment.
After the same binding and terminal consistency checks, it is acknowledged without
minting a canonical event or modifying the operation. A separate terminal signal or
reconciliation retains responsibility for settlement/cancellation. Duplicate inbox
notifications acknowledge without repeating verification. Existing succeeded and
canceled behavior remains separate.

## Local profile

`phase0-yookassa-test.env.example` contains placeholders, `YOOKASSA_MODE=test`, and
disabled payment, provider and unbound-recovery flags. It is a fragment to combine
with the normal `.env.example` configuration in an ignored, protected local file;
it is not a complete runtime configuration. Do not copy the primary checkout's
`.env`, print values, commit merchant settings, or use live merchant credentials.
The owner already has a test merchant and supplies settings through protected local
configuration. No merchant/API requests or webhook registration were performed.

## External activation gates

For a separately authorized test session, supply the test merchant ID and test
credential through the configured protected secret boundary, together with the
return URL, receipt/contact policy and recovery configuration required by environment
validation. Confirm the merchant is a test merchant and retain `mode=test`. Review
feature ceilings and receipt consent before explicitly selecting `PAYMENT_PROVIDER`
`yookassa` and enabling both payment/provider flags in that isolated environment.
Do not enable unbound recovery implicitly.

Expose the reviewed HTTPS webhook endpoint with trusted effective-peer handling;
register the supported payment events in the test merchant's notification settings.
Record authoritative GET, held-funds/no-entitlement, separate settlement/cancellation,
duplicate delivery and retry evidence against the exact source SHA. No deployment,
production enablement, real capture, release approval or provider evidence follows
from the local tests. Keep all flags disabled until those external gates are met.

## Local evidence

Environment preflight passed with Node 24.22.0 and pnpm 11.9.0. Verifier and
capability test files each ran once RED (new capture-wait cases failed), then once
GREEN: 15 and 13 tests respectively. A third focused run after independent review
strengthened terminal-consistency and real-verifier fail-closed coverage; both files
passed 16 tests. Their three-run budgets are exhausted. API webhook regression ran
once GREEN: 11 tests.
The latter verifies zero deliver/resolve calls on capture wait, stripped spoofed
body fields, completed duplicate handling and sanitized retryable failure. Tests
use in-process fixtures; they establish no provider or database execution evidence.

Provider semantics were checked by the coordinator against the official
[notification documentation](https://yookassa.ru/developers/using-api/webhooks) and
[payment process](https://yookassa.ru/developers/payment-acceptance/getting-started/payment-process).
