# Block B exact scope registration — 2026-10-23

Authority: [Block B contract](../superpowers/implementation-artifacts/spec-phase1-block-b.md)
and [execution contract](../superpowers/implementation-artifacts/spec-phase1-through-phase2-execution.md).
Registrations describe local manager verification and a purpose-bound onboarding fee.
They grant no provider call, production activation, shared migration, release or
residency/referral settlement authority.

## Exact inventory

Five relations are added to both exact database/residency inventories:

- `expert_verification_decisions`: authenticated manager decisions with immutable replay/audit facts.
- `expert_onboarding_invoices`: approved decision-bound 300000-kopeck RUB onboarding fee.
- `expert_onboarding_payment_operations`: invoice/owner/purpose/amount/mode/provider binding.
- `expert_verification_work`: ID-only bounded work and inactive content slots.
- `expert_onboarding_payment_facts`: verified payment fact and interview/blocked admission only.

The existing application table gains unique `(id,user_id)` and an identity/quote
immutability trigger. This does not create expert records, residency intervals,
first settlement markers, qualified referral rewards or coupon credit.

The exact authenticated manager routes are:

- `/v1/admin/expert-verification`
- `/v1/admin/expert-verification/:applicationId`
- `/v1/admin/expert-verification/:applicationId/decision`
- `/v1/admin/expert-verification/invoices/:invoiceId/checkout`

All use the existing admin session/MFA/role authority. Route registration does not
certify authorization or activate missing checkout dependencies.

Two exact integration modules are added: `yookassa/onboarding-verifier.ts` and
`yookassa/onboarding-webhook-capability.ts`. Their content and changed public barrel
are pinned to literal normalized SHA256 values. The narrow verifier performs GET
and stored purpose/binding checks with a private proof brand; no generic residency
mint, provider SDK, network-target allowance or sibling-module exception is added.

## Hand-authored SQL and metadata

SQL0053 adds exactly three functions:
`enforce_expert_application_identity_immutable`,
`enforce_expert_verification_decision_source`, and
`enforce_expert_verification_immutable`.
Nine exact triggers are added to the history inventory, including the existing
application-table identity guard. The newest snapshot becomes 0053; table count
advances 130 to 135. Historical snapshot gaps and the BigInt-default list remain
unchanged. SQL and its snapshot/catalogue/manifest plus journal have literal hashes.

Environment preflight with `-RequireDocker` passed (Node 24.22.0/pnpm 11.9.0).
All 54 journal migrations replayed on a separate disposable `promo_state_0053`
database in the task-owned PostgreSQL 17.5 Compose instance. Connection settings
were parsed only in memory from the protected recovery configuration; stale Docker
environment credentials were never read or used and credentials/URLs were never
printed, copied or committed.

Fresh empty-directory `drizzle-kit introspect` 0.31.10 produced the supported
snapshot, normalized from exact positional constraint/index catalogue reads.
Readback captured 135 tables, 46 functions, 84 triggers, 903 constraints, 373 indexes
and 2 extensions. Every 0052 catalogue object is retained unchanged; the existing
application snapshot changes only by the authorized composite unique constraint.
The new snapshot links to 0052. The reconstruction database and temporary
introspection directory were removed; functional-test databases were untouched.
Diagnostic helper/log remain ignored under `.superpowers/sdd/phase1-block-b-state/`.

## Verification

Exact artifact/input hashes and snapshot linkage passed. After the lead staged
all approved Block B source, metadata and tests, scope passed 123/123 at 15:14:48 UTC
and migration history passed 8/8 at 15:14:55 UTC in separate single-file invocations.
Scoped guard/history ESLint, formatting and whitespace passed. No functional or
PostgreSQL test file was invoked by the metadata/guard owner.
No classifier, unknown-import rule, internal mint boundary, negative probe,
provider allowance or historical gap is weakened. Local reconstruction and static
checks do not establish external merchant delivery or exact-SHA release acceptance.

## Finite manager authentication review correction

Independent review found that SQL decision-source admission lacked explicit finite
expiry/MFA bounds. The storage owner added NULL/nonfinite rejection before the
existing fresh-clock checks. The metadata owner repeated the full 54-migration
reconstruction in a separate disposable database, captured the actual corrected
function definition, and removed that database. The supported snapshot and object
inventory are unchanged; the SQL, function catalogue and manifest hashes are
updated. Every prior 0052 catalogue entry remains unchanged. No functional test was
run by this owner. After staging the reviewed correction, the authorized scope-only refresh passed
123/123 at 15:31:31 UTC. History was not rerun: its inventory is unchanged and
the earlier 8/8 remains applicable to those unchanged assertions.

## Final staged staff interface inventory

The first scans preceded the new staff interface and native Nginx edge-test files
being tracked. After the lead staged those reviewed files, the final scope-only
scan passed 123/123 at 15:42:17 UTC. No extra path registration or classifier change
was required. History was not rerun. This static result does not substitute for
the interface/edge functional evidence recorded by their owners.
