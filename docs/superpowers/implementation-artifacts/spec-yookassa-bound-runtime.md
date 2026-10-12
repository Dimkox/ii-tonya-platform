---
title: Recover bound YooKassa payment outcomes in the production worker
type: implementation
created: 2026-10-12
status: in-progress
baseline_commit: 690797db64fd80aa1aeccea8003543de470d8c16
context:
  - "{project-root}/AGENTS.md"
  - "{project-root}/docs/agents/expert-residency-team.md"
  - "{project-root}/docs/superpowers/specs/2026-08-14-yookassa-provider-design.md"
  - "{project-root}/docs/superpowers/plans/2026-10-12-yookassa-bound-runtime.md"
---

## Intent

Complete existing YKP-006/008/013 worker wiring so a bound payment does not remain
pending forever when its webhook is lost. The owner delegated implementation
choices and requires the actual production entrypoint, not another unused helper.
This implements the approved provider design without merchant calls or activation.
No receipt source/policy is invented. No payment/refund POST is sent by this job.

## Code map and decisions

`apps/worker/src/main.ts` currently requires an injected yookassaReader, while its
default factory supplies none. `runtime.ts` returns providers_disabled for unknown
outcomes. Existing expert-residency reconciliation audits terminal payments only.
`PostgresYooKassaOperationRepository.claimReconciliationBatch` already leases bound
pending/unknown operations for five minutes, but no runtime calls it.
`YooKassaPaymentVerifier` does authoritative GET validation and canonical branding;
canceled responses resolve the operation inside the verifier. Success events must
go through PostgresExpertResidencyProviderInboxRepository.settle/reverse BEFORE
resolving the provider operation. Keep financial rules unchanged; the specific
settlement-attempt transition correction below is now included.

Choose normal production composition of real client, operation repository,
verifier, canonical inbox and bounded runner. Do not require an injected reader to
enable the normal process. Retain the existing optional reader seam for terminal
auditing and test transport injection only; neither replaces bound recovery.
Disabled flags produce zero provider I/O. Contradictory enabled/config/payments
flags fail before calls. Unbound recovery remains separately default-off.

Add optional mode to claimReconciliationBatch(limit,mode) and filter it BEFORE
ordering/limit; preserve existing callers. Runtime always passes configured mode.
Make resolve idempotent only for the SAME terminal status, preserving original
resolved_at/updated_at on replay; different terminal transitions still fail.
This closes the verifier/webhook/worker race without overwriting evidence.
Do not add schema or change financial commands beyond the bounded correction below.

Bound recovery runs before order expiry, at most25 operations per cycle. Provider
reads are sequential and only for the exact bound ID (refund also reads its exact
parent). Unknown/pending responses remain pending under existing claim backoff.
Amount/order/mode/ID mismatch, malformed data or delivery failure cannot resolve
success. Handle one failed item without starving the rest; reports contain only
bounded counts/reasons, never raw errors/IDs/payloads/contacts. A401/403 stops further
provider calls for that runner instance and reports credentials_unavailable until
process restart with corrected configuration. No automatic credential retries.

For a verified successful event, await canonical durable delivery then resolve.
If delivery throws after recording a financial operator case, leave the operation
retryable; do not infer successful financial acceptance. Duplicate and concurrent
worker/webhook delivery must produce one canonical financial effect. A crash
after inbox acceptance but before resolve must recover via inbox idempotency.
Recheck runtime mode before any GET, even if a repository returns a wrong-mode row.
Stop starting new claims when the worker begins closing; do not change unrelated
notification shutdown or retention semantics. Use the existing worker cycle report
for bounded recovery results, not a separate daemon/timer or unbounded queue.

Operational clarification: the existing client permits15s per GET;25 sequential
refunds could otherwise exceed both the five-minute claim lease and30s shutdown.
Bound recovery provider-I/O admission to a20s cycle window, carrying remaining
time into each HTTP abort signal. After expiry/stop, begin no additional GET;
leave remaining claims recoverable under their lease. Do not interrupt a canonical
DB commit or translate deadline expiry into a failed payment. The credentials
circuit must also fence the terminal-audit reader sharing this runtime.

Review clarification: checking once before an injected batch reader is insufficient:
its existing four parallel GET loops survive a sibling rejection. The optional
audit composition must construct its reader with the SAME guarded client (a
guarded-reader factory seam is allowed), or provide equivalent per-request
admission/cancellation. Reject an unguarded legacy reader in enabled composition
instead of silently claiming it is fenced. Disabled behavior stays unchanged.
Completed audit counts and persisted mismatches must never be overwritten with
zeroes by a subsequent deadline check; preserve result and report reason separately.

### Proven prerequisite defect — keep the real payment/refund path

GREEN2 exposed that settlement inserts a settled attempt ON CONFLICT DO NOTHING,
then merely selects a pre-existing bound pending attempt. The order settles while
the attempt stays pending, so the real refund claim rejects it. Extend ownership
to the settlement-attempt block of expert-residency-provider-inbox-repository.ts
only. In the existing transaction, after exact provider/payment/order/amount/
currency binding validation, transition created/pending/unknown_outcome to settled
with resolved_at and updated_at. Preserve same-settled evidence; reject other
terminal states with the existing attempt conflict error. Never bypass existing
expiry, credit-invalidation, consent or financial checks. Do not alter rewards,
reversal, credit, residency policy or the earlier financial corrections.

Restore the original four refund fixtures through an ordinary pre-bound payment
and real worker settlement; do not make those cases green by seeding away this
defect. Assert attempt status/resolved_at and single attempt identity along this
path, including replay and mismatched/terminal attempt rejection. Original15/19
execution is the failing evidence; coordinator3 remains reserved after review.
No extra author run is granted. This correction does not prove or replace the
unrun financial87 suite, whose separate permission request remains pending.

## Tasks & Acceptance

- [ ] Given disabled or contradictory configuration, when the normal worker is
      created/run, then disabled performs zero YooKassa I/O and contradiction
      fails closed before a provider call. Enabled normal factory constructs real
      capabilities without an injected provider reader.
- [ ] Given a bound pending/unknown payment/refund, when authoritative GET confirms
      success, then the real inbox applies it before operation success; pending,
      canceled and mismatched responses have their distinct non-settled outcomes.
- [ ] Given mixed modes or more than25 rows, claim only configured mode before
      LIMIT; never GET a wrong-mode row or exceed25 claims/cycle. Credentials401/403
      stop remaining and subsequent calls for that runtime, without raw errors.
- [ ] Given duplicate webhook/worker delivery or a crash between delivery/resolve,
      then replay yields one canonical effect and idempotent same-status resolve;
      conflicting terminal resolution fails without evidence overwrite.
- [ ] Given one transport/verification/delivery failure, other valid claims proceed
      while the failed operation remains recoverable after its existing lease.
      Closing starts no new recovery work. No POST, history scan or false success.
- [ ] Prove the actual factory/cycle with isolatedPG17.5, real repositories/client/
      verifier/inbox and recording HTTP transport. Unit tests cover error branches
      and close behavior. Record static checks and bounded executions for review.

## Ownership and verification

One implementer owns new packages/worker/src/yookassa-bound-reconciliation.ts and
its .test.ts; new apps/worker/src/yookassa-composition.ts; apps/worker/src/main.ts,
runtime.ts; operation-port.ts, yookassa-operation-repository.ts; worker index.ts;
new tests/integration/yookassa-bound-runtime.test.ts; the bounded settlement-attempt
block described above; and own evidence at
docs/test-evidence/yookassa-bound-runtime-2026-10-12.md. No other product files.
If a required dependency cannot fit safely, report it; never weaken authority.
Main owns shared status/runbooks. No nested agents, commit/push/remote operations.

Run RequireDocker preflight; use retained syntheticPG17.5 container
ii-tonya-notification-t2-20261012-postgres-1, random testkit DB, no shared reset.
Each NEW test file has3 total runs: author RED1/GREEN2, main final3 after review.
Typecheck tests before RED. Import existing entrypoints for a behavioral RED;
collection failure consumes a run and is not behavioral evidence. No exhausted
old tests, full suite or multi-path command. Do not copy old tests to evade caps.
Read testkit and migration guards before fixtures. Build affected packages,
typecheck apps/worker, DB, worker and tests; scoped lint/format/diff. Evidence
must distinguish code completion, financial87 unrun, and provider activation.
