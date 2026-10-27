# Public Client Catalogue Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. The repository BMad workflow assigns one implementation writer; user explicitly requests continuous execution, no additional approval round.

**Goal:** Anonymous, non-persistent browsing and ordinary selection of published services.

**Architecture:** A stateless Fastify public projection reads the existing verified
catalogue repository. A browser page filters the bounded projection locally and
never invokes private session or provider paths.

**Tech Stack:** Existing Node 24, pnpm 11.9.0, Fastify, TypeScript, Vite, Vitest.

**Spec:** `docs/superpowers/implementation-artifacts/spec-public-client-catalog.md`.

## Global Constraints

No new dependencies, migrations, production seeds, personal-text inputs or
changes to financial/provider/expert authority. Manual SQL policy remains intact.
Use bounded single-file focused tests; main owns aggregate/release verification.

## Review Focus

- Private extra fields accidentally included in a public row: exact output test.
- Anonymous route accidentally gated by login flags: real default composition test.
- HEAD/body/query/unsupported method reaches repository: negative route tests.
- Failure or timeout shown as genuine no services: client/view behavior tests.
- Injected HTML or late retry overwrites rendered state: DOM regression.

### Task 1: Stateless public API

**Files:** Create `apps/api/src/routes/public-client-catalog.ts` and its test;
modify `apps/api/src/app.ts`, `apps/api/src/server.ts`; add focused composition test.

**Interfaces:** Consume `PostgresCatalogRepository.listPublicServices({limit:20})`;
produce `GET /v1/public/catalog` returning only the 3 fields named by the spec.

- [ ] Add RED app-injection tests: anonymous 200, projection, failure, input denial.
- [ ] Run `pnpm exec vitest run apps/api/src/routes/public-client-catalog.test.ts`;
      expected missing route behavior failures, not missing imports.
- [ ] Implement route, optional app dependency and real default composition.
- [ ] Run the same focused file GREEN and focused composition test separately.

### Task 2: Browser catalogue and local filters

**Files:** Create catalogue client/view and tests in `apps/web/src/`; modify
`main.ts`, `landing-view.ts`, `consent-view.ts` navigation as needed.

**Interfaces:** Consume Task 1's fixed projection through credential-free GET.
Produce safe rendering and local service/language select filters only.

- [ ] Write RED client/view tests for decoding, failure/timeout and filtering.
- [ ] Implement bounded fetch, safe rendering, navigation and local selectors.
- [ ] Run each focused test file separately and real DOM smoke with synthetic rows.
- [ ] Run API/web/tests typechecks, changed-file lint, builds, whitespace checks.
- [ ] Record RED/GREEN commands and transfer frozen diff to main for independent
      review and release. Do not commit/push/deploy from the implementation agent.

## Execution Ledger

Ruling: reuse the existing `codex/fin-001-client-access-policy` checkout and
approved factory scope, preserving unrelated untracked files. A new worktree,
approval questionnaire or dependency reinstall is unnecessary for this continuation.
Ruling: code and tests proceed while real legal/provider inputs are inventoried;
no unavailable capability is enabled to produce a green test.

## Independent-review PATCH ledger — 2026-10-05

Main completed three independent review layers and authorized a single remediation
writer. Preserve the spec's `in-review` status and checked implementation tasks;
review-remediation closure remains pending receipt/acceptance of the frozen report.
No re-derivation, aggregate suite, commit, push or deployment is part of this batch.

- API: Node-supported methods registered before the all-method route; real HTTP
  PROPFIND/MKCOL and chunked GET/HEAD regressions; process-shared 60/min rate and
  two-promise admission; three-second HTTP deadline with release only on actual
  DB settlement; fixed diagnostic enums. Default composition adds transaction-local
  one-second lock and two-second statement timeouts.
- Client/view: matching visible-text/bidi rules, retained ZWJ, pre-parse 64KiB byte
  bound and cancellation, loaded-subset copy, response-time focus ownership, single
  main landmark, actual binding regression without dependencies.
- Browser harness: initial held-request synchronization, all-request allowlist
  including same-origin traffic, held retries and actual Tab-away focus checks.
- Verification: API 59/59, default composition 1/1, PostgreSQL 3/3, client 42/42,
  view 5/5 and binding 4/4. Each file invoked separately. Real-browser harness,
  API/web/DB typechecks/builds and test typecheck passed. Initial failures and exact
  commands are retained in the spec's remediation-results section.
- PostgreSQL budget: prior 1 + remediation RED 1 + GREEN 1 = **3/3** for
  `tests/integration/client-catalog-worker.test.ts`; do not rerun this file locally.
- Pool acquisition remains internally pending when unavailable, bounded by two
  outstanding public operations. No new pool/global database change. Service-code
  relabelling was rejected: no approved business mapping exists.
