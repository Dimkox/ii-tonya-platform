# Phase0 guard reconciliation evidence

Base: `ece006aa03b035db770a04dbea1e843a96cb10cc`.
Owner authorized continued implementation of the entire approved plan and routine
fixes without per-step approval. All work remains isolated on
`codex/phase1-owner-plan-20261023`.

## Root cause and changes

Scope inventories omitted existing explicitly specified0042–0050 features and
five reviewed content changes. An independent source audit verified21 relations,
36 migration/state artifacts,8 authenticated routes,2 receipt modules and their
canonical contracts. Only explicit literal registrations/hashes were added.
SQL0050's three functions and two triggers were missing from exact inventories;
SQL, snapshots, frozen gaps and bigint-default lists were not changed.

A separate real authority concern was fixed in production source: the worker no
longer receives an unrestricted canonical event mint. The YooKassa verifier has
only its two required dependencies and internally mints only after the unchanged
authoritative GET/binding/terminal checks. The one shared WeakSet, schema/evidence
validation and frozen event identity remain intact. The public barrel exports no
internal mint. Three old test files were mechanically adapted to the constructor
and observable-brand interface; exhausted legacy/provider files were NOT rerun.

The recursive scope classifier now protects internal module/symbol access,
including import-equals, namespace/re-export, dynamic constants, require aliases,
Node createRequire and nested destructuring. Unknown runtime imports fail closed.
Two existing loopback DOM harnesses retain their reviewed external Playwright load
only under exact path AND normalized-content hash checks; internal authority
imports remain forbidden and modified content loses the exception.

## Verification

- Fresh scope RED:121/123; history RED:7/8.
- New real verifier authority file: expected RED, final GREEN10/10; actual GET,
  frozen runtime brand, deterministic canonical evidence and rejection coverage.
- New AST/bypass file: initial RED10fail/6pass; additional review probes reproduced
  import-equals, nonliteral imports and Node loader gaps. Final stable GREEN41/41.
- Preliminary staged scope122/123 exposed two legitimate DOM harness loads; exact
  reviewed-harness exceptions corrected the false positives. Final staged
  `pnpm exec vitest run tests/repo/scope-boundary.test.ts`: **123/123 PASS**.
- `pnpm exec vitest run tests/repo/migration-history-integrity.test.ts`: **8/8 PASS**.
- Integrations/worker builds and typechecks, app-worker typecheck, tests TypeScript,
  scoped ESLint/Prettier and `git diff --check`: PASS.
- Independent adversarial, edge and verification reviews performed; concrete
  import-loader findings fixed and rechecked. Final edge review returned no findings.

Detailed inventory: `docs/spec/phase0-guard-registration-audit.md`.
Local diagnostic logs are retained under `/tmp/phase0-guard-continuation-*` and
`/tmp/phase0-authority-*`; these are local diagnostics, not hosted release evidence.
No full suite, multi-path Vitest, PostgreSQL, exhausted test, provider request,
secret/environment mutation, push or deployment occurred in this repair.

## Remaining gates

This supersedes the earlier Phase0 scope/history failure status only. External
merchant delivery, physical processor/backup proof, full default lifecycle boot and
exact-SHA release evidence remain open. Nothing was activated. BlockA can use the
locally verified applicant schema without claiming paid/provider operation.
