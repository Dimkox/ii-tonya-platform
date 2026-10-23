# Block D exact scope and state registration — 2026-10-23

Authority: [Block D contract](../superpowers/implementation-artifacts/spec-phase1-block-d.md)
and [execution contract](../superpowers/implementation-artifacts/spec-phase1-through-phase2-execution.md).
This registration covers local calendar lifecycle, explicit renewal and durable notice
work. It grants no provider call, automatic charge, production activation, shared
migration or release authority. Settled residency intervals remain paid-time authority;
pause consumes existing calendar time and grants no extension or banked credit.

## Exact inventory

Five relations enter both residency/database inventories:

- `expert_residency_lifecycle`
- `expert_residency_renewal_bills`
- `expert_residency_lifecycle_audits`
- `expert_residency_lifecycle_notices`
- `expert_residency_renewal_attempts`

Four new SQL functions and four triggers are explicitly listed in the exact history
inventories. Existing functions are unchanged; paid coverage is a separate new
`expert_residency_current_coverage` function. The only existing constraint change
extends `expert_card_request_operation` with `residency_pause` and `residency_resume`,
retaining its COALESCE-false guard. Both lifecycle and prior card schema mirror the
actual constraints. SQL triggers preserve immutable attempt history and original
invoice ownership across explicit expired-order recovery.

Four exact default-off flags are registered without widening the classifier:
`EXPERT_RESIDENCY_LIFECYCLE_ENABLED`, `EXPERT_RESIDENCY_LIFECYCLE_COMMANDS_ENABLED`,
`EXPERT_RESIDENCY_NOTICE_DELIVERY_ENABLED`, and
`EXPERT_RESIDENCY_RENEWAL_CHECKOUT_ENABLED`. Existing work-bot ingress is reused;
no new HTTP route or integration sibling exception is needed.

## Actual PostgreSQL state

Frozen SQL0055 SHA256:
`ff08821bc86ffb3157fa759419251dbb5e68167629cf8e1d8114826e42be74d1`.
All 56 journal migrations replayed on separate disposable `promo_state_0055` in the
task-owned PostgreSQL 17.5 instance. Protected current recovery settings were parsed
only in memory. No Docker environment values, credential copies, printed URLs,
functional PG files or shared fixture database mutations were involved.

Fresh empty-directory introspection 0.31.10 was normalized against live positional
constraints/indexes. Readback contains 155 tables, 67 functions, 109 triggers,
1057 constraints, 418 indexes and 2 extensions. Every prior function, trigger, index,
extension and exclusion remains unchanged. The only prior constraint delta is the
explicitly authorized card request-operation extension; the only prior table
projection change is `public.expert_card_requests`. Snapshot linkage points to 0054.
The SQL, supported snapshot, exact catalogue, manifest and journal receive literal
normalized-content hashes; newest snapshot 55 and table count 155 are pinned.
Historical gaps, BigInt-default baseline and classifier logic are unchanged.

The temporary database and introspection directory were removed after capture;
ignored diagnostics remain under `.superpowers/sdd/phase1-block-d-state/`.
Four inactive pending content slots create no delivery success or approved content.

## Verification

Schema scoped lint/format and DB typecheck passed. Input/artifact hashes and exact
prior-state deltas were independently compared before staging. After the lead
staged final source, fixtures and metadata, first D scope passed 123/123 at 19:15:55 UTC
and first D history passed 8/8 at 19:15:56 UTC in separate single-file invocations.
Each D guard ran once, with no retries. No functional test was invoked by this owner.
Static/metadata evidence does not establish provider delivery or release acceptance.
