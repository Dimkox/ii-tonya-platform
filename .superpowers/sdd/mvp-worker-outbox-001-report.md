# MVP-WORKER-OUTBOX-001 implementation report

Status: implementation, independent review and the final exact-SHA Claw gate are
complete. Release and deployment remain NO-GO pending separate authorization.

## Identity and scope

- Branch: `codex/mvp-worker-outbox-001`
- Exact merged base: `0bfb6efc4b2145dfc5f4ba4763fa6264f422f842`
- Binding docs commit: `3ca009c7ab2974e3c2f088866939152614c153f3`
- No provider activation.
- No production deployment, push, merge, GitHub Actions run, migration, image
  build, Compose prune, or retained-container deletion.

## Implementation

- Task 1 added the exact false-by-default flag and lazy fail-closed composition.
- Task 2 added a frozen two-topic registry with exact decoders and typed terminal
  results.
- Task 3 gave every claim, exhaustion, unknown, and expired-lease database path
  the validated topic filter while preserving omitted-filter legacy behavior.
- Task 4 added idempotent privacy-bounded local case materialization and durable
  inspection. Safety uses authoritative escalation ID/version/state. Feedback
  uses authoritative rating/hash/policy/state; valid missing or ineligible
  locators produce the bounded source-invalid delivery-failure case.
- Task 5 made enabled and disabled runtime ownership mutually exclusive and
  added closed worker metrics labels. Enabled recovery runs inside the filtered
  runner; disabled mode retains the legacy batch and standalone legacy recovery.

## Focused Claw evidence to date

| Task                | RED                                                       | GREEN exact SHA | GREEN result                                         |
| ------------------- | --------------------------------------------------------- | --------------- | ---------------------------------------------------- |
| 1                   | 2 files, 30 tests: 16 pass / 14 fail                      | `9f0db2a`       | 2 files, 30/30 pass                                  |
| 2                   | 1 suite failed at missing module, 0 collected             | `5a06de3`       | 1 file, 24/24 pass                                   |
| 3                   | 2 files, 19 tests: 13 pass / 6 fail                       | `c1b8fa4`       | 2 files, 19/19 pass                                  |
| 4                   | 2 suites failed at missing module, 0 collected            | `7563e13`       | 2 files, 7/7 pass                                    |
| 5                   | 3 files, 17 tests: 9 pass / 8 fail                        | `58d63c7`       | 3 files, 17/17 pass                                  |
| 6                   | 2 files, 5 tests: 3 pass / 2 missing-doc failures         | `bc935cd`       | 2 files, 5/5 pass after one assertion-only fix rerun |
| Review remediation  | 2 failed files: 2 failing tests plus 1 collection failure | `af83fac`       | 2 files, 10/10 pass in 11.24s                        |
| Metric capability   | 1 file, 4/4 causal failures                               | `44d0955`       | 1 file, 4/4 pass in 4.22s                            |
| Bounded exhaustion  | 1 file, 1 pass / 1 causal failure                         | `249b4f3`       | 1 file, 2/2 pass in 6.27s                            |
| Final reviewed gate | verification-only new file                                | `9f5d258`       | 1 file, 1/1 pass in 7.85s; not repeated              |

Successful focused suites were not repeated. Tests ran only inside retained
Claw container `ii-tonya-test-yookassa` against the single existing PostgreSQL
service. No test database or test backend remained after PostgreSQL suites.

## Independent-review remediation

The first full-diff adversarial review found no Critical and five Important
issues: incomplete enabled-registry validation could fail after a filtered
mutation; authoritative source reads were not row-locked; pre-claim exhaustion
lacked per-topic metrics; the owned-topic tuple was duplicated between worker
and database layers; and the real enabled production composition/recovery path
was not covered by PostgreSQL evidence.

Remediation now validates the registry before filtered outbox repository
construction or database mutation, derives worker and database ownership from
one frozen contracts tuple, locks authoritative safety/feedback rows, returns
and records filtered exhaustion counts, and exposes the real production composition seam. The new focused Claw
suite exercises fail-before-repository validation, authority races, real
filtered recovery/exhaustion/metrics/ambiguity and provider-row exclusion. Two
diagnostic precursor reruns exposed assertion/module-resolution and prepared-SQL
fixture defects (8/10 pass, then 1/2 collected tests pass); neither was accepted
as GREEN. Exact `af83fac` passed 10/10 with zero residual test databases,
sessions or Vitest processes.

Re-review found three further Important gaps: a non-callable metric recorder was
not rejected before filtered repository construction, detailed exhaustion was
not bounded by the runner batch limit, and real SQL metric evidence did not
assert exact records. Exact `44d0955` validates the recorder before repository
construction (isolated Claw RED 4/4, GREEN 4/4). Exact `249b4f3` uses ordered
`FOR UPDATE SKIP LOCKED LIMIT` candidates in both detailed exhaustion phases and
passes the runner limit through; its real-PostgreSQL suite was RED 1/2 and GREEN
2/2 while deep-equaling exact topic/phase/outcome/reason/count records for both
owned topics. Post-suite cleanup was zero test databases, sessions and Vitest
processes.

The independent reviewer then approved exact
`0bfb6efc..9f5d258bfa578b85781d8eb26410e56725c64b53` with no Critical or
Important findings. All eight Important findings and the documentation Minor
were closed.

## Static evidence and incidents

Claw direct Prettier and bounded tsup builds passed for changed package layers.
The app-worker ESM bundle passed with workspace imports externalized. Its DTS
bundle could not resolve newly built workspace artifacts through Claw's retained
stale file-linked `node_modules`; observability, worker, database, config,
contracts, domain, and integrations ESM/DTS builds themselves passed.

One unintended local `pnpm exec` invocation hydrated an ignored, store-linked
`node_modules` directory before any test ran. It changed no tracked file or
lockfile and executed no test. No further local pnpm/npm/test/build/format
command was used. The exact ignored directory was verified inside the isolated
worktree and removed before handoff.

## Completion and release boundary

- Independent review: APPROVED at exact `9f5d258`, no Critical or Important.
- Final one-shot Claw PostgreSQL gate: 1 file, 1/1 pass in 7.85s; not repeated.
- Cleanup: exact base restored; zero feature files, generated dist, task archives,
  Vitest processes, test databases and test sessions; retained container Up.
- Durable evidence:
  `docs/test-evidence/claw/9f5d258bfa578b85781d8eb26410e56725c64b53-mvp-worker-outbox-001/verification.md`.

No implementation gate remains. Release and deployment remain NO-GO pending
separate human authorization and target-environment approval.
