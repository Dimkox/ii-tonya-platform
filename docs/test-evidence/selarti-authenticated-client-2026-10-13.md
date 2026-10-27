# Selarti authenticated client — author evidence, 2026-10-13

## Scope and identity

Spec: [authenticated client](../superpowers/implementation-artifacts/spec-selarti-authenticated-client.md).
Its frontmatter `context: []` lists no additional files. The complete spec was
read before implementation; its approved requirements were preserved.

- Worktree: `.worktrees/review-2a3484e6-20261013` in the canonical repository.
- Branch: `codex/selarti-authenticated-client-20261013`.
- Baseline: `f0e125f4441d9bb5858b44ff5f3b6da4495ae34f`.
- Origin: `https://github.com/Dimkox/ii-tonya-platform.git`.
- Initial target worktree status: only the supplied, untracked spec.
- Author changes: new factory and focused tests, integrations exports, runbook,
  this evidence, and spec task checkboxes. No existing REST source/tests changed.

The implementation order was tests and RED, fresh authentication and ownership
validation, restricted delegation to the existing REST class, exports/runbook,
static checks, GREEN, and evidence/task audit. The provider boundary alone is
synthetic; tests use real `Response`/streams and the existing `SelartiRestClient`.

## Commands and outcomes

All commands ran in the target worktree unless a log path is absolute.

| Command                                                                                                                                                                                                                                                                                                                                                                    | Outcome                                                                                                                                                                               |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `git status --short`, `git rev-parse --show-toplevel`, `git remote get-url origin`, `git branch --show-current`, `git rev-parse HEAD`                                                                                                                                                                                                                                      | Confirmed the identity above before edits.                                                                                                                                            |
| `pwsh -File scripts/check-development-environment.ps1`                                                                                                                                                                                                                                                                                                                     | Exit 0; Node 24.21.0, pnpm 11.9.0, PowerShell 7.6.6; no failures. `.env` absent, as expected for synthetic tests.                                                                     |
| `pnpm exec vitest run packages/integrations/src/selarti/authenticated-client.test.ts > /tmp/selarti-authenticated-client.Divjhs/red.log 2>&1`                                                                                                                                                                                                                              | Author run 1, RED: exit 1, 93/93 failed because `createAuthenticatedSelartiClient` did not yet exist. Started 11:06:16 UTC; duration 1.31s. Full failed output retained at that path. |
| `pnpm --filter @ii-tonya/integrations typecheck`                                                                                                                                                                                                                                                                                                                           | Exit 0.                                                                                                                                                                               |
| `pnpm exec tsc --noEmit -p tsconfig.tests.json`                                                                                                                                                                                                                                                                                                                            | Exit 0.                                                                                                                                                                               |
| `pnpm exec eslint packages/integrations/src/selarti/authenticated-client.ts packages/integrations/src/selarti/authenticated-client.test.ts packages/integrations/src/index.ts`                                                                                                                                                                                             | Initial exit 1: unused `_init` in the new test helper; corrected before GREEN. Final exit 0.                                                                                          |
| `pnpm exec vitest run packages/integrations/src/selarti/authenticated-client.test.ts > /tmp/selarti-authenticated-client.Divjhs/green.log 2>&1`                                                                                                                                                                                                                            | Author run 2, GREEN: exit 0, 93/93 passed. Started 11:08:59 UTC; duration 1.23s. Output retained at that path.                                                                        |
| `pnpm exec prettier --check packages/integrations/src/selarti/authenticated-client.ts packages/integrations/src/selarti/authenticated-client.test.ts packages/integrations/src/index.ts docs/runbooks/selarti-rest-client.md docs/test-evidence/selarti-authenticated-client-2026-10-13.md docs/superpowers/implementation-artifacts/spec-selarti-authenticated-client.md` | Exit 1 solely for the supplied spec's formatting; preserved its task-only edit restriction.                                                                                           |
| `pnpm exec prettier --check packages/integrations/src/selarti/authenticated-client.ts packages/integrations/src/selarti/authenticated-client.test.ts packages/integrations/src/index.ts docs/runbooks/selarti-rest-client.md docs/test-evidence/selarti-authenticated-client-2026-10-13.md`                                                                                | Exit 0; all implementation/runbook/evidence files formatted.                                                                                                                          |
| `git diff --check`                                                                                                                                                                                                                                                                                                                                                         | Exit 0.                                                                                                                                                                               |
| `git diff --exit-code HEAD -- packages/integrations/src/selarti/rest-client.ts packages/integrations/src/selarti/rest-client.test.ts apps/worker/src/client-async-composition.ts`                                                                                                                                                                                          | Exit 0; protected source/test/composition files unchanged.                                                                                                                            |

The integrations/tests typechecks were repeated after correcting the test-helper
typing and passed again. No production source changed after GREEN. No old tests,
full/multi-path suite, pre-push gate, nested agents, commits, pushes, secret reads,
provider calls or production operations were performed.

## Matrix audit

| Spec scenario    | Executed coverage in the 93-test GREEN run                                                                                                                                                                                                                                                                                                |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Valid binding    | Real REST send/read results; exact auth/task/AI HTTP contract; private token; fresh token per call; uninterpreted `expires`; default fetch; valid ID/key boundaries and exact URL encoding.                                                                                                                                               |
| Wrong binding    | Foreign active company; absent/duplicate/foreign task and AI rows; wrong task.AI; lowercase `ai` alone; non-success ownership envelopes; zero message requests.                                                                                                                                                                           |
| Auth failure     | Invalid success envelope, invalid/missing token and active company; no task/AI/message request after rejection.                                                                                                                                                                                                                           |
| Invalid config   | Missing, nonstring, empty, blank, control, oversized and malformed IDs; missing/blank/whitespace/control/oversized API keys; malformed options/fetch; zero network calls.                                                                                                                                                                 |
| Resource failure | HTTP error, redirected response, declared and actual oversize, invalid UTF-8/JSON, absent/erroring body at all three stages; invalid content lengths; exactly 64 KiB streamed multibyte envelopes; stalled headers/bodies and late-body cancellation at each stage; one total deadline; monotonic checks for timer-starving empty chunks. |
| Bound operation  | Options mutated immediately after invocation; mutated invalid binding remains unavailable; foreign task/company extras ignored; real REST rejects foreign responses and invalid send/read inputs.                                                                                                                                         |
| Send ambiguity   | HTTP 401/500 and timeout remain unknown, exactly one send and no reauthentication; before/after-write transport classification preserved.                                                                                                                                                                                                 |

No test is skipped or filtered within the new focused file.

## Limits and handoff

Author-owned test budget is **2/2 consumed**. Coordinator run 3 is reserved until
independent review. This is author-local verification, not independent review,
release evidence or provider/customer acceptance. The spec status remains
`in-progress`; only its implementation task checkboxes were updated.

The ready result proves authenticated company/task/AI binding only. It neither
proves subscription/billing nor supplies answer causality, durable request/thread
correlation, ordinary worker composition, polling or delivery. The coordinator's
recorded live configuration has a task/AI mismatch and must return unavailable;
the author made no live call or provider configuration change. Token expiry is
not inferred and tokens are not persisted/cached. Ambiguous sends require durable
reconciliation, never automatic resend. The injected fetch seam is trusted to
retain verified TLS, like the existing REST client.

Remaining gates belong to the coordinator: independent source review, reserved
final focused run, and any separately authorized release/integration work.

## Independent review patch — author handoff

The coordinator reported independent review complete and authorized one scoped
patch batch, explicitly forbidding another author Vitest run. The historical
commands, **93/93 GREEN** result and matrix audit above describe the original
author revision, not the patched source. The coordinator also reported formatting
the spec and running the integrations build; the author did not repeat that build
or alter the spec. Its current status is `in-review`.

Tests were added before the getter/proxy fix, but were not executed under this
instruction. The patched file contains **123 tests, UNRUN until coordinator run 3**:

- Six getter/proxy cases: both send properties, all three read properties and
  revoked send/read proxies. Each requires a returned Promise resolving to the
  appropriate invalid-input result and no network after acquisition.
- Three cumulative-overflow cases, one at each acquisition stage. Valid JSON
  envelopes of 71680 bytes arrive in chunks no larger than 4096 bytes without
  Content-Length. They require cancellation on the 17th chunk (69632 cumulative
  bytes) and no later request. Every response fixture remains valid if the size
  guard is removed, so incorrect per-chunk accounting cannot pass by hitting an
  unrelated malformed envelope later.
- Eighteen bounded-cleanup cases: rejecting or indefinitely pending cancellation
  at each stage, for immediate response failure, stalled body timeout and late
  body arrival. Immediate failures must settle before the timeout; all require
  no unhandled rejection or subsequent provider request.
- Three fetch-rejection cases after the outer timeout, one per acquisition stage,
  with no unhandled rejection or later request. Cleanup tests allow a real event
  loop turn to observe unhandled rejections while deadline timers remain synthetic.

Bound send/read methods now read properties into plain local inputs inside a
pre-delegation catch and return Promise-safe `not_applied/invalid_input` or
`error/invalid_input`. Delegation remains outside the catch, so a post-delegation
failure cannot be mislabeled as local non-application. Existing REST code/tests,
token grammar and production non-awaiting cleanup are unchanged.

The runbook now states that binding proof is a point-in-time snapshot, not a
lease; callers must reacquire before each bounded dispatch batch and after
provider configuration changes. There is no atomic ownership-GET-to-send
guarantee or inferred token TTL. No caller-abort, caching or TTL API was added.

Scoped patch checks:

- `pnpm --filter @ii-tonya/integrations typecheck` — exit 0.
- `pnpm exec tsc --noEmit -p tsconfig.tests.json` — exit 0.
- `pnpm exec eslint packages/integrations/src/selarti/authenticated-client.ts packages/integrations/src/selarti/authenticated-client.test.ts packages/integrations/src/index.ts` — exit 0.
- `pnpm exec prettier --check packages/integrations/src/selarti/authenticated-client.ts packages/integrations/src/selarti/authenticated-client.test.ts packages/integrations/src/index.ts docs/runbooks/selarti-rest-client.md docs/test-evidence/selarti-authenticated-client-2026-10-13.md` — exit 0 after formatting owned files.
- `git diff --check` — exit 0.
- `git diff --exit-code HEAD -- packages/integrations/src/selarti/rest-client.ts packages/integrations/src/selarti/rest-client.test.ts apps/worker/src/client-async-composition.ts` — exit 0.

SHA-256 of the updated source/test, obtained with `sha256sum`:

```text
7d551323cab82e2d09cb9321541f8feabc0ba519e6ba0e6115fdedb2377dede3  packages/integrations/src/selarti/authenticated-client.ts
c587048f9e828eda616e694eee569f3cde0e4401316a78d96b88110401d5099c  packages/integrations/src/selarti/authenticated-client.test.ts
```

Historical author logs remain at their original paths and were not modified:

```text
568950192f050a5d730d944c25a971e5b9b4bc8dbc9e261e2c617b582cfc4b15  /tmp/selarti-authenticated-client.Divjhs/red.log
57527614c4c7026e098af131dc12b7f0fc005477a10747b59be3e024ca414b7b  /tmp/selarti-authenticated-client.Divjhs/green.log
```

No Vitest invocation, old tests, provider call, secret read, commit, push or
production operation was performed for the patch. Author test budget remains
2/2 consumed; coordinator run 3 remains reserved. New tests and the patched
behavior have static-check evidence only until that run. Worker/polling/durable
correlation and live configuration mismatch limitations remain unchanged.

## Coordinator final verification — 2026-10-13 11:28 UTC

BMad independent reviewers Poincare, Bohr and Banach inspected the complete diff.
Actionable corrections were safe Promise-returning input normalization,
cumulative small-chunk overflow coverage, cleanup failure coverage and explicit
snapshot/reacquisition documentation. Bohr rechecked the exact hashes above and
found no remaining concrete defect in the scoped patch. No reviewer ran tests or
edited source. Spec formatting was normalized before final verification.

Coordinator session33379 ran exactly the reserved third invocation:

`pnpm exec vitest run packages/integrations/src/selarti/authenticated-client.test.ts`

Result: exit0, **123/123 passed**, one file, no skips. Start11:27:59 UTC,
duration1.36s. This closes the unrun-patch notes above; budget3/3 is now consumed.
Reviewed source/test hashes remain7d551323/c587048f as listed above.
Coordinator session52828 also completed integrations/tests typechecks, scoped
ESLint, formatting including the spec, and whitespace checks without errors.
The integrations package built successfully before the narrow input-handling
patch; that earlier build alone is not final-source build evidence.

Full logs are preserved outside temporary storage under the main checkout's
`.native-release/selarti-authenticated-client-20261013/`:

```text
568950192f050a5d730d944c25a971e5b9b4bc8dbc9e261e2c617b582cfc4b15  author-red.log
57527614c4c7026e098af131dc12b7f0fc005477a10747b59be3e024ca414b7b  author-green.log
cfd594d4f1eb19dd970d9a914ed2846f761644c10d32c8da844d49782ab6135e  coordinator-final.log
```

Compiled-client probe42437 used real configuration for authentication and task
ownership only. It returned `unavailable/binding_unverified`; no message send/read,
generation or paid operation was invoked. This probe preceded the getter patch;
the authentication code was unchanged by that patch. Separate read-only probe71282
found one configured-company task, zero tasks selecting the configured AI, and no
alternative binding. Credential values, identifiers and provider bodies were not
printed or persisted. This is a configuration blocker, not subscription evidence.

No full suite, old exhausted tests, hosted CI or Database Gate ran. No new ordinary
worker capability, durable correlation, polling, runtime flag or production
activation is part of this change. Production remainsf0. The commercial goal is
active, not achieved by this factory or by123 passing synthetic checks.

Final-source build/probe38790 completed exit0 after the reviewed getter patch:
`pnpm --filter @ii-tonya/integrations build` produced ESM and declarations, then
the compiled public export returned `unavailable/binding_unverified` with real
configuration. No send/read method, generation or paid operation was invoked.
The final implementation/test hashes above were unchanged by this build.
