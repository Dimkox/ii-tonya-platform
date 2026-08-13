# Sprint Change Proposal: select YooKassa

Status: approved by product owner on 2026-08-13
Scope: moderate provider substitution
Requirement: `PAY-PROV-001`

## Issue summary

The product owner selected YooKassa by YooMoney instead of the previously considered
T-Bank payment integration. The immutable source export does not name either provider;
the authoritative normalized requirements therefore record the decision without
rewriting the audit snapshot.

## Impact analysis

- Product intent and payment-domain invariants are unchanged.
- New payment-provider contracts, fixtures, adapters, runbooks, and environment keys
  must target YooKassa only.
- Existing provider-neutral domain, ledger, idempotency, settlement, refund, and
  reconciliation boundaries remain valid.
- The sandbox payment provider remains the only executable payment environment until
  the YooKassa contract and merchant setup pass their release gates.
- No live payment, credential, webhook, staging, or production activation is authorized
  by this document change.

## Approved adjustment

1. Add `PAY-PROV-001` to the authoritative normalized requirements.
2. Replace the unresolved provider-selection question in the architecture with
   YooKassa-specific contract and legal-entity approval gates.
3. Retain the immutable source export and its existing SHA-256 for audit traceability.
4. Create a separate implementation story for the YooKassa adapter only after exact
   merchant, API, webhook, fiscalization, refund, chargeback, reconciliation, sandbox,
   security, and operational contracts are available.

## Handoff and acceptance

- Product owner: confirms YooKassa and the contracting legal entity.
- Architect/security: approve the versioned YooKassa contract and secret boundary.
- Developer: implement behind the existing default-off provider port using TDD.
- Release owner: require sandbox evidence, reconciliation, rollback, telemetry, and an
  explicit activation approval before staging or production.

This course correction is complete when the base specification and architecture agree
on YooKassa while all live-provider gates remain fail-closed.
