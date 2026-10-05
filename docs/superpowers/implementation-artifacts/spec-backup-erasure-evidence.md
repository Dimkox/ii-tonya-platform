---
title: Verified backup erasure evidence, not elapsed time
type: bugfix
status: in-review
created: 2026-10-05
baseline_commit: dce8b2e149d0553a7d6fa19a9941ed2a0e30494e
context:
  - AGENTS.md
  - docs/superpowers/implementation-artifacts/spec-client-sensitive-consent.md
  - docs/superpowers/plans/2026-10-05-backup-erasure-evidence.md
---

## Intent

Fix the concrete false-completion defect in CT-014/018: verifyExpiredBackup currently
marks backup_verified solely because a date passed. A verified erasure result must
be backed by a separately verified, job/policy/expiry-bound provider inventory or
deletion attestation. Elapsed retention is a scheduling condition only.

## Boundaries

One assigned writer, preserve unrelated files, no production deletes or provider
calls, no migrations/dependencies, no enabling erasure. The live host has no
application backup timer/cron observed; this does NOT establish absence of hosting
snapshots. Main owns release and external facts. The approved owner request allows
implementation now; no need another questionnaire. Real backup/processor evidence
is unavailable and must remain explicitly unavailable.

## Code Map / Ownership

- packages/worker/src/privacy-erasure.ts and its tests/testkit, index.ts.
- packages/db/src/repositories/privacy-repository.ts and db index.ts only where
  necessary for backup evidence transitions/export types.
- packages/contracts/src/backup-erasure.ts and index.ts may hold shared wire
  evidence types, with no cyclic dependencies or new packages. Existing compatible
  type ownership is preferable when it avoids dependency changes.
- tests/integration/client-backup-erasure-evidence.test.ts; update
  tests/integration/privacy-workflow.test.ts assertion for corrected contract.
- docs/operations/data-retention.md, this spec and linked plan.

## Contract

Define a typed verifier port returning a verified attestation or explicit
unavailable/rejected/unknown. The port belongs to trusted server composition, never
accept a client boolean or a user-submitted receipt as verification. Production
composition without an actual trusted verifier cannot return backup_verified.
Mocks are test-only, no built-in success adapter or fake signers/keys.

Evidence must bind exact job ID, backup policy version, scheduled expiry,
verification timestamp, verification method, verifier identity and opaque SHA256
receipt. No subject data, provider raw response or secret is stored. Validation
requires all exact fields, valid bounded strings/hash/dates, verification at or
after expiry and no future time, and exact request/job/policy binding. Timeout,
exception, unknown state or mismatch cannot mutate successful state. A changed
policy cannot inherit an old proof.

verifyExpiredBackup remains capability gated, requires processor_complete and
scheduled evidence and an elapsed finite expiry, then calls verifier and only
commits a verified response. Return the actual durable result, not optimistic
success after a missing or failed CAS. Already-verified jobs are idempotent only
with corresponding persisted valid evidence; legacy date-only verified status
cannot be silently certified.

Repository verifyBackup must take evidence, not just (jobId, Date), revalidate
bindings against the row and DATABASE time, require scheduled processor_complete,
exactly the four named processors object_store, selarti, planerka, make_projection acknowledged (not merely four arbitrary rows) and no unfinished booking erasure work (preserve
existing SQL triggers), then atomically change state AND persist the minimal
attestation in existing erasure_receipt JSONB without destroying other receipt
fields. It must not accept caller-selected future time to skip expiry. Keep
capability false-default. Two competing verifiers must not overwrite evidence;
same exact confirmed receipt can be idempotent, conflicting receipt fails closed.

completeProcessors must accept only scheduled finite nonempty policy evidence;
the caller cannot premark verificationState=verified. Preserve existing uncertain
processor outcome/reconciliation semantics and immutable financial/audit facts.

Update assertPrivacyWorkflowContract's misleading expiry_evidence_only literal
to describe verified bound evidence; update the focused test accordingly.
No route may show overall erasure completed merely because retention elapsed.

## Tasks & Acceptance

- [x] RED unit: complete processor work, advance clock past expiry with no verifier;
      old implementation succeeds incorrectly, new one remains unverified.
- [x] Units: disabled/no I/O, verifier missing/throw/unknown/rejected/timeout,
      malformed dates/hash/unknown fields, all mismatched bindings, future evidence,
      valid verified success, CAS failure, and already-verified proof behavior (including runErasureWorkflow's early terminal return, not only verifyExpiredBackup).
- [x] PG: date-only/direct repository call cannot mark complete; future clock,
      wrong policy/expiry/job/receipt shape rejected; preserve other erasure receipt
      fields; exact valid receipt + elapsed DB time succeeds; concurrent conflicting
      receipts cannot overwrite; repeated matching proof idempotent.
- [x] Existing processor crash recovery/unknown semantics remain unchanged.
- [x] No production activation. Document what real attestation/verifier must be
      configured, why a timer is not proof, and restore remains separately gated.
- [x] Individual focused commands only. PG17.5 own fixture localhost33110 admin
      postgresql://ii_tonya_test@127.0.0.1:33110/postgres, max3 runs per PG/concurrency
      file. The aggregate run is already used; no full/multi-path Vitest command. Navigation replay and catalogue-worker PG files exhausted3/3 and must not run again. Relevant build/typecheck/lint/format and
      git diff --check; report exact RED/GREEN and freeze all writes for review.

## Results

Implemented in the existing worktree against baseline
`dce8b2e149d0553a7d6fa19a9941ed2a0e30494e`. Writes frozen for independent review.
No commit, push, migration, dependency change, provider call, production deletion,
or capability activation. Unrelated pre-existing untracked files were preserved.

The shared contracts schema enforces the exact version-1 attestation shape.
The worker requires the optional trusted verifier, bounds it to five seconds with
an AbortSignal, rejects invalid/late results and unproven legacy terminal states,
and returns the repository's durable outcome. The repository locks the job,
processor attempts and booking work, validates with database time, stores proof
atomically under `erasure_receipt.backupVerification`, and preserves other receipt
fields. Both exact replay and conflicting receipts are covered; the public
`startErasureAtomically` replay path now rejects unproven terminal status.

First-freeze verification on 2026-10-05 (historical counts; the patch-round totals below supersede these budgets):

| Command                                                                                                                                                              | Observed result                                                                                                                                                                                                                                                             |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pwsh -File scripts/check-development-environment.ps1 -RequireDocker`                                                                                                | PASS; Node 24.21.0, pnpm 11.9.0, Docker/Compose available; no failures                                                                                                                                                                                                      |
| `pnpm exec vitest run packages/worker/src/privacy-erasure.test.ts`                                                                                                   | Initial RED: 1 failed / 6 passed; absent verifier incorrectly returned `backup_verified`. Expanded RED: 35 failed / 11 passed, including an assertion rejection from the timeout test (test handling corrected). GREEN: 46/46, then 49/49 after processor recovery coverage |
| `II_TONYA_TEST_POSTGRES_ADMIN_URL=postgresql://ii_tonya_test@127.0.0.1:33110/postgres pnpm exec vitest run tests/integration/client-backup-erasure-evidence.test.ts` | PG 17.5, run 1 RED: 17 failed / 28 passed, including date-only certification and public legacy replay; run 2 GREEN: 47/47, including concurrent matching receipts and microsecond expiry mismatch. Budget remaining: 1/3                                                    |
| Same fixture, `pnpm exec vitest run tests/integration/privacy-workflow.test.ts`                                                                                      | GREEN: 3/3; run 1/3, budget remaining: 2/3                                                                                                                                                                                                                                  |
| `pnpm --filter @ii-tonya/contracts build`; corresponding `db` and `worker` builds                                                                                    | PASS. Initial DB declaration build identified a row-interface/index-signature mismatch; corrected to a type alias and rebuilt successfully                                                                                                                                  |
| `pnpm --filter @ii-tonya/contracts typecheck`; corresponding `db` and `worker` typechecks                                                                            | PASS after builds                                                                                                                                                                                                                                                           |
| `pnpm exec tsc --noEmit -p tsconfig.tests.json`                                                                                                                      | PASS; initial exact-optional test fixture errors corrected                                                                                                                                                                                                                  |
| Changed TypeScript files: `pnpm exec eslint`; all changed code/docs: `pnpm exec prettier --check`; `git diff --check`                                                | PASS                                                                                                                                                                                                                                                                        |

Author self-review covered timeout/late resolution, strict evidence parsing,
database clock/precision, competing receipts, row/child locks and public replay.
Independent adversarial review and exact-SHA release/CI evidence remain with main;
this work is `in-review`, not a release certification. No full or multi-path test
command ran. Navigation replay and catalogue-worker PG files were not run.

Real backup/provider/processor evidence remains unavailable. A trusted production
verifier still needs authentic inventory or deletion-attestation evidence and
reviewed coverage/configuration. Historical rows without proof fail closed and
are not rewritten. This fixes a false proof boundary, not all erasure coverage or
a provider's real retention practices; restore remains separately gated.

## Suggested Review Order

1. [Shared strict evidence contract](../../../packages/contracts/src/backup-erasure.ts).
2. [Worker verification and terminal replay](../../../packages/worker/src/privacy-erasure.ts), then [worker cases](../../../packages/worker/src/privacy-erasure.test.ts).
3. [Repository transition and public replay](../../../packages/db/src/repositories/privacy-repository.ts), then [PostgreSQL cases](../../../tests/integration/client-backup-erasure-evidence.test.ts).
4. [Retention operations contract](../../operations/data-retention.md) and [execution plan](../plans/2026-10-05-backup-erasure-evidence.md).

## Bounded independent-review patch round — 2026-10-05

The controller triaged all three reviewers' findings and assigned one sole-writer
patch round under the existing owner authorization, including the separate web landmark slice. This supersedes the
initial author's self-review assessment above. All requested implementation
patches are applied and locally verified; status stays `in-review`. Main owns
fresh independent closure, real-browser checks and external release evidence.
Repository writes are frozen again. No commit, push, deploy, provider call,
schema/dependency change or production activation occurred.

Independent extra diagnostic accounting: the verification reviewer ran one inline
`node --import tsx` program against the existing localhost33110 PG17.5 fixture,
with two cases (wrong `backup_verified_at`, expiry changed by one microsecond).
Its generated database was removed with `fixture.stop`; no container/repository
file was added and no focused Vitest file was invoked. This diagnostic is separate
evidence, not a fourth focused-file invocation.

| Finding                                                                | Severity              | Patch and closure evidence                                                                                                                                                                                                                                                                       | State                                                       |
| ---------------------------------------------------------------------- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------- |
| R1: terminal worker reads bypass DB time/precision and work validation | High                  | `getJob` locks parent then children and validates existing proof with DB time and exact stored timestamp precision. Both worker entry points are tested using the real repository for wrong verified time, microsecond expiry, future proof and corrupted work; valid replay remains available   | Implemented; PG GREEN                                       |
| R2: public terminal policy/work binding absent                         | Medium                | Public replay checks completed processor/booking work and explicit server-owned `privacyMutationCapability.activeBackupPolicyVersion`. Missing/changed policy denies terminal certification only; tests preserve nonterminal replay                                                              | Implemented; PG GREEN                                       |
| R3: blocked event loop beats timeout callback                          | High                  | `performance.now()` deadline check rejects and aborts late results even before the timer fires. Controlled monotonic-clock regression failed before the patch; no test-only production injection API added                                                                                       | Implemented; worker RED→GREEN                               |
| R4: child→parent dead-letter lock order and stale downgrade            | Medium                | `deadLetter` locks the parent first and rejects completed-job downgrade. `pg_blocking_pids` barriers show completion waiting for processor and booking downgrades before rejecting without changing the job/receipt; NOWAIT demonstrates no child lock is held while dead-letter waits on parent | Implemented; PG GREEN                                       |
| R5: no-JS landmark and keyboard skip focus                             | Medium                | Preserve `div#app`/catalogue main; add labelled fallback main+h1 with exact old fallback sentence. Compose JS pages with noscript inactive; check unique target, main containment, tabindex. Add tabindex=-1 only to existing landing/consent/legal targets                                      | Implemented; web RED→GREEN; fresh browser closure with main |
| R6: evidence custody, commands, canonical IDs                          | Low                   | Restore both individual retention/privacy-service commands; document authentic digest retrieval, controlled custody/access/retention and trusted active policy. Strict lowercase UUID binding has a RED→GREEN regression                                                                         | Implemented; documentation and unit evidence                |
| R7a: policy rescheduling/supersession                                  | Deferred prerequisite | Recorded in [deferred-work.md](deferred-work.md); old-policy jobs stay fail-closed pending a reviewed workflow                                                                                                                                                                                   | Activation blocked                                          |
| R7b: durable database invariant for later child writes                 | Deferred prerequisite | Recorded in [deferred-work.md](deferred-work.md). Row locks serialize only until commit; arbitrary SQL/old binaries can still change child work later. App replay revalidates; no migration authorized                                                                                           | Activation blocked                                          |

Rejected/unknown/unavailable verifier responses retain the approved fixed
content-free error. No telemetry redesign or unrelated review fixes were added.
The current API composition intentionally has no active backup policy binding,
manifest-capture adapter or exposed erasure route; no configuration default was
invented. Activation additionally needs a real verifier and authentic provider
evidence, approved protected evidence custody, the deferred prerequisites and
separate restore approval.

### Exact patch-round commands and results

Each Vitest line was its own invocation; no full/multipath suite ran.

| Command                                                                                                                                                                                                                                                                                                                                                                             | Result                                                                                                            |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `pwsh -File scripts/check-development-environment.ps1 -RequireDocker`                                                                                                                                                                                                                                                                                                               | PASS, no failures                                                                                                 |
| `pnpm exec vitest run packages/worker/src/privacy-erasure.test.ts`                                                                                                                                                                                                                                                                                                                  | RED 2 failed/49 passed (deadline, UUID); GREEN 51/51                                                              |
| `pnpm exec vitest run apps/web/src/html-landmarks.test.ts`                                                                                                                                                                                                                                                                                                                          | RED 1 failed/7 passed (fallback), then 7 failed/1 passed (fallback + six focus targets); GREEN 8/8                |
| `pnpm exec vitest run apps/web/src/index-shell.test.ts`                                                                                                                                                                                                                                                                                                                             | GREEN 5/5                                                                                                         |
| `pnpm exec vitest run apps/web/src/catalog-view.test.ts`                                                                                                                                                                                                                                                                                                                            | GREEN 5/5; inherited correction preserved                                                                         |
| `pnpm exec vitest run packages/worker/src/data-retention.test.ts`                                                                                                                                                                                                                                                                                                                   | GREEN 3/3                                                                                                         |
| `pnpm exec vitest run packages/application/src/privacy-service.test.ts`                                                                                                                                                                                                                                                                                                             | GREEN 9/9                                                                                                         |
| `II_TONYA_TEST_POSTGRES_ADMIN_URL=postgresql://ii_tonya_test@127.0.0.1:33110/postgres pnpm exec vitest run tests/integration/client-backup-erasure-evidence.test.ts`                                                                                                                                                                                                                | Final GREEN 61/61; focused file **3/3 used, zero remaining**. Initial round: RED 17 failed/28 passed, GREEN 47/47 |
| `II_TONYA_TEST_POSTGRES_ADMIN_URL=postgresql://ii_tonya_test@127.0.0.1:33110/postgres pnpm exec vitest run tests/integration/privacy-workflow.test.ts`                                                                                                                                                                                                                              | GREEN 3/3; focused file **2/3 used, one remaining**                                                               |
| `pnpm --filter @ii-tonya/contracts build`                                                                                                                                                                                                                                                                                                                                           | PASS                                                                                                              |
| `pnpm --filter @ii-tonya/db build`                                                                                                                                                                                                                                                                                                                                                  | PASS                                                                                                              |
| `pnpm --filter @ii-tonya/worker build`                                                                                                                                                                                                                                                                                                                                              | PASS                                                                                                              |
| `pnpm --filter @ii-tonya/web build`                                                                                                                                                                                                                                                                                                                                                 | PASS; built bundle available for main's browser sidecar                                                           |
| `pnpm --filter @ii-tonya/contracts typecheck`                                                                                                                                                                                                                                                                                                                                       | PASS                                                                                                              |
| `pnpm --filter @ii-tonya/db typecheck`                                                                                                                                                                                                                                                                                                                                              | PASS                                                                                                              |
| `pnpm --filter @ii-tonya/worker typecheck`                                                                                                                                                                                                                                                                                                                                          | PASS                                                                                                              |
| `pnpm --filter @ii-tonya/web typecheck`                                                                                                                                                                                                                                                                                                                                             | PASS                                                                                                              |
| `pnpm exec tsc --noEmit -p tsconfig.tests.json`                                                                                                                                                                                                                                                                                                                                     | PASS                                                                                                              |
| `pnpm exec eslint packages/contracts/src/backup-erasure.ts packages/db/src/repositories/privacy-repository.ts packages/worker/src/privacy-erasure.ts packages/worker/src/privacy-erasure.test.ts tests/integration/client-backup-erasure-evidence.test.ts apps/web/src/html-landmarks.test.ts apps/web/src/landing-view.ts apps/web/src/consent-view.ts apps/web/src/legal-view.ts` | PASS                                                                                                              |
| `pnpm exec prettier --check` on the exact patch paths below; `git diff --check`                                                                                                                                                                                                                                                                                                     | PASS                                                                                                              |

### Exact final paths

Changed during this bounded patch round:

```text
packages/contracts/src/backup-erasure.ts
packages/db/src/repositories/privacy-repository.ts
packages/worker/src/privacy-erasure.ts
packages/worker/src/privacy-erasure.test.ts
tests/integration/client-backup-erasure-evidence.test.ts
apps/web/index.html
apps/web/src/html-landmarks.test.ts
apps/web/src/landing-view.ts
apps/web/src/consent-view.ts
apps/web/src/legal-view.ts
docs/operations/data-retention.md
docs/superpowers/implementation-artifacts/deferred-work.md
docs/superpowers/implementation-artifacts/spec-backup-erasure-evidence.md
docs/superpowers/implementation-artifacts/spec-web-main-landmark.md
docs/superpowers/plans/2026-10-05-backup-erasure-evidence.md
docs/superpowers/plans/2026-10-05-web-main-landmark.md
```

Inherited candidate changes preserved without further edits in this round:

```text
packages/contracts/src/index.ts
packages/worker/src/privacy-erasure.testkit.ts
tests/integration/privacy-workflow.test.ts
apps/web/src/catalog-view.ts
apps/web/src/catalog-view.test.ts
```

The gitignored plan ledger and diagnostic logs under
`.superpowers/sdd/2026-10-05-backup-erasure-evidence/` record the local run history.
All unrelated pre-existing untracked files remain untouched.

## Independent patch closure — 2026-10-05

The independent verification reviewer inspected the final frozen diff against
`dce8b2e` and returned closure PASS with no remaining concrete correctness or
regression blockers in this bounded change. This was a read-only closure: no
extra PostgreSQL invocation or test execution. The reviewer confirmed terminal
DB validation, active policy/work binding, monotonic deadline, lock order and
stale-downgrade protection, exact-proof idempotency, canonical IDs, web fallback,
and the accurately deferred activation prerequisites.

Main independently ran the worker file (51/51), composed web file (8/8), API and
app-worker typechecks, and whitespace check: all PASS. Real Chrome against the
final local build at 05:42:57 UTC passed all seven routes with unique main/skip
targets, correct navigation ancestry, actual Enter-key focus, one h1 and no390px
overflow; a separate JavaScript-disabled context passed all seven fallback pages
with zero API/external requests. Temporary local preview servers were stopped.
PG counts remain 3/3 for backup evidence (61/61) and 2/3 for privacy workflow (3/3).

No result above is a full-suite pass, real provider attestation, human Trust CI
receipt, or commercial launch certification. Those release/activation limits
remain unchanged; the owner has separately authorized controller-operated RC
publication and production deployment of the safe bounded changes.

## Code decisions and execution

Shared wire evidence belongs in packages/contracts/src/backup-erasure.ts; both db and worker already depend on contracts. Export a strict schema and inferred types through contracts index; no new dependency edge or manifest edits. Use evidenceVersion:1, jobId:UUID, policyVersion bounded machine identifier max128, expiresNoLaterThan/verifiedAt canonical UTC ISO timestamps, method enum inventory_attestation|deletion_attestation, verifierId bounded machine identifier max128 and receiptSha256 lowercase64hex. Exact unknown fields fail. Opaque digest is a verified attestation reference, not itself proof; only a trusted server verifier may produce the accepted result, never a public route or client-supplied boolean. No built-in production verifier is supplied.

Store this object under erasure_receipt.backupVerification and return it as backupVerification on getJob. Existing erasure_receipt keys must survive; malformed non-object receipts cannot be silently discarded. CompleteProcessors accepts verificationState scheduled only. Both verifyExpiredBackup and runErasureWorkflow early terminal returns validate legacy backup_verified evidence rather than recertifying a historical date-only row. Also guard PostgresPrivacyRepository.erasureReceipt: startErasureAtomically replays existing jobs through this separate public receipt path and currently returns backup_verified solely from status. For a terminal receipt, select and validate the bound persisted proof against the job row and DB time before returning success; missing/invalid legacy evidence raises a fixed incomplete-evidence failure, never a false completed receipt. Cover this actual public replay path in the new PG file. Missing/invalid evidence throws a fixed incomplete-evidence result and does not rewrite historical immutable facts.

Use a bounded verifier timeout with AbortSignal; no successful transition from a late result after timeout. Recheck configured policy version against scheduled and attested version. Repository verifies with database clock_timestamp() inside its transaction, not caller time, and returns persisted state; same proof idempotency compares all bound fields, not digest alone. Predicate/lock must also ensure no extra/unknown processor row and no unfinished booking work. No production/provider calls, no nested writers, no commit/push/deploy. Main owns external release and independent review. Existing isolated branch is the worktree; no new checkout. No story_key so sprint sync not applicable.
