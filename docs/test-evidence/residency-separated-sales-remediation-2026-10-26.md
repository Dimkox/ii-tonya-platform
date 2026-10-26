# Separated sales review remediation

Remediation baseline: `8233da05a45e2f5d7b4c9491bf7877b79ca760dc` on
`codex/separated-residency-sales-20261026`. The approved spec remains in-review.
This is one correction batch for R1–R14 in the coordinator-owned independent
review. No push, deployment, live provider request, real payment or prompt
activation was performed. Final independent closure and exact-commit gate belong
to the coordinator.

## Corrections

| Findings | Implemented behavior                                                                                                                                                                                                                                                                                                                                   |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| R1–R2    | Private applicant `/receipt` captures email through the existing encrypted finite-retention store. Current owner, consent, v3 bridge and frozen submitted form authorize fiscal custody after the original operational quote expires. Legacy quote expiry and redaction remain unchanged. Normal server composition supplies the configured vault.     |
| R3–R5    | Submitted draft digest/time and original submission work identify the frozen form; supplemental revisions do not invalidate approval or capture. First approval uses the latest explicit period within the same base/form. Expired monthly selection refreshes transactionally before bridging. Expired quarter requires explicit monthly reselection. |
| R6       | Existing admin ingress exposes a bounded recovery request with fresh MFA checked before and after actual provider GET. Immutable audit binds manager/session/request/invoice/object/status/evidence. Unknown creates cannot be blindly reposted.                                                                                                       |
| R7–R8    | Unresolved provider requests prevent replacement; each scheduler owner has an isolated transaction. Authoritative canceled GET resolves an unknown capture as cancelled, preserving the distinction from successful capture and permitting valid replacement.                                                                                          |
| R9–R11   | Leased preparation can retry before Telegram sends; persisted dispatched remains uncertain. Current choice/selection/invoice bindings cancel obsolete work and deduplicate each replacement notice.                                                                                                                                                    |
| R12–R14  | Actual form copy and tariff help are versioned for sales-first. Current-tariff action shows current selected amount, deadline, remaining seconds and only an eligible fixed 3000 ₽ checkout link. Stage notices show exact current/new main amounts and deadline, with no pre-positive promotion or pre-approval invoice.                              |
| R13      | Actual local HTTP faults cover lost capture success/cancellation and lost cancel acknowledgment; normal held composition receives waiting/canceled Fastify webhooks. Actual worker parser rejects foreign bot/chat receipts and accepts matching receipts.                                                                                             |

Migration0060 is additive. Actual0059 form deletion cascades its bridge; the
upgrade test proves that erased owners do not regain proof and that existing
submitted forms with supplemental revisions remain valid. The initial assumption
that0059 retained an erased form's bridge was disproved by the retained upgrade
runs; no impossible row was fabricated. New bridge inserts require genuine proof.
The SQL replay state contains189 tables,105 functions,157 non-internal triggers,
1293 constraints,490 indexes and2 extensions. Exact artifacts and the single new
audit relation/admin route are registered; adjacent namespaces remain denied.

## Verification

All PostgreSQL checks used the existing protected PostgreSQL17.5 development
cluster; no additional cluster or credentials in output. Time-expiry fixtures
suspend and restore only named immutable clock triggers, then execute the guarded
real transitions. Provider tests use loopback HTTP and ephemeral test encryption.

| Check / raw stem                                  | Result                                                                                                                            |
| ------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `state-final1`                                    | 32/32; financial state, privacy, expiry, recovery, scheduler, actual held webhooks and worker receipt parsing                     |
| `composition-final1`                              | 4/4; normal private receipt/current-tariff ingress, initial main invoice, automatic and explicit renewal including retired tariff |
| `upgrade-final`                                   | 1/1; actual0059 SQL replay with submitted/followup and erased owners, then0060                                                    |
| `legacy-receipt`                                  | 4 passed/4 intentionally skipped; existing private capture/replay, redaction, foreign/tampered/expired capture and cleanup race   |
| `form-copy-final`                                 | 17/17; legacy form behavior plus versioned sales-first tariff help                                                                |
| `boundary-final`                                  | 8/8; exact migration/state hashes and negative scope probes                                                                       |
| `migration-history-final2`                        | 9/9; journal/snapshots/explicit SQL inventory/schema declarations                                                                 |
| `scope-final`                                     | 130/130; tracked scope classifier                                                                                                 |
| `db-build2`, `application-final`                  | ESM and declaration builds successful                                                                                             |
| `api-types2`, `worker-types`, `tests-types-final` | Actual API/worker/tests typechecks exit0                                                                                          |
| `lint-final`, `format-final`, `diff-check-final`  | Changed-file lint/format and whitespace checks successful                                                                         |

The initial RED files are retained: normal receipt ingress, three submission/period
regressions, scheduler failures, and versioned tariff-help copy. Intermediate
failures remain visible, including a wrong migration constraint name, old built
application output, synthetic clock/duplicate-provider-ID fixtures, Fastify test
resolution, a mistaken erased-bridge expectation, import typo, exact boundary
registrations and trigger-inventory ordering. `api-types1` says no projects matched;
it is explicitly **not** typecheck evidence. `api-types2` ran the actual API package.

Raw `.log` captures remain in `.superpowers/sdd/separated-sales-review-20261026`.
The durable archive is `docs/test-evidence/residency-separated-sales-remediation-2026-10-26/raw`.
Its manifest records original capture length/hash separately from the archived
file's terminal marker. Two captures containing trailing spaces are archived
losslessly as labelled base64 (`boundaries` and `scheduler-green1`); the literal
local logs remain unchanged. Failed logs were not overwritten or represented as green.

## Remaining release boundaries

The implementation is ready for coordinator closure; independent review and the
exact-commit final gate are not asserted by these local checks. Existing default-off
flags, receipt key configuration, reviewed provider capabilities and environment
activation requirements still apply. Unknown-create recovery requires a real
provider object identifier supplied by an authorized operator and verified by GET.
Recovery facts do not execute refunds or grant access.

## R3 bounded closure follow-up

The bounded review of425b58ee accepted the other review groups and found one
remaining0059 upgrade order: submit, add a supplemental answer, enter v3 sales,
then create the bridge.0059 records the mutable revision2 in that bridge while
the original submission work records revision1. The added case reproduced
`valid=false` and revision2 with the first0060 backfill (`r3-upgrade-order-red`).

The still-unpublished0060 correction now backfills submitted revision from the
same form/owner's genuine submission work alongside digest/time. The focused
actual0059→0060 test is GREEN (`r3-upgrade-order-green`) and retains the original
bridge-before-follow-up and erased-owner cases. No0059 SQL or runtime behavior
was changed. Full state reconstruction, exact hashes and metadata checks were
refreshed; the other accepted suites were not repeated. New raw evidence uses
`r3-` stems in the existing archive and manifest.

Closure checks: upgraded fixture1/1, metadata/migration17/17, tests typecheck,
changed-test lint and formatting all pass. Original0059 input hashes remain
unchanged; the reconstructed SQL catalogue is byte-identical because this repair
changes historical data backfill, not the resulting schema.
