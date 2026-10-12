# YooKassa provider runbook

Status: **BLOCKED**. This runbook is an activation and recovery checklist, not permission
to activate YooKassa.

## Observed configuration and composition — 2026-10-12

Local project .env has merchant/fiscal values whose pure configuration-schema
check passes in live mode. The dedicated production runtime.env does not have
those YooKassa values populated. Receipt contact purpose/policy are empty in both
inspected locations. No merchant authentication or provider request was performed;
do not use the live keys for synthetic test payments. These observations supersede
any assumption below that no merchant credentials exist anywhere.

Default API/worker provider composition, verified receipt capture and bound
pending-operation reconciliation remain incomplete. The existing terminal-payment
audit reader is not pending-payment recovery. Current receipt-authority correction
addresses later consent withdrawal and saved campaign payer identity; it does not
choose the missing policy, contact source or encryption key.
See `../operations/2026-10-12-yookassa-runtime-gap.md` for exact scope and next proof.

## Current boundary

The repository contains a default-off YooKassa Merchant API client, adapter, verifier,
PostgreSQL operation mapping, webhook seam, worker reconciliation, consent-bound receipt
contact boundary, and encrypted exact-body recovery runtime. The API and worker default
composition supplies no merchant capability or recovery key resolver. Credentials and
recovery-policy inputs in versioned examples are empty placeholders and
`YOOKASSA_ENABLED=false`; do not add a
credential, enable a flag, or deploy while hoster maintenance is active.

Production is native: systemd API and worker services, the single existing system
PostgreSQL database, and nginx/TLS. There are no production containers. Claw uses a
constrained development/test container to simulate that server; direct Claw CI and
Database Gate are the executable repository gates, and GitHub Actions are not used.

## Activation prerequisites

All items require named owner and independent review before a separate activation change:

1. Approved YooKassa Merchant contract, test shop, and legal entity; do not use the
   personal YooMoney Wallet API or a T-Bank integration.
2. Approved fiscal/receipt configuration, refund and chargeback policy, and data terms.
3. Nginx peer-address trust configuration and a provider-connected webhook exercise.
4. Test-shop evidence for create/read/refund, duplicate delivery, timeout/unknown outcome,
   mode separation, and daily registry reconciliation.
5. Confirmed secret owner and reference-only secret rotation procedure. Never put a value
   in docs, Git, evidence, or logs.
6. Successful exact-SHA direct Claw gates, provider staging `PASS`, go-live `GO`, and
   explicit production authorization after maintenance ends.

## Safe recovery

- Keep the feature off to stop new provider calls; do not delete provider mappings,
  inbox records, orders, or financial audit records.
- For a timeout, 429, or 5xx, classify the operation as unknown. If a provider object ID
  was durably bound, re-read that exact provider object before settlement/reversal
  delivery or another mutation.
- An unbound unknown outcome cannot be found through payment-history scanning. The
  default operator path remains a user-command retry with the same idempotency key and
  exact request body. Never infer provider absence, scan payment history, or create a new
  idempotency key.
- The repository contains a default-off bounded worker that can replay only the encrypted
  exact original body with its original key, AEAD operation context, active lease, and
  fenced completion. It binds the recovered provider object as pending; authoritative
  GET verification and canonical delivery still own settlement or reversal.
- Autonomous recovery remains **BLOCKED** until an independently reviewed key-reference
  resolver, approved purpose/policy/retention/window values, provider idempotency-window
  evidence, and test-shop evidence are supplied. Empty inputs perform no crypto or
  provider I/O.
- Treat webhook content as a signal: validate it, use trusted nginx peer information,
  then perform the authenticated authoritative read before durable delivery.
- For a credential incident, disable the feature, rotate only through the approved secret
  owner, preserve sanitized correlation evidence, and require new approval before enable.

## Unresolved activation placeholders

Keep these values empty in versioned examples. They are decisions or secret references,
not defaults, and any empty value keeps receipt delivery and unbound recovery disabled:

```dotenv
YOOKASSA_RECEIPT_CONTACT_CONSENT_PURPOSE=
YOOKASSA_RECEIPT_CONTACT_POLICY_VERSION=
YOOKASSA_RECOVERY_ENCRYPTION_KEY_REFERENCE=
YOOKASSA_RECOVERY_RETENTION_DAYS=
YOOKASSA_UNBOUND_RECOVERY_ENABLED=
YOOKASSA_UNBOUND_RECOVERY_WINDOW_HOURS=
```

## Evidence links

- [Design](../superpowers/specs/2026-08-14-yookassa-provider-design.md)
- [Traceability](../spec/yookassa-provider-traceability.md)
- [Provider staging record](provider-staging-evidence.md)
- [Go-live record](go-live-evidence.md)
- [Native production deployment](native-production-deployment.md)
