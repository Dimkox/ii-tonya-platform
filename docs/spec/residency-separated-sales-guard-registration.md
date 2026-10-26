# Separated residency sales boundary registration

Spec: `docs/superpowers/implementation-artifacts/spec-residency-separated-sales.md`.
The new cohort is `expert_separated_sales_v3`; existing v1/v2 inputs and historical
migrations are unchanged. Migration 0059 is hand-authored. Its complete normalized
snapshot, SQL-only function/trigger/constraint/index catalogue and input manifest
come from replay on the existing isolated PostgreSQL 17.5 development cluster.
Schema generation remains prohibited.

The exact new database relations are `expert_sales_bases`, `expert_sales_choices`,
`expert_sales_selections`, `expert_sales_form_bridges`, `expert_sales_fee_attempts`,
`expert_sales_paid_locks`, `expert_sales_recovery_work`,
`expert_sales_provider_requests`, `expert_sales_provider_observations`,
`expert_sales_notices`, `expert_sales_ticks`, `expert_sales_erased_cohorts` and the
canonical application view `resident_sales_application`. The view retains the
existing form identity and projects the required base, choice, expiry and nullable
paid-price fields. SQL guards bind quote/order snapshots to the selected paid lock;
the original publication, manager MFA, card, promo and main payment gates remain.

`packages/integrations/src/yookassa/held-onboarding.ts` is the only new reviewed
provider transport. It uses the fixed official API origin, exact persisted bodies,
UUID idempotency, explicit bank-card two-stage requests, GET-branded observations,
strict amount/mode/object/metadata validation and bounded response bytes/lifetime.
It does not read credentials from environment variables. Adjacent paths, altered
origins, credential reads and unregistered relations remain denied by negative
probes. The two exact new default-off flags are `EXPERT_SEPARATED_SALES_ENABLED`
and `EXPERT_ONBOARDING_HELD_ENABLED`. Worker activation also requires reviewed held
capabilities; it cannot silently use a legacy automatic-capture implementation.

Recovery is observable through immutable onboarding payment facts, explicit
`expert_sales_recovery_work`, dispatched/observed provider custody, and scoped
notice receipts. Unknown requests are reconciled by GET; they are never blindly
reposted. A missing provider object after an ambiguous create requires external
operator evidence of the object identity before reconciliation can continue.
Refund-review work does not execute refunds or grant access.

Erasure scrubs routing, request metadata, delivery receipts and encrypted receipt
request bodies, removes uninvoiced/unquoted sales rows, and retains only opaque
campaign tombstones and necessary financial bindings when issued records exist.
Deleting the original submitted form also blocks delayed money from readmitting
the applicant. No provider activation, deployment, live money or prompt activation
is authorized by this development change.

Review corrections add only migration `0060_separated_sales_review_corrections.sql`,
its exact `0060_snapshot.json`, `0060_sql_objects.json`, and `0060_manifest.json`,
and relation `expert_sales_operator_recoveries`. The new manager route is
`POST /v1/admin/expert-verification/invoices/:invoiceId/recover`; the existing
finite session/MFA authority is checked both before and after the authoritative
GET. The audit binds the manager, session, invoice, provider object, request key,
status and GET evidence digest. It cannot authorize another create POST.

The private applicant `/receipt` command uses the existing encrypted receipt
store and configured finite retention. Only a v3 bridge with its unchanged
submitted form and current owner/consent can outlive the original operational
quote deadline for receipt custody. Legacy quote expiry rules remain intact.
Frozen submission digest/time are separate from supplemental answer revisions.
Actual 0059 form deletion cascades the bridge; upgrade evidence does not invent
historical submission proof. Notice preparation is leased and retryable before a
Telegram send; persisted dispatched remains uncertain and is never blindly resent.
Notices bind the producing selection, choice revision and replacement invoice.
