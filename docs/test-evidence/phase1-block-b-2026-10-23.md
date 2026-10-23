# Phase1 Block B local verification ledger

Status: implementation in progress; shared raw-timestamp production defect found in
first integrated run. No Block B completion/release claim. Baseline:
`e880246f641ede57b4ab0512dccbd1031226dacb`.

## Implemented boundary

Manager API uses existing bearer-session digest, original PostgreSQL admin sessions,
MFA and support/security roles. Masked queue and protected contact detail have typed
inactive questionnaire content. Decisions are audited/idempotent and lock the
accepted campaign quote against later replacement.

An approval creates a distinct300000-kopeck onboarding invoice and preallocated
operation with immutable owner/application/purpose/mode/amount binding. Neither is
an expert residency order. Narrow authoritative GET verification creates a frozen
private proof; no generic mint is exported. Settlement rechecks stored purpose and
bindings and opens interview only. No expert activation, residency interval,
first-residency marker, referral grant, coupon or message-credit mutation follows.

Existing merchant webhook authentication/inbox is preserved. Stored onboarding
objects route through the actual GET verifier and PostgreSQL settlement; unknown
successes stay retryable until binding, and refund IDs are never treated as payment
IDs. Manager/new-checkout disablement does not disable existing payment truth.

Checkout requires complete injected strict-cancellation custody, authoritative GET,
connected merchant callback and invoice-bound recovery. Recovery never calls blind
initial creation from this service or repeats a manager decision. No production
first-disclosure lease exception, transport activation or fake checkout URL exists.
Actual live first-send custody/recovery remains an external enablement gate.

Financial rows retain immutable audit UUIDs but nullable live application references.
Erasure can physically remove applicant data; late verified payment/receipt facts
are retained without recreating an application or access. Source review caught and
fixed the protected-detail read/erasure race before integrated execution.

## Bounded execution facts

- New verifier unit32/32; webhook capability11/11. Real fixed-origin client decoder,
  malformed GET/bindings, private proof/copy rejection and proper refund IDs tested.
- New manager service13/13; manager HTTP9/9; merchant routing5/5. Relevant failing
  regressions preceded corrections for recovery, early binding and authority fields.
- New config24/24; standard package-loader composition16/16, including actual
  class composition, recovery completeness and existing-payment-only mode.
- New `tests/integration/phase1-verification.test.ts` invocation1 consumed:
  **21failed and one unhandled rejection**, exit1,15:13:51UTC. Log:
  `/tmp/phase1-b-verification-pg1.log`. Fresh rotated-role authentication and all
  migrations succeeded; failures were shared manager bootstrap before downstream
  acceptance. No payment/erasure authority acceptance is inferred from that run.
- Root cause confirmed in installed Drizzle node-postgres adapter: raw SQL
  TIMESTAMPTZ values are strings, while new repository code assumed `Date` and
  called `.getTime()` in manager and payment-time checks. Production SQL authority
  correction plus a separate non-PG real-row-shape regression is in progress.
- New PG file has **two invocations remaining**, final3 reserved after review.
  No immediate repeat, skipped case, fake green or old exhausted test is allowed.
- B scope123/123 and history8/8 passed first invocation each. Metadata replayed all
  54 SQL files on a separate PostgreSQL17.5 database:135tables,46functions,
  84triggers,903constraints,373indexes,2extensions. All prior objects preserved.
  Exact guard/artifact evidence: `docs/spec/phase1-block-b-guard-registration.md`.

## Local credential containment

A child accidentally printed the disposable database Compose configuration. Parent
rotated only that local role/password and private file; old authentication was
proven rejected. No customer/provider credential or repository secret was involved.
The original tool output cannot be erased, but its credential no longer works.
All future invocations parse the current private configuration in memory and never
use stale container environment or print/copy its values. See coordinator evidence.

No full/multi-path/exhausted A/provider suite, provider call, push, deployment or
live flag change. C/D/Phase2 remain required after the Block B predecessor gate.
