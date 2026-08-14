# YooKassa provider runbook

Status: **BLOCKED**. This runbook is an activation and recovery checklist, not permission
to activate YooKassa.

## Current boundary

The repository contains a default-off YooKassa Merchant API client, adapter, verifier,
PostgreSQL operation mapping, webhook seam, and worker reconciliation seam. The API and
worker default composition supplies no merchant capability. Credentials are empty
placeholders and `YOOKASSA_ENABLED=false`; do not add a credential, enable a flag, or
deploy while hoster maintenance is active.

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
- For a timeout, 429, or 5xx, classify the operation as unknown and re-read the exact
  provider object before any retry or settlement/reversal delivery.
- Treat webhook content as a signal: validate it, use trusted nginx peer information,
  then perform the authenticated authoritative read before durable delivery.
- For a credential incident, disable the feature, rotate only through the approved secret
  owner, preserve sanitized correlation evidence, and require new approval before enable.

## Evidence links

- [Design](../superpowers/specs/2026-08-14-yookassa-provider-design.md)
- [Traceability](../spec/yookassa-provider-traceability.md)
- [Provider staging record](provider-staging-evidence.md)
- [Go-live record](go-live-evidence.md)
- [Native production deployment](native-production-deployment.md)
