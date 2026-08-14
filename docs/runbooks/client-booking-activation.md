# Client Booking Activation Gate

Status: **BLOCKED**. This note is evidence metadata, not activation or deployment approval.

## Current safe posture

- `CLIENT_BOOKING_ENABLED=false` and `CLIENT_BOOKING_RESERVE_ENABLED=false` are the required
  defaults; neither flag exists or is enabled at this documentation commit.
- The approved client-principal change is not merged into `origin/main` at base `3db7ad1`.
- No Security-approved issuer/verifier for `client_booking:write` is recorded.
- `PLANERKA_ENABLED=false` and `TELEGRAM_ENABLED=false`; no live booking or notification contract
  is approved by this story.
- No code, migration, test, Claw, provider, network, deployment, or production mutation was run.

## Required approvals and evidence

| Gate | Owner | Required evidence | Current result |
| --- | --- | --- | --- |
| Public contract | Product | named approval of opaque handles, public states, `404|409`, reserve/cancel behavior | absent; blocked |
| Principal prerequisite | Platform/Security | merged principal implementation and exact SHA with fresh active-user resolution | absent; blocked |
| Booking write authority | Security | named issuer/verifier, `client_booking:write` proof, scope separation, expiry/revocation and raw-header evidence | absent; blocked |
| Protected mapping | Catalog/DB | owner binding, 24-hour expiry/erasure, v1/v2 compatibility and no-ID serialization proof | not executed; blocked |
| Transaction safety | Booking/DB | real-PG concurrency, lock-order, reserve/retention/erasure and cancel/expiry/expert race evidence | not executed; blocked |
| Privacy | Privacy/Security | fenced booking-local phase, lease/crash/dead-letter recovery, retained handles, and identifier absence | not executed; blocked |
| Interface review | Independent reviewer | zero unresolved Critical/Important findings with file/line evidence | PASS for docs: 0 Critical/0 Important; not Security activation approval |
| Focused gate | Verification | one immutable `client-booking` Claw invocation, exact clean SHA, external PostgreSQL 17.5 assertion, counts/cleanup, `repeat_limit: 1` | not run; blocked |
| Provider activation | Provider owners | authenticated Planerka and Telegram contracts, credentials, staging/reconciliation evidence | explicitly outside slice; blocked |
| Deployment | Deployment owner | separate target authorization and immutable release/rollback evidence | absent; blocked |

## Implementation and verification sequence

1. Merge the principal prerequisite, rebase the booking branch, inspect the journal, and allocate
   the next actual migration after principal.
2. Obtain Product approval of the frozen public contract before implementation completion.
3. Implement default-off protected choices and booking commands with TDD. A focused suite stops
   permanently after its first success; successful suites are not rerun.
4. Obtain independent interface/security review and close every Critical and Important finding.
5. Run exactly one `run-claw-ci.sh client-booking` invocation at the reviewed clean SHA with the
   approved external PostgreSQL variable. The adapter asserts version 17.5 without printing the
   URL. A pass ends the gate; a failure is terminal evidence without a second run.
6. Record named Security approval for the live write-authority source. Keep provider flags false.
7. Obtain separate deployment authorization before any target mutation.

## Rollback and recovery

Set `CLIENT_BOOKING_RESERVE_ENABLED=false` first so no new reservation is accepted while owner
cancel and the existing expiry worker remain available. Keep PostgreSQL authoritative; do not
delete or rewrite migration, choice, receipt, reservation, audit, or outbox history. Confirm all
in-flight reserve outcomes from the protected receipt/reservation transaction, then reconcile
active reservations and pending outbox locally without enabling Planerka or Telegram. Disable the
whole booking route family only after active clients have an approved cancellation/recovery path.
Restore service only from an immutable reviewed configuration and new Product/Security/deployment
decisions. No command in this runbook grants production authority.
