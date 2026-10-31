# Early Bird additive 0081 promotion candidate — 2026-10-30

Status: observed dependency plan only. Draft owners are actively editing SQL.
No aggregate SQL, journal entry, snapshot, role grant or test rewrite has been
created by this plan. The accompanying JSON pins one observation of each source;
its hashes must be refreshed and independently reviewed after owners freeze.

Proposed single migration: `0081_early_bird_launch_payment_runtime.sql`, immediately
after committed 0080. This avoids a reconstructed metadata boundary for every
prototype draft while preserving the hand-authored SQL chain. Keep committed
0000–0080 and their snapshots unchanged. This is not permission to bypass the
actual PostgreSQL state reconstruction or exact-source CI.

## Selected segment order

1. `0081_early_bird_composite.sql` — entire observed source.
2. `0082_early_bird_settlement.sql` — entire observed source.
3. `0083_early_bird_verified_settlement.sql` — entire observed source.
4. `0084_early_bird_verified_payment_reader.sql` — entire observed source.
5. `0085_early_bird_verified_refund_settlement.sql` — entire observed source.
6. `0086_early_bird_verified_refund_binding.sql` — entire observed source.
7. `0087_early_bird_receipt_contacts.sql` — entire observed source.
8. `early_bird_owner_send_capability.sql` — entire observed source.
9. `early_bird_gateway_authority.sql` — schema/function prefix only; excludes role creation and GRANT tail.
10. `receipt_revocation_outbox.sql` — entire observed source.
11. `0088_early_bird_deferred_payments.sql` — entire observed source.
12. `0077_early_bird_final_call.sql` — entire observed source.
13. `early_bird_final_call_authority.sql` — entire observed source.
14. `wave_workspace_gate.sql` — entire observed source.
15. `wave_admission_projection.sql` — entire observed source.
16. `0083_early_bird_message_replacements.sql` — entire observed source.

The schema segment order is topological. Core intents precede settlement; payment
reader and refund capabilities follow their tables; contact lifecycle precedes
sender/gateway authorization. Deferred accounts precede final-call authority. The
final-call queue and authority must be installed together: the former creates an
intentionally rejecting gate that the latter replaces. Workspace/publication
follows verified coverage. Message replacement is independent of the payment
0083, so its duplicate prototype number has no significance in the aggregate.

Exclude obsolete `0078_early_bird_intents.sql` and
`0077_positive_price_snapshot.sql` (equivalent committed price snapshot is 0079).
Exclude `early_bird_gateway_provision.sql` and every other operator provisioning
script. The selected prefix of `early_bird_gateway_authority.sql` ends before the
exact marker recorded in JSON, which currently precedes its CREATE ROLE/GRANT
block. Never concatenate that whole draft blindly. PUBLIC revocations within
selected schema segments remain intact; no runtime principal is provisioned by
this aggregate.

## Byte preservation and breakpoints

The JSON records complete-source SHA-256 and selected-byte SHA-256 separately.
For the gateway prefix it also records the exact cut marker and byte offset.
Build only after checking both current hashes against the reviewed observation.
Copy selected bytes verbatim, including every existing `--> statement-breakpoint`.
Insert a new statement breakpoint on its own line between complete selected
segments; never split a function body using a semicolon-based parser. The marker
must follow a complete SQL statement, and every segment must end with its final
statement/revocation intact. Document the assembled file hash and ordered input
hashes. Source drift is a hard stop for aggregation, not an invitation to accept
new hashes silently.

## Test fixture adaptation without weakening assertions

The JSON's `test_draft_references` lists exact affected file paths and draft
references. There are 105 files in this observation: 72 use the committed-chain
fixture helper, 30 construct explicit minimal/manual schemas, 2 call migration
explicitly, and 1 needs fixture inspection. These classifications are hints,
not proof of safe automatic rewriting.

For ordinary end-to-end tests that should exercise the final installed product,
use the actual canonical migration chain and remove redundant manual draft
execution and duplicate synthetic early-bird table creation. Retain all business,
role, erasure, replay and failure assertions. Test the final feature with real
current database objects, not an IF-exists wrapper that silently skips important
setup.

For tests intentionally exercising a partial capability, before/after migration,
missing schema, or a minimal isolated authority model, make that baseline explicit
using the existing `replayMigrationsThrough(db,80)` helper (or retain the explicitly
minimal schema). Keep deliberate partial draft composition isolated and labelled
as component evidence. Never change an assertion from failure to success merely
because 0081 now installs all capabilities. In particular, the legacy-role
migration witness must retain a true pre-0081 baseline and apply the canonical
0081 once for its after-migration branch. It must not start on full 0081 and then
apply its component drafts a second time.

After promotion, a dedicated canonical migration witness and CI must replay the
full journal once, run current composed checkout/settlement/refund/erasure and
legacy role evidence against that schema, and verify reconstructed state. Partial
component fixtures do not replace this full-chain witness. The owner has bounded
extra CI/test authorization; preserve all failed runs and the original counters.
Do not run a second complete suite simply to replace inconvenient evidence.

## Exact committed-chain helper files requiring adaptation review

- `packages/db/src/repositories/early-bird-activation-isolation.integration.test.ts`
- `packages/db/src/repositories/early-bird-admission-forgery.integration.test.ts`
- `packages/db/src/repositories/early-bird-wave-client-catalog.integration.test.ts`
- `packages/db/src/repositories/early-bird-candidate-reader-principal.integration.test.ts`
- `packages/db/src/repositories/early-bird-composite-two-db-replay.integration.test.ts`
- `packages/db/src/repositories/early-bird-wave-card-review.integration.test.ts`
- `packages/db/src/repositories/early-bird-binding-database-create.integration.test.ts`
- `packages/db/src/repositories/early-bird-binding-capability-acl.integration.test.ts`
- `packages/db/src/repositories/early-bird-binding-extra-function.integration.test.ts`
- `packages/db/src/repositories/early-bird-binding-switched-role.integration.test.ts`
- `packages/db/src/repositories/early-bird-qualification-search-path.integration.test.ts`
- `packages/db/src/repositories/early-bird-gateway-authority.integration.test.ts`
- `packages/db/src/repositories/early-bird-settled-legacy-exclusion.integration.test.ts`
- `packages/db/src/repositories/early-bird-binding-baseline-function-acl.integration.test.ts`
- `packages/db/src/repositories/early-bird-intent-qualification.integration.test.ts`
- `packages/db/src/repositories/early-bird-wave-real-booking.integration.test.ts`
- `packages/db/src/repositories/early-bird-receipt-lifecycle.integration.test.ts`
- `packages/db/src/repositories/early-bird-owner-30-binding.integration.test.ts`
- `packages/db/src/repositories/early-bird-message-dispatch-capability.integration.test.ts`
- `packages/db/src/repositories/early-bird-intent-qualification-archive.integration.test.ts`
- `packages/db/src/repositories/early-bird-message-dispatch-cutoff.integration.test.ts`
- `packages/db/src/repositories/early-bird-wave-booking-refund.integration.test.ts`
- `packages/db/src/repositories/early-bird-wave-native-principal.integration.test.ts`
- `packages/db/src/repositories/early-bird-message-replacement.integration.test.ts`
- `packages/db/src/repositories/early-bird-wave-partial-refund-quarantine.integration.test.ts`
- `packages/db/src/repositories/early-bird-activation-qualification.integration.test.ts`
- `packages/db/src/repositories/early-bird-receipt-unknown-retention.integration.test.ts`
- `packages/db/src/repositories/early-bird-intent-choice-change.integration.test.ts`
- `packages/db/src/repositories/early-bird-projection-revoke-guard.integration.test.ts`
- `packages/db/src/repositories/early-bird-owner-snapshot-prepare.integration.test.ts`
- `packages/db/src/repositories/early-bird-binding-erasure.integration.test.ts`
- `packages/db/src/repositories/early-bird-refunded-legacy-choice.integration.test.ts`
- `packages/db/src/repositories/early-bird-wave-reapproval.integration.test.ts`
- `packages/db/src/repositories/early-bird-owner-receipt-prepare.integration.test.ts`
- `packages/db/src/repositories/privacy-receipt-outbox.integration.test.ts`
- `packages/db/src/repositories/early-bird-intent-transition-lock.integration.test.ts`
- `packages/db/src/repositories/early-bird-review-reconciliation-timeout.integration.test.ts`
- `packages/db/src/repositories/early-bird-refund-future-legacy-reconciliation.integration.test.ts`
- `packages/db/src/repositories/early-bird-wave-booking-consent.integration.test.ts`
- `packages/db/src/repositories/early-bird-wave-workspace-readiness.integration.test.ts`
- `packages/db/src/repositories/early-bird-binding-snapshot.integration.test.ts`
- `packages/db/src/repositories/early-bird-verified-binding-repository.integration.test.ts`
- `packages/db/src/repositories/early-bird-qualified-helpers.integration.test.ts`
- `packages/db/src/repositories/early-bird-binding-sensitive-read.integration.test.ts`
- `packages/db/src/repositories/early-bird-wave-publication.integration.test.ts`
- `packages/db/src/repositories/early-bird-intent-abandon-lock.integration.test.ts`
- `packages/db/src/repositories/early-bird-binding-login-minimal.integration.test.ts`
- `packages/db/src/repositories/early-bird-publication-forgery.integration.test.ts`
- `packages/db/src/repositories/early-bird-review-reconciliation-reader.integration.test.ts`
- `packages/db/src/repositories/early-bird-intent-terminal.integration.test.ts`
- `packages/db/src/repositories/early-bird-wave-publication-refund.integration.test.ts`
- `packages/db/src/repositories/early-bird-wave-native-admission.integration.test.ts`
- `packages/db/src/repositories/early-bird-owner-send-admission.integration.test.ts`
- `packages/db/src/repositories/early-bird-wave-workspace-principal.integration.test.ts`
- `packages/db/src/repositories/early-bird-binding-arbitrary-write.integration.test.ts`
- `packages/db/src/repositories/early-bird-legacy-role-migration-witness.integration.test.ts`
- `packages/db/src/repositories/early-bird-wave-after-legacy.integration.test.ts`
- `packages/db/src/repositories/early-bird-message-replacement-erasure.integration.test.ts`
- `packages/db/src/repositories/early-bird-binding-login-privileges.integration.test.ts`
- `packages/db/src/repositories/early-bird-wave-workspace-opt-in.integration.test.ts`
- `packages/db/src/repositories/early-bird-binding-no-sensitive-read.integration.test.ts`
- `packages/db/src/repositories/early-bird-owner-scope-source.integration.test.ts`
- `packages/db/src/repositories/early-bird-owner-id-rotation.integration.test.ts`
- `packages/db/src/repositories/early-bird-refund-reflow-now.integration.test.ts`
- `packages/db/src/repositories/early-bird-legacy-refund-reflow.integration.test.ts`
- `packages/db/src/repositories/early-bird-refund-legacy-coverage.integration.test.ts`
- `packages/db/src/repositories/early-bird-binding-observations.integration.test.ts`
- `packages/db/src/repositories/early-bird-admission-projection.integration.test.ts`
- `packages/db/src/repositories/early-bird-binding-capability-role.integration.test.ts`
- `packages/db/src/repositories/early-bird-receipt-contact.integration.test.ts`
- `packages/db/src/repositories/early-bird-owner-intent-prepare.integration.test.ts`
- `packages/db/src/repositories/early-bird-wave-card-handoff.integration.test.ts`

## Exact manual/minimal and explicitly migrated files requiring review

These do not necessarily need to use the full canonical migration: many assert
an intentionally smaller authority model. Keep their schema intent explicit.

- `packages/db/src/repositories/receipt-revocation-outbox.integration.test.ts` — `explicit_minimal_or_manual_schema`
- `packages/db/src/repositories/early-bird-settlement-erasure.integration.test.ts` — `explicit_minimal_or_manual_schema`
- `packages/db/src/repositories/early-bird-deferred-capture.integration.test.ts` — `explicit_minimal_or_manual_schema`
- `packages/db/src/repositories/early-bird-verified-operation-reader.integration.test.ts` — `explicit_minimal_or_manual_schema`
- `packages/db/src/repositories/early-bird-deferred-retention.integration.test.ts` — `explicit_minimal_or_manual_schema`
- `packages/db/src/repositories/early-bird-final-call-stale-config.integration.test.ts` — `explicit_minimal_or_manual_schema`
- `packages/db/src/repositories/early-bird-settlement-timezone.integration.test.ts` — `explicit_minimal_or_manual_schema`
- `packages/db/src/repositories/early-bird-final-call-expire.integration.test.ts` — `explicit_minimal_or_manual_schema`
- `packages/db/src/repositories/early-bird-deferred-bound-reader.integration.test.ts` — `explicit_minimal_or_manual_schema`
- `packages/db/src/repositories/early-bird-payment-settlement-store.integration.test.ts` — `explicit_minimal_or_manual_schema`
- `packages/db/src/repositories/early-bird-verified-payment-reader.integration.test.ts` — `explicit_minimal_or_manual_schema`
- `packages/db/src/repositories/early-bird-deferred-onboarding-status.integration.test.ts` — `explicit_minimal_or_manual_schema`
- `packages/db/src/repositories/early-bird-refund-observation-time.integration.test.ts` — `explicit_minimal_or_manual_schema`
- `packages/db/src/repositories/early-bird-deferred-provider.integration.test.ts` — `explicit_minimal_or_manual_schema`
- `packages/db/src/repositories/early-bird-settlement-sql.integration.test.ts` — `explicit_minimal_or_manual_schema`
- `packages/db/src/repositories/early-bird-payment-settlement-principal.integration.test.ts` — `explicit_minimal_or_manual_schema`
- `packages/db/src/repositories/early-bird-deferred-payments.integration.test.ts` — `explicit_minimal_or_manual_schema`
- `packages/db/src/repositories/early-bird-final-call-same-config-recovery.integration.test.ts` — `explicit_minimal_or_manual_schema`
- `packages/db/src/repositories/early-bird-partial-refund.integration.test.ts` — `explicit_minimal_or_manual_schema`
- `packages/db/src/repositories/early-bird-deferred-reader.integration.test.ts` — `explicit_minimal_or_manual_schema`
- `packages/db/src/repositories/early-bird-refund-discovery.integration.test.ts` — `explicit_minimal_or_manual_schema`
- `packages/db/src/repositories/early-bird-final-call-cancel-proof.integration.test.ts` — `explicit_minimal_or_manual_schema`
- `packages/db/src/repositories/early-bird-refund-isolation.integration.test.ts` — `explicit_minimal_or_manual_schema`
- `packages/db/src/repositories/early-bird-refund-registry.integration.test.ts` — `explicit_minimal_or_manual_schema`
- `packages/db/src/repositories/early-bird-final-call-real-config-race.integration.test.ts` — `explicit_migration_call`
- `packages/db/src/repositories/early-bird-refund-settlement-principal.integration.test.ts` — `explicit_minimal_or_manual_schema`
- `packages/db/src/repositories/early-bird-coverage-refund.integration.test.ts` — `explicit_minimal_or_manual_schema`
- `packages/db/src/repositories/early-bird-final-call-matched-config-race.integration.test.ts` — `explicit_migration_call`
- `packages/db/src/repositories/early-bird-coverage-epoch.integration.test.ts` — `explicit_minimal_or_manual_schema`
- `packages/db/src/repositories/early-bird-final-call-schema.integration.test.ts` — `explicit_minimal_or_manual_schema`
- `packages/db/src/repositories/early-bird-settlement-full-price.integration.test.ts` — `explicit_minimal_or_manual_schema`
- `packages/db/src/repositories/early-bird-refund-discovery-race.integration.test.ts` — `explicit_minimal_or_manual_schema`
- `packages/db/src/repositories/early-bird-coverage-principal.integration.test.ts` — `inspect_fixture`

## Remaining release conditions

Source-level receipt/gateway integration and limited-role provisioning still need
reviewed composition; the aggregate does not prove external provider facts or
exclusive egress. 0082's database-presence detection changes ordinary legacy
settlement, so execute the minimal reviewed legacy coverage grants before enabling
services on the new schema and verify the actual target role. Launch enrollment
still begins 1 November 2026 MSK; active config defaults to PUBLIC_LAUNCH.
Activating an earlier production window is a separate date/config decision, not a
migration-test clock change.

The deferred path and final-call authority are under active review. Their
existence is not evidence that all publication/refund/late-payment interactions
are complete. Freeze only the coherent reviewed source set, then reconstruct SQL
state on PostgreSQL 17.5, run the exact-source bounded CI and prove the normal
release/rollback path before treating this candidate as deployable.
