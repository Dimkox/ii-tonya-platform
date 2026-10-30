# Live continuation — 2026-10-30

The historical sections below describe intermediate states and are not current
release evidence. Active branch is `codex/early-bird-wave1-main-sync-20261029`, based
on `1df0d7b9c5c4db1c244c12d4525470bf1275c738`; original dirty checkout is preserved.
No commit, remote push, CI run, production mutation or real payment has yet been
performed by this increment.

Canonical migrations 0081 and 0082 now include reviewed payment/runtime and narrow
worker capabilities, with reconstructed PostgreSQL 17.5 state and a passing actual
26-role witness. Additive 0083 is journaled and independently verified on PostgreSQL 17.5
with all 28 isolated roles for the publication worker and once-only launch-kit ledger. API and worker bootstrap compose real authenticated
IPC, isolated database roles, encrypted receipt preparation, provider verification,
settlement/refunds, recovery without another POST, privacy revocation outbox,
retention and reminder delivery. Publication and launch-kit jobs are connected to
the worker; the final 0083 role/state witness passed 1/1.

The owner approved gateway-acknowledged deletion and repeat reminders only while
unpaid and without a Pay-button click. See the dated owner-decision documents.
The owner also authorized at most two full GitHub Actions runs and at most two
additional invocations of each failed PostgreSQL file. Neither full CI run has
been consumed. Preserve per-file ledgers; no exhausted focused file may be
rerun merely because its previous output was lost.

Fresh workspace build number 4 passed after worker/publication/kit integration.
Fresh Python gateway discovery ran 105 tests: 103 passed and two skipped.
A new non-PostgreSQL protocol contract passed real AEAD → authenticated IPC →
local TLS POST → provider GET → branded binding → fresh confirmation GET.
The whole-PostgreSQL TLS test had failed because its fixture replaced Python's
global HTTPSConnection class with a function; the corrected fixture is awaiting
full CI, without a forbidden extra focused invocation. Workspace build 5, full types, full lint and formatting passed. Subsequent
API-only import ownership fixes passed API build/typecheck and the 17-case
workspace dependency guard. Independent reviews closed the deferred-contact
privacy omission, composite invalid recovery SQL, deferred unknown recovery, and
launch-kit enqueue/erasure race. Release CI remains pending.

Production read-only observation: release `19ecb3456a647743f00584b14d097c2759f0d718`,
Node 24.19.0, PostgreSQL 16.15, 76 migrations forming an exact candidate prefix.
Application role is database owner, nonsuperuser and cannot create roles. No active
security administrators or fresh administrator sessions exist, so the current
two-person manual test-pricing grant cannot be activated as-is. The separately
scoped future expert is still unidentified; a pricing enrollment clarification
is pending. Do not fabricate administrator identities, sessions or approvals.
YooKassa read-only shop inspection confirms the configured live shop is enabled
and fiscalization is enabled. Existing expert promo bot token is valid; its
webhook is not set. No provider POST, Telegram send or webhook mutation occurred.
An isolated PostgreSQL 16.15 compatibility rehearsal passed synthetic old-runtime
checkout/settlement/refund/booking/replay and negative-card scenarios in addition
to mandatory PostgreSQL 17.5 checks. See docs/test-evidence/early-bird-pg16-2026-10-30.
The unmodified old API rejects the longer migration journal, so a separately
signed bridge artifact with an exact old/new journal validator is required
before applying business migrations. Both bridge wrappers disable payments;
selected bridge provenance also requires the gateway to remain stopped. Restoring the old environment
before an old-binary rollback is required because it cannot parse gateway mode.

---

# Early bird continuation — 2026-10-29

Status: incomplete; no production activation, remote push, GitHub Actions run, or live YooKassa transaction. Worktree branch `codex/early-bird-wave1-main-sync-20261029` is based on `1df0d7b9c5c4db1c244c12d4525470bf1275c738`. Revalidate remote main before continuing. The older worktree and the original dirty checkout are preserved.

The owner requested 10 RUB onboarding and 20 RUB monthly for one production test expert who will self-register; one combined early-bird invoice is 30 RUB. Grant reassignment requires explicit revocation and new two-person approval. No expert account has been identified or granted. The owner authorized GitHub Actions after repository visibility became public; existing bounded test execution rules still apply.

Implemented but not released: versioned DB grant, choice, launch config and qualification form migrations 0076–0080 and their reconstructed PostgreSQL 17.5 metadata; default-off expert flow and test-pricing administration; composite receipt, verification and bounded candidate search primitives; consent-aware messaging and wave publication/booking scaffolding. Focused tests and independent reviews covered pieces, not the end-to-end production feature. Several PostgreSQL files exhausted their three-run budget; consult the session evidence and individual test reports before any reruns. One multi-path Vitest invocation was inadvertently repeated against the repository task rule; do not repeat it.

Critical unfinished work:

1. Actual composite provider operation, trusted first-send cancellation, verified settlement/refund and durable recovery remain drafts. The previously approved deletion rule requires cancellation of any send not started. Local DB-native HTTP experiments showed a send can start while deletion waits; no safe transport has been proven. Do not toggle flags or claim the capability based on locks, polling, an abort signal, or a boolean marker.
2. `0081`, `0082`, and `0083` remain drafts. Existing code has opt-in references to draft-only objects; do not enable these paths. Verify default-off behavior and migrate only with reviewed source, metadata and focused checks.
3. Runtime does not yet compose wave checkout, manager review or notification sender. Scenario B has no verified 10 RUB onboarding fact and no real subscription-only checkout; final-call queue and launch-material delivery are not wired. Wave publication/booking has local tests against synthetic verified proofs and draft SQL, not live evidence. Reconciliation after refunds and data erasure requires an approved retention and repair policy.
4. Public offer changes describe the future behavior; do not publish them without working payment flow and legal review. Draft GitHub workflow is not pushed; `scope-boundary` hashes and exact-SHA release gates need completion. GitHub CI and Database Gate must avoid duplicate focused PostgreSQL test runs and respect task-level budgets.

Production remains unchanged. No live keys or customer data were used. Do not create an actual payment or activate flags until checkout, verification, settlement, refund, deletion, publication, rollback and exact-SHA gates are proven on the selected target.

## Continued work

Added fail-closed API readiness for configured wave until client start and standalone YooKassa full/partial refund verification. Draft 0082 records first verified refund observation using the DB clock, and adds a common refund-ID registry and partial-refund reconciliation; separate synthetic tests passed but concurrent SERIALIZABLE retries, existing projection quarantine and true refund-operation binding still need completion and review. `pnpm typecheck` completed successfully on the current worktree; the complete suite was not run. The current scope-boundary guard is failing because changed financial files and new artifacts have not been approved/pinned. Do not treat hashes as reviewed until independent review is complete.

Additional focused verification: the refund isolation test exercised forced overlapping transactions under REPEATABLE READ and SERIALIZABLE, including successful retry and conflict, 6/6. Its three permitted runs are exhausted. The bounded retry helper is tested but is not connected to a production store. Independent review confirmed the test creates real overlap; no trusted production refund binding exists yet.

## Transport experiments continued

The experimental Python gateway suite passed 40 tests before the latest revocation changes; IPC shutdown/deadline received independent review. A disposable Docker probe demonstrated direct connection denial and gateway access in a synthetic two-network topology; it is not evidence of production fencing. A standalone composite invoice orchestrator has five focused synthetic tests, including rejection of a modified amount; it is not connected to the API, database, or provider. The revocation recovery prototype was independently reviewed and has unresolved P1 limitations: conflicting idempotency keys, unproven egress shutdown after journal failure, concurrent/repeated mutation without database deduplication, and private durable-state retention and permissions. It must not be used in production. The live database deletion paths and provider transport remain disconnected, and dispatch remains disabled. No production activation, provider transaction, push, or CI run occurred.

## Continued implementation and review

A separate owner intent preparation repository and a sealed-request AES-GCM codec were added, with focused tests. The codec binds the complete price/date snapshot and identifiers; independent review found and verified correction of a missing date binding. These remain disconnected from the sender and draft migration 0081. A separate default-off settlement boundary and draft SQL were added; a focused PostgreSQL test used restricted roles to exercise verifier-to-store settlement for both standard and owner 10+20 policies and reject excess privilege. The file has exhausted its three-run PG allowance. The caller's credentials/process isolation and production composition remain unproven. Python experimental gateway suite passed 43 tests; review still found no reliable production egress fencing or integrated deletion/recovery. No production deployment, real payment, push or hosted CI occurred. Do not enable these paths until the full lifecycle and release gates are satisfied.

## Further integration work

Owner snapshot preparation now combines locked database snapshots and AEAD; replay checks identifiers, canonical request digest, key reference and date snapshot without re-encrypting. Focused unit checks and prior PostgreSQL test passed; the last replay SQL change has independent review but no fresh PostgreSQL run because the file exhausted its budget. A default-off verified binding reader and payment/refund resolver were added, with restricted-role reader tests and a synthetic exact legacy refund lookup. Review notes real production schema/roles and refund composition still require verification. The experimental gateway deadline is only a best-effort check: a process may pause between checking and writing. No safe integrated egress/deletion boundary, production activation, push or CI run exists.

## Further release preparation

Added default-off manager approval hook and event reconciliation worker. Focused tests and review cover poison-event isolation and bounded waiting, but a permanently hung DB operation needs connection-level timeout or cancellation; per-process coalescing is not cross-process fencing. Added draft 0085/0086 and an isolated refund discovery, verification, binding and settlement path. PostgreSQL tests with mock provider and restricted roles cover full/partial refunds, retry after bind and a two-instance race; the main integration file exhausted its three-run allowance. Provider credentials and production composition remain absent. Gateway crash recovery has a synthetic durable SQLite subprocess test, not proof of actual PostgreSQL deletion fencing. See docs/operations/2026-10-29-yookassa-gateway-isolation-plan.md. Production has not been changed; no real provider call, CI, push or release completed.

## Latest continuation

Added transaction-local PostgreSQL statement timeouts for review reader and owner snapshot preparation; integration tests exercised locked tables and pool reuse. Review strengthened assertions to SQLSTATE 57014 after the file exhausted its three-run limit, so the strengthened assertions remain unrun. Timeout does not cover pool acquisition, network stalls or arbitrary callbacks. Added explicit default-off server injection for early-bird webhook routing with fail-fast missing dependency; focused HTTP tests cover legacy payments/refunds and retry. These tests use mocks for durable inbox; production bootstrap and credential isolation remain absent. Existing database authority checks are not a first-send fence; actual deletion and egress integration remains unresolved. Production unchanged, no release or CI run.

## Authenticated IPC continuation

Corrected an overstatement: owner requires cancellation before actual send on deletion; no separate physical first-byte wall-clock expiry guarantee was found in approved requirements. Added Python/TS authenticated revoke_user/stop_all IPC with separate auth and subject keys, nonce-bound signed responses, explicit durable nonce-registry initialization and key binding. Missing registry fails closed; ordinary restart replay is tested. Fresh root Python suite: 62 tests passed. Review found no new critical issue in final registry changes; trusted filesystem, custody, actual egress binding and all database writer integration still require work. Registry exhaustion requires coordinated key/registry rotation, and loss of registry must never be repaired using an already-used key. PostgreSQL scope source now reuses saved intent identifiers after HMAC rotation; independent review accepted this limited fix. No production activation, push or CI run.
