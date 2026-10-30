# Early Bird migration release audit — 2026-10-30

Status: incomplete release integration. This is a read-only source audit, not
database execution, role provisioning, CI evidence or release approval. No SQL,
journal, snapshots or source files were changed by the auditor. Source checkout:
`codex/early-bird-wave1-main-sync-20261029`, baseline
`1df0d7b9c5c4db1c244c12d4525470bf1275c738`; the audited worktree contains
uncommitted implementation. Revalidate current files before acting because other
implementers are active.

## Findings requiring resolution before enabling payments

### P1 — Applying settlement schema changes existing payments even with flags off

`packages/db/src/repositories/expert-residency-provider-inbox-repository.ts:203–230`
detects the presence of `early_bird_payment_successes`,
`early_bird_touch_coverage_epoch` and `early_bird_active_coverage_end`. Once present,
all residency settlement constructions honor wave coverage, independently of the
explicit feature option. It invokes the epoch function for ordinary legacy
payments. Draft `0082_early_bird_settlement.sql` revokes PUBLIC execution of the
epoch and coverage functions.

Consequently, applying 0082 without correct privileges for the existing production
settlement principal can immediately break existing payments and refunds. A
default-off application feature does not isolate this database-presence path.
Require a real migration witness using the actual restricted roles, including
legacy settlement and refund behavior, before installing or granting it.

### P1 — Verification capabilities require real credential and process isolation

Drafts 0081 and 0083–0086 introduce SECURITY DEFINER capabilities that accept
already-verified snapshots and evidence. They correctly revoke PUBLIC execution
and generally fix `search_path`, but PostgreSQL cannot itself verify provider GET
facts. Possession of the writer credential remains a trusted boundary. Production
role creation/grants and isolated runtime composition have not been demonstrated.
Do not grant these capabilities to a broad ordinary application login to make a
failing test pass. The existing application privilege audits must be exercised
against the full installed production schema, not only synthetic fixture tables.

### P1 — Scenario B and final-call acceptance remain unimplemented

`drafts/0077_early_bird_final_call.sql:72–77` intentionally raises
`early_bird_final_call_authority_unavailable` on every queue insertion. Focused queue
tests disable that trigger to test other invariants. The file cannot be promoted
or described as a functioning final-call feature. Verified onboarding-only payment
authority, subscription-only checkout, exclusion and recovery still need a
coherent implementation and tests.

### P1/P2 — Receipt expiration and erasure are not a completed retention policy

At audit time `drafts/0087_early_bird_receipt_contacts.sql:19` prevents ordinary
expiry deletion whenever the user has a prepared, unknown or settled intent. That
can preserve encrypted contact data indefinitely. The erasure-cohort trigger is a
distinct path; it does not demonstrate expiration cleanup or every withdrawal
path. Require the implementation owner to establish the intended retention,
redaction and recovery behavior and connect it to the real cleanup/withdrawal
boundary. Encryption does not remove this lifecycle requirement.

### P1 release blocker — Physical sending and deletion remain separate integration

The SQL drafts record prepared/unknown/payment/refund facts. They do not prove
exclusive provider egress or cancel an unsent network operation when data is
deleted. The gateway, real API withdrawal, worker cleanup and other DB authority
writers must share an effective boundary before enabling a real checkout. This
is the owner’s deletion requirement. Do not add a separate requirement to guarantee
the physical first byte before an absolute wall-clock deadline: the approved
admission contract instead requires fresh DB time after lock acquisition.

## Migration inventory and order

The journal currently ends at 0080, with snapshots and SQL-object manifests through 0080. Draft filenames are not journaled migrations.

| Source draft                                     | Required predecessors                                           | Release observation                                                                                |
| ------------------------------------------------ | --------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `0081_early_bird_composite.sql`                  | committed 0076–0080                                             | Intent, requests, qualification, verified binding. Trigger terminal branches refer to 0082 tables. |
| `0082_early_bird_settlement.sql`                 | 0081                                                            | Coverage, success, full and partial refund facts; affects legacy settlement by object presence.    |
| `0083_early_bird_verified_settlement.sql`        | 0081, 0082                                                      | Restricted verified payment commit.                                                                |
| `0084_early_bird_verified_payment_reader.sql`    | 0081                                                            | Restricted lookup of verified binding.                                                             |
| `0085_early_bird_verified_refund_settlement.sql` | 0081, 0082                                                      | Refund bindings and restricted refund commit.                                                      |
| `0086_early_bird_verified_refund_binding.sql`    | 0081, 0085                                                      | Restricted refund binding/read.                                                                    |
| `0087_early_bird_receipt_contacts.sql`           | 0081 and committed choice/form source                           | Under active implementation; receipt lifecycle must be resolved.                                   |
| `wave_workspace_gate.sql`                        | 0081, 0082                                                      | Required for paid wave workspace; not publication authority.                                       |
| `wave_admission_projection.sql`                  | 0081, 0082 and existing card schema                             | Wave publication and refund projection; replaces legacy consent/safety/calendar functions.         |
| `0083_early_bird_message_replacements.sql`       | committed form/review schema, launch config and price snapshots | Independent messaging extension; numbering collides with verified settlement.                      |

Smallest coherent payment/refund promotion candidate is 0081–0087 above, after
final review and permission provisioning. Install 0081 and 0082 together before
exposing intent writes. Full product acceptance also needs workspace/publication,
working Scenario B/final call and messaging delivery. This list is a dependency
proposal, not permission to enable an incomplete flow.

Resolve the duplicate 0083 numbering before promotion. Do not include
`drafts/0078_early_bird_intents.sql`: it recreates the same objects as 0081 with an
older, smaller state machine. Do not include `drafts/0077_positive_price_snapshot.sql`
in addition to the committed 0079 snapshot implementation. Do not renumber or
rewrite committed migration history to accommodate these drafts.

## Enrollment and date constraints

Committed `0077_early_bird_choices.sql` defines wave enrollment starting
`2026-11-01T00:00:00+03:00` and ending at the client start
`2027-01-11T00:00:00+03:00`. Committed `0078_early_bird_launch_config.sql` initially
inserts `PUBLIC_LAUNCH`, not `WAVE_1_EARLY_BIRD`; its immutable config allows
deactivation followed by a new row rather than editing the phase in place.

The user-facing current date is 30 October 2026 in Europe/Moscow. Immediate
production registration into the wave is therefore deliberately blocked by both
the configured phase and the enrollment window. Tests commonly replace
`early_bird_current_time()` with a November test clock and explicitly install a
wave config. Those fixtures do not show that the production path is enabled on
30 October. Keep such test overrides isolated; do not silently replace the real
production clock to make the owner journey appear ready. Any intended earlier
production enrollment must be treated as a product/date change, while normal
post-1-November activation still requires the configured wave phase and release
gates.

## Required promotion evidence

1. Freeze the final coherent SQL and resolve numbering/dependencies, including
   the existing legacy settlement effects and receipt lifecycle.
2. Hand-author SQL and contiguous journal entries with strictly increasing times
   and `breakpoints: true`; never use `drizzle-kit generate`.
3. Replay the actual chain on isolated PostgreSQL 17.5. Reconstruct each new
   snapshot and SQL-only state supplement/manifest using the repository procedure.
   The repository rejects new snapshot gaps; old tests over manually installed
   drafts do not substitute for this step.
4. Verify real capability roles and legacy principals against the full schema,
   including payment, refund, erasure and coverage interactions. Preserve prior
   failed evidence and do not rerun exhausted focused files without explicit
   authorization.
5. Run exact-source CI/Database Gate, full-flow verification and release rollback
   checks only after coherent runtime composition exists. No such result is
   established by this audit.

## Follow-up legacy-role witness — focused settlement proof

Added `packages/db/src/repositories/early-bird-legacy-role-migration-witness.integration.test.ts`
and `scripts/sql/provision-early-bird-legacy-coverage.sql` after the initial audit.
The witness migrates the actual committed chain on a disposable PostgreSQL 17.5
cluster, constructs a non-owner login with explicit legacy table privileges, and
is intended to prove legacy settlement before/after applying drafts 0081/0082,
failure without coverage grants, then recovery after granting only the two
coverage helpers. The operator script does not create a login, enable features,
or grant verifier/financial-record capabilities.

Its initial bounded execution ledger was:

| Invocation | Result                                                                                                                                                                    |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1          | Fixture grant referenced a nonexistent legacy invalidation table; corrected.                                                                                              |
| 2          | Fixture grant used an incorrect tariff table name; corrected to `expert_residency_tariff_versions`.                                                                       |
| 3          | Actual legacy settlement reached outbox insertion and failed with SQLSTATE `42501`: the fixture role lacked `SELECT(idempotency_key)` needed by `INSERT ... ON CONFLICT`. |

The third failure was corrected by adding that column-level legacy grant. The
owner then explicitly authorized up to three additional executions of this file
only. Additional execution 1 (overall invocation 4) passed 1/1 on PostgreSQL 17.5.
Additional executions 2 and 3 were not used.

The passing witness executed the actual committed schema, then installed the
actual draft 0081 and 0082 SQL. It demonstrated successful legacy settlement
before installation; SQLSTATE 42501 after installation without the helper grants,
with the order remaining pending; successful settlement and idempotent replay
after executing the operator provisioning script; no wave payment-success facts;
and rejection of direct wave-table reading and payment-binding/success functions.
Exactly one settled payment attempt remained for the post-migration order.

This is focused settlement evidence, not full release or refund evidence. The
role is a deliberate synthetic model with explicit existing legacy table/lock
privileges; the actual production role still needs separate inspection. No
production privilege or schema was changed. The authorization applies only to
this named file and does not reset any other exhausted test allowance.

## Verified operation recovery selector

Draft 0084 and `PostgresEarlyBirdVerifiedPaymentReader` now support the additional
`operation` selector through the existing `find_verified_payment(text,text)`
capability and the same audited login. `findBindingByOperation(operationId)`
validates input and rechecks the returned operation identifier. It reads an
already-verified stored binding without retrieving receipt contact or authorizing
a new POST.

New focused unit tests ran RED (method absent) then GREEN 4/4. The separate
`early-bird-verified-operation-reader.integration.test.ts` passed 1/1 on its first
invocation using an isolated PostgreSQL 17.5 cluster and a real limited login. It
checks bound/unbound/missing operations, existing invoice/provider selectors,
denied direct table reads and fail-closed audit after adding excessive privilege.
Its fixture contains only the binding projection tables; it does not replace the
full migration-chain evidence or validate provider facts. The older reader
integration file was not rerun. No capability grants or production schema were
changed.

## Temporary aggregate canonical replay

Added `scripts/build-early-bird-migration-candidate.mjs` and its type declaration.
It copies the actual committed 0000–0080 SQL/journal into an empty disposable
directory and assembles the 16 observed schema segments as one temporary 0081.
It preserves selected bytes and internal breakpoints, excludes gateway role
provisioning, and refuses canonical/nonempty output. Explicit source observation
is recorded with whole-source and selected-byte hashes; stale reviewed-manifest
hashes are otherwise rejected. Sources are rechecked during the witness.

`early-bird-aggregate-candidate-replay.integration.test.ts` runs the real Drizzle
migrator over that entire temporary chain on PostgreSQL 17.5, checks 82 migration
records and unchanged canonical journal bytes, verifies key schema objects and
PUBLIC_LAUNCH defaults, and proves gateway roles are not auto-created. A genuine
limited login cannot call coverage helpers before the explicit two-function
operator grant; afterward it can touch an epoch/read empty coverage but cannot
read wave facts or call verified payment/write capabilities. No payment-success
facts are manufactured.

| New focused file invocation | Source observation and result                                                                                               |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| 1                           | Candidate `51fed6a36fe97d0313124ec62e14daff37070894eb1976a36e9fa7abd293b8d9`, passed 1/1.                                   |
| 2                           | After active-owner draft changes, candidate `b7dea839f4c6de9c35007acf23c8d23b9322794fc8feb24d98e2b6137d0cc3e0`, passed 1/1. |

Invocation 3 remains unused. A preserved temporary tree from the second observation
is `/tmp/early-bird-candidate-observed-OWwGtG`, including its input-hash report; it
is not the canonical migration or a deployed artifact. These results establish
installation/dependency and restricted helper behavior for the observed sources,
not full checkout, provider verification, snapshot reconstruction, final frozen
release evidence or production role correctness. Canonical fixtures and the final
journal remain unmodified.

## Canonical promotion and independent validation through 0082

The 19-segment candidate was subsequently promoted as the hand-authored canonical
`0081_early_bird_payment_runtime.sql`, exact SHA-256
`4896c3e2482efc27db1578bbb8ede5098796c404faa75cb5d20ff268657a4353`.
Its journal entry and PostgreSQL-derived snapshot/supplement/manifest were added.
An independent full-chain replay and fresh introspection matched that state.

Worker boundaries were promoted separately as
`0082_early_bird_worker_capabilities.sql`, SHA-256
`9e992d43465b475cd1d2210f0bb3134632504c30bb17402e1dd7dd4e91a9c80d`.
This retains worker review/retention functions, the final-call dispatcher and the
API-only engagement helper, while excluding the prototype role-creation/grant
block. The dispatcher cannot record engagement; that helper remains owner-only.
All new SECURITY DEFINER delegates use explicit `pg_temp` last. No 0081 SQL or
state bytes were rewritten during this additive promotion.

New `meta/0082_snapshot.json` and `state/0082_sql_objects.json` were reconstructed
from an actual canonical replay on PostgreSQL 17.5 using drizzle-kit 0.31.10 in a
fresh empty temporary directory. Counts: 275 tables, 270 application functions
(seven private), 269 triggers, 1,871 constraints and 661 indexes. The supplement
preserves private namespace and PUBLIC-execution facts in addition to SQL object
definitions. All 83 input migration hashes and parent-snapshot linkage are bound
by `state/0082_manifest.json`.

Focused latest-state witness execution ledger:

| Invocation | Result                                                                                                                                                                                                            |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1          | Independent canonical 0081 state/ACL replay passed 1/1.                                                                                                                                                           |
| 2          | Updated latest-0082 test failed before collection because root tests could not import the DB package's `pg` dependency directly; no PostgreSQL execution. Fixed using `createRequire` anchored to the DB package. |
| 3          | Independent canonical 0082 snapshot/SQL/private-ACL replay plus actual 26-role provisioning passed 1/1.                                                                                                           |

The last run verifies idempotent provisioning, exact capability membership without
ADMIN OPTION, listed privileged functions only, denied direct financial/contact
table reads and schema creation, rejection of the migration owner and rejection
of a runtime login with an extra table grant. No payment-success facts were
manufactured. Historical public-only state extraction retains its original
six-key shape; old baseline artifacts and the frozen snapshot-gap and bigint
lists remain unchanged.

Final focused static checks passed: migration history 10/10 and state provenance
30/30, including both private-ACL baselines. Focused ESLint and whitespace checks
passed. The latest-state focused PostgreSQL file has used all three permitted
invocations; do not rerun it outside the owner's explicit additional CI/test
authorization. This is migration/schema/privilege evidence, not production
deployment, provider charge or full feature acceptance.

## Canonical 0083 launch publication and materials

After the publication and launch-kit owners' PostgreSQL checks and independent
review, the schema-only selected sources were promoted as
`0083_early_bird_launch_publication.sql`, SHA-256
`69427ca04b5b16004764d8cc6c20c061e1fad85b89eed60352f56529048918f7`.
The prototype role-creation/grant block is excluded; the separate privacy erasure
suffix is retained. Exact selected-input hashes are recorded in the 0083 segment
manifest. Canonical 0081/0082 SQL and state bytes remain unchanged.

The launch-kit ledger intentionally retains an expert UUID without a cascading
expert FK so expert replacement does not erase a previously delivered once-only
result. The user FK and privacy-cohort erasure remain. Independent review found
an enqueue/erasure race in an earlier draft; the owner fixed it with the consent
document lock, ordered subject locks and fresh eligibility after lock acquisition.
The controlled concurrent PostgreSQL regression passed and the reviewer accepted
the final selected SHA. Publication retains the documented limitation that an
existing inactive published row needs the separate reconciliation procedure.

Fresh PostgreSQL 17.5 reconstruction produced 276 tables, 275 application
functions (seven private), 270 triggers, 1,878 constraints and 663 indexes.
Snapshot SHA-256:
`41024b5f86a6459c0cca696fea67ffd230968b23e636e404b2d110d31f34b72b`;
SQL-object supplement SHA-256:
`d1590c8692c70f01ec5b63bc7755b64a71ed2ee70005e4c4efc0b8cf1c1ccde9`.
The manifest binds all 84 canonical migration input hashes and the 0083→0082
snapshot linkage.

New focused `early-bird-launch-migration-state.test.ts` passed 1/1 on invocation

1. It independently replayed the full canonical chain, freshly introspected and
   normalized the snapshot, compared the complete SQL/private-schema/PUBLIC-ACL
   catalogue and provisioned all 28 isolated roles. Exact capabilities, denied table
   access/schema creation, idempotent provisioning and rejection of owner/extra
   table grants were verified. It does not perform a real provider charge or
   production mutation. The existing exhausted 0082 witness was not locally rerun;
   its fixture now explicitly replays the historical prefix and uses capability
   introduction markers to retain its original 26-role assertions when later
   migrations exist.

Static guards passed 10/10 migration-history tests and 32/32 state/provenance
tests. Six operator metadata/configuration tests passed, including example
logins compatible with the unchanged provisioner validator, API/worker capability
mapping, shared contact-key version and an actual consent-policy version.
Focused lint and whitespace checks passed. Production PostgreSQL 16.15
compatibility and final release CI are separate evidence requirements.
