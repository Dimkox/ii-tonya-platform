# Technology-reality review — MVP-CLIENT-BOOKING-001

## Verdict

**FAIL — zero Critical, three Important, one Minor finding.** The chosen stack and brownfield seams are real, migration allocation is correctly dynamic, and the package does not require a live provider. The implementation plan is not yet executable as written because its final Claw invocation has no capable exact-base adapter, its PostgreSQL version claim conflicts with the default integration harness, and one required test is misclassified as an existing file.

Review basis: local Git root `C:/Users/Dmitry/Documents/Codex/2026-07-28/new-chat/work/ii-tonya-platform/.worktrees/mvp-client-booking-001`, `origin=https://github.com/Dimkox/ii-tonya-platform.git`, exact base `3db7ad1f3c76a58ebe6478863226c12e83ce306c`. No network evidence was used.

## Findings

### Important TR-1 — the exact-base Claw adapter cannot execute the immutable booking manifest

**Evidence:** Task 5 requires one pinned-image Claw invocation that builds once and runs only the 15-file immutable manifest (`docs/superpowers/plans/2026-08-14-mvp-client-booking-001.md:421-443`). The only repository Claw adapter is `scripts/run-claw-ci.sh`; it accepts only `ci|database|release` (`scripts/run-claw-ci.sh:4-8`) and its `database` branch contains a hard-coded test list that ends without any client-booking files (`scripts/run-claw-ci.sh:71-88`). It exposes no manifest argument or booking mode. The adapter does pin a concrete image/ref and ID (`scripts/run-claw-ci.sh:29-35`), but the booking plan neither invokes this script nor defines another repository command that mounts the reviewed SHA, uses that image, supplies real PostgreSQL, executes the exact manifest, records the one-attempt evidence, and cleans up.

**Consequence:** Task 5 cannot be followed from repository instructions; an implementer must invent an unreviewed one-off Docker/Claw command at the single non-repeatable verification gate.

**Required fix:** add a versioned booking gate mode/script before implementation verification. It must reuse the pinned image checks and clean-source guards, accept no mutable test selection, run exactly the frozen manifest with the approved real-PG URL, record checksums/counts/cleanup, and be named verbatim in Task 5. Alternatively extend `run-claw-ci.sh` with a reviewed `client-booking` mode and exact tests for its semantics.

### Important TR-2 — terminal test PostgreSQL target was undocumented

**Evidence:** the local Compose deployment pin remains `postgres:17.5-bookworm` (`compose.yaml:28-29`), but the sole test-host service is `postgres`, PostgreSQL 16.0.15 (`server_version_num=160015`). The final immutable test gate must state and enforce its actual external test target rather than infer it from a separate deployment Compose file.

**Consequence:** without an exact test-target assertion, the one-shot final gate could consume its single invocation against an unintended database version.

**Required fix:** make the booking gate require the approved external DB source and assert/record the actual test target PostgreSQL 16.0.15 (`server_version_num=160015`) before consuming the single invocation.

### Important TR-3 — a nonexistent test file is specified as Modify

**Evidence:** Task 4 says to modify `packages/contracts/src/worker-outbox.test.ts` (`docs/superpowers/plans/2026-08-14-mvp-client-booking-001.md:332-335`), and both the focused command and immutable Claw manifest require it (`docs/superpowers/plans/2026-08-14-mvp-client-booking-001.md:363-368`, `427-443`). That file does not exist at exact base. The existing relevant tests are `packages/db/src/repositories/outbox-repository.test.ts`, `packages/db/src/repositories/outbox-repository-client-catalog.test.ts`, and `apps/worker/src/client-catalog-outbox.test.ts`.

**Consequence:** a task worker following the file contract can stop or patch the wrong layer; the claimed pre-existing harness for the provider non-dispatch proof is false.

**Required fix:** mark `packages/contracts/src/worker-outbox.test.ts` explicitly **Create**, or place the new assertions in named existing tests and update the focused/final manifests consistently.

### Minor TR-4 — several new test files are only implicit under `Test:` or wrapped `Create:` entries

`apps/api/src/client-booking-principal-resolver.test.ts`, `packages/application/src/client-booking-service.test.ts`, `packages/worker/src/client-booking-erasure.test.ts`, and all `tests/**/client-booking*.test.ts` files are absent at exact base. Their surrounding task sections imply creation, but only the paired production file is explicitly labeled `Create` in some wrapped lists (`docs/superpowers/plans/2026-08-14-mvp-client-booking-001.md:212-218`, `320-339`). Mark every absent file `Create` to make the file contract mechanically checkable.

## Confirmed reality

- Node is genuinely pinned to major 24 (`package.json` engines; `Dockerfile:3`, `52`); pnpm is `11.9.0` (`package.json`); PostgreSQL Compose is `17.5-bookworm` (`compose.yaml:29`).
- Lockfile resolutions support the generic stack claims: TypeScript 5.9.3, Fastify 5.10.0, Drizzle ORM 0.45.2 / Kit 0.31.10, Vitest 3.2.7, and `pg` 8.22.0 (`pnpm-lock.yaml:1959-1963`, `2203`, `2585`, `3025`, `3099`). The terminal test target is documented separately as PostgreSQL 16.0.15.
- `BookingService`, `createBookingService`, `PostgresBookingRepository`, `reserveAndPublish`, `transitionAndPublish`, the reservation state machine, audit/outbox insertion, capped serializable retry, catalog repository/retention, `PostgresOutboxRepository`, and the client catalog worker allowlist exist at the base.
- Privacy is a real brownfield seam: `PostgresPrivacyWorkflowRepository` and `packages/worker/src/privacy-erasure.ts` already exist. The proposed booking-local work relation/worker is correctly new, not claimed as existing implementation.
- The plan's migration allocation is reality-safe: the base journal ends at `0029_client_catalog_requests`, while the plan explicitly waits for principal merge/rebase, rereads the journal, and forbids reserving a number (`docs/superpowers/plans/2026-08-14-mvp-client-booking-001.md:17-20`, `90-109`).
- PowerShell, Git, pnpm, Vitest, Node, Drizzle, Docker/Compose, Testcontainers, and the Claw host adapter all exist in repository workflows. No SDK, credential, provider endpoint, or live Planerka/Telegram/payment tool is assumed; those remain disabled and approval-blocked.

## Gate

Close TR-1 through TR-3 and rerun this exact-base review before calling the architecture package implementation-ready. This review does not authorize a Claw run, provider access, deployment, or production mutation.

## Closure — 2026-08-14

### Closure verdict

**PASS — zero Critical and zero Important findings remain.** TR-1 through TR-3 are closed; Minor TR-4 is also closed. The `client-booking` adapter and its tests are planned implementation artifacts, not claimed current-base behavior, and their completion remains a prerequisite to consuming the one terminal invocation.

### Finding-by-finding status

- **TR-1 CLOSED — executable immutable Claw mode.** Task 4 now explicitly modifies the existing `scripts/run-claw-ci.sh` and workflow-semantics test, creates a PG preflight script, and requires a literal `client-booking` mode that reuses the existing host/pinned-image/SHA/cleanup guards (`docs/superpowers/plans/2026-08-14-mvp-client-booking-001.md:340-348`, `407-417`). The mode accepts no manifest argument or test selector; one fixed 16-file manifest is written into the plan (`docs/superpowers/plans/2026-08-14-mvp-client-booking-001.md:444-467`) and is invoked by exactly `bash scripts/run-claw-ci.sh client-booking` (`docs/superpowers/plans/2026-08-14-mvp-client-booking-001.md:469-475`). It builds once and launches one Vitest process with `--maxWorkers=1`; local semantics tests freeze the mode, manifest, redaction, clean-source guard, and cleanup without consuming the terminal gate (`docs/superpowers/plans/2026-08-14-mvp-client-booking-001.md:407-417`). This is executable by construction using the exact-base adapter's existing `case` mode, pinned image check, container script, trap, and evidence pattern.
- **TR-2 CLOSED — PostgreSQL test-target evidence boundary.** The plan, specification, traceability and runbook require the sole external test target PostgreSQL 16.0.15 (`server_version_num=160015`) before the one fixed Vitest process, forbid credential logging, and keep a pass/failure terminal. The adapter forwards `II_TONYA_TEST_POSTGRES_ADMIN_URL` without printing it and runs the version assertion first; the local PostgreSQL 17.5 Compose pin remains a separate deployment configuration, not this test-gate target.
- **TR-3 CLOSED — absent worker-outbox test is explicitly new.** `packages/contracts/src/worker-outbox.test.ts` is now labeled `Create`, while its source contract and the existing worker files remain `Modify` (`docs/superpowers/plans/2026-08-14-mvp-client-booking-001.md:340-348`). The focused and immutable manifests consistently include the created file (`docs/superpowers/plans/2026-08-14-mvp-client-booking-001.md:374-378`, `450-466`).
- **TR-4 CLOSED — every absent booking file is explicitly classified.** The plan now marks the absent schema, catalog-choice, repository, privacy, E2E, boundary, principal-resolver, client-booking-service, erasure-worker, worker-outbox, and PostgreSQL-assertion files as `Create` (`docs/superpowers/plans/2026-08-14-mvp-client-booking-001.md:68-74`, `160-168`, `231-238`, `330-350`). Existing files remain `Modify`; the terminal evidence file is explicitly `Create after implementation review` (`docs/superpowers/plans/2026-08-14-mvp-client-booking-001.md:423-431`).

### Residuals

- Critical: none.
- Important: none.
- Minor: none from TR-1 through TR-4.

This closure approves the documentation's technology reality only. It does not claim that the planned mode/script/tests exist yet, that PostgreSQL 16.0.15 was contacted, or that Claw, provider, activation, deployment, or production evidence has been produced.
