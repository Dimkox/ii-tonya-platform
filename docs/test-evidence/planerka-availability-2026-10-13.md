# Planerka availability implementation evidence — 2026-10-13

## Final coordinator verification — 14:55 UTC

This section supersedes the pending handoff statements below; historical runs
remain recorded. All three new files have consumed3/3. No older or broad suite
was invoked, including the exhausted pre-push suite.

| File                                                  | Final invocation start UTC | Result     | Session |
| ----------------------------------------------------- | -------------------------- | ---------- | ------- |
| packages/worker/src/planerka-availability.test.ts     | 14:52:44                   | 35/35 pass | 34772   |
| tests/integration/planerka-availability.test.ts       | 14:53:01                   | 54/54 pass | 50800   |
| apps/worker/src/planerka-availability-runtime.test.ts | 14:53:54                   | 6/6 pass   | 38577   |

All95 cases passed. DB files used the owned PostgreSQL17.5 Compose service after
a read-only version/connectivity check. The expired controller forward was
replaced before either DB invocation; no failed retry consumed another test run.

Gauss independently accepted all12 remediation groups. Its only Important finding
was a self-modifying BEFORE INSERT fixture that could fail before the conditional
upsert predicate. Coordinator replaced it with a test-only executor wrapper and
a separate SQL UPDATE before the real upsert. The fixture asserts exact injected
lease, durable delay and rejection. Gauss accepted this narrow delta before run3.
Production SQL/code did not change after the grouped review. The new fixture SHA
is8b03eb4111bc871b6464e8fbcc97574861198d993e7c050fdb0c10aeea1da0ab.
Final scoped ESLint, test TypeScript check and git diff --check passed (52990).

Final log SHA256, under the ignored task evidence directory:

- worker-final3.log:69c5d4e3e1d45a25c7ddaab12abd36ec2dd135cb164d291ddc0e1486562af324.
- db-final3.log:0ace9a0d8886489edd1d24e8cc982f9a9c6bfd632ec6f0c7f107fc7fc6e113cd.
- runtime-final3.log:ec7fb76475a3f6eee4880c30cc1f69992614819fa0c218819f5700d37a127988.

Matrix audit: valid/duplicate/empty snapshots, stale workers, mapping invalidation,
catalogue freshness/occupancy, provider ownership/timezone/duration/mode errors,
malformed/failed responses, disabled/absent configuration all have passing focused
coverage. This proves the bounded source increment, not live provider activation,
hosted CI/Database Gate/Trust CI, payments or human commercial acceptance.
PG16.15 old-artifact compatibility and fresh encrypted-backup restoration have
separate coordinator operational evidence; exact new artifact/deploy is subsequent.

Baseline: `f31d968d4465f31501726f19c8e50c177046bca1`.
Worktree: `.worktrees/review-2a3484e6-20261013`, branch
`codex/planerka-availability-20261013`. No commit, push, agent dispatch, remote
operation, real credential read, provider request or production mutation was made.
The supplied spec and both frontmatter context files were read before implementation.
The approved plan supplies the implementation decisions; frozen spec text is unchanged.

## Changes

- Hand-authored0051 SQL, contiguous journal, schema declaration and database-derived
  snapshot/supplement/manifest. All predecessor SQL bytes are unchanged.
- Durable per-service claims, DB clock/window,90second fencing,120/30second retry
  timing, post-lock expiry checks, atomic empty/nonempty publication and invalidation.
  Slot UUIDs/external IDs/capacity and all reservation history are preserved.
- Ordinary worker imports one service after booking work, validates profile/type/
  interval facts and uses shared account admission and bounded authenticated GETs.
- Catalogue filters eligibility, freshness,24hour lead and remaining capacity before
  ordering/limit. Configuration is opt-in and preserves the disabled object/report shape.
- Three new test files exercise provider contracts, real PostgreSQL and the ordinary
  factory with real catalogue consumption. Existing exhausted tests were not invoked.

Supporting scope expansion: `packages/integrations/src/planerka/client.ts` permits
a missing range end only when `duration` was explicitly supplied and validated by
the existing query schema. `packages/integrations/src/index.ts` exports the existing
`planerkaSlotsSchema` for the worker to reuse. No other transport behavior changed.
The new worker tests use genuine `createPlanerkaClient` to cover accepted missing/null
ends with duration, rejection without duration, and rejection of invalid duration
before HTTP. This narrow expansion was acknowledged by the coordinator.

## Test budget and results

Each file has consumed exactly2 invocations. Invocation3 belongs to the coordinator.

| Exact `pnpm exec vitest run` target                     | Invocation1 UTC                        | Invocation2 UTC       |
| ------------------------------------------------------- | -------------------------------------- | --------------------- |
| `packages/worker/src/planerka-availability.test.ts`     | 13:26:19:29 failures, missing importer | 13:37:09:30/30 passed |
| `tests/integration/planerka-availability.test.ts`       | 13:26:23:setup failed,18 skipped       | 13:37:31:21/21 passed |
| `apps/worker/src/planerka-availability-runtime.test.ts` | 13:26:28:setup failed,3 skipped        | 13:38:12:3/3 passed   |

The first database invocations failed `ECONNREFUSED` because the Compose internal
network did not publish the requested host port. These are setup failures, NOT RED
behavior evidence. Docker inspection showed PostgreSQL17.5 running on its isolated
container address. A task-owned loopback TCP forward repaired access; a direct
`show server_version_num` returned170005 before invocation2. No extra RED retry or
hidden duplicate suite was run. Worker RED established the missing implementation.

Database commands used `II_TONYA_TEST_POSTGRES_ADMIN_URL` pointing to the disposable
Compose service, with the existing testkit creating and dropping isolated databases.
Only synthetic fixtures were used. Full logs are retained in ignored
`.native-release/planerka-availability-20261013/{worker,db,runtime}-{red,green}.log`.

Invocation2 covers stable legacy/generated UUIDs, retained reservations, successful
empty windows, stale response/defer fencing, competing claims, expiry during a slot
lock wait, disabled/remapped/deleted mapping invalidation, expert/service eligibility,
claim tampering, legacy capacity/time/identity ambiguity, failed-refresh freshness,
stale/occupied/past/near catalogue filtering, provider rejection modes, admission
bounds, end-date inclusivity, and disabled/ordinary runtime behavior.

## Final self-review adjustment — coordinator verification pending

After the green runs, self-review found that moving a mapping's service primary key
must invalidate the destination service as well as the original service. The0051
trigger now locks affected services/experts/refreshes/slots in sorted order and clears
both services' observations and leases. A new integration regression was added:
`invalidates both services when a mapping is moved to a different service`.
The integration file now contains22 tests. This final trigger/regression has NOT had
a Vitest run; reserved invocation3 must verify it and the regenerated metadata.
SQL replay/introspection was repeated to derive final state, not to rerun old tests.

## Static and migration checks

- `pwsh -File scripts/check-development-environment.ps1 -RequireDocker`: passed,
  Node24.21.0, pnpm11.9.0, Docker29.9.0, Compose5.6.0.
- Separate `pnpm --filter @ii-tonya/{db,worker,config,app-worker,integrations}
typecheck` invocations: passed.
- The plan's `pnpm typecheck:tests` script does not exist. Equivalent
  `pnpm exec tsc --noEmit -p tsconfig.tests.json` was used and passed.
- Scoped ESLint passed for all changed/new TypeScript files, including integrations.
- Builds of integrations, db, config and worker passed; db was rebuilt after the
  repository's batched publication implementation. Generated build output is ignored.
- SQL replay on PostgreSQL17.5 and fresh-directory `drizzle-kit introspect`0.31.10
  produced0051 metadata via `normalizeMigrationSnapshot`, with predecessor0050 and
  input hashes. The new integration test compared fresh introspection, every
  constraint/index, function/trigger definitions and input/output hashes successfully
  before the final self-review adjustment. `drizzle-kit generate` was never run.

## Handoff and limits

Independent review and exact final-source invocation3 are outstanding. No hosted CI,
Database Gate, Trust CI, live subscription, production deployment or human product
acceptance is claimed. Coordinator-owned PG16 compatibility work is separate from
this PostgreSQL17.5 evidence. Existing broad-suite budgets remain exhausted.
The first two DB-backed files lack valid pre-implementation RED behavior evidence;
their setup failures are preserved explicitly above.

Final test typecheck, scoped ESLint and whitespace checks passed after the final
trigger/regression adjustment. Final0051 SQL replay and introspection also passed;
generated JSON was formatted and manifest output hashes refreshed accordingly.

The task-owned PostgreSQL17.5 Compose service is retained for coordinator run3:
project `planerka-availability-20261013`, container
`planerka-availability-20261013-db`, loopback port55471 forwarded to its internal
address. It contains only disposable test data and the Compose placeholder login.
The controller forward is exec session77865. Remove only this task's forward,
container, network and volume after the coordinator finishes. No shared resource
or customer data should be removed.

Initial implementation handoff SHA-256 hashes (superseded by the grouped remediation
hashes below; retained as historical evidence, excluding this evidence file):

```text
84b31b2105c9047dc01b8432df0bf2316f3475430953fd1a7391e78a5b9f9bf4  .env.example
c0b5fc97665fc31f4b6109988d40e2e3f27673246c6226ae0aeea7925c72281d  apps/worker/src/main.ts
a095c476f6682947524246b65e473af1342daafe8ee0d7506ae5e20d5f39727e  apps/worker/src/runtime.ts
024bd839e42ca07bfc973630a8288ffc50c85a976407c104e4909f371835c660  apps/worker/src/planerka-availability-runtime.test.ts
9c07210bfe06eb6fd52a3e74bfe710bb54ad1f2e3dc4610ef6b7b23e786ee18a  packages/config/src/env.ts
7c659fd6722671b9086be5e7e94cc90f25902f30bd65851675fcdbe79c17b5e4  packages/db/src/index.ts
f8fd496035a0d6c0398b570f3291ae7379cfcc7c5fb40c4a73440eb3370d36f7  packages/db/src/schema/booking.ts
93000f01e35da459e5006fc5235d45e96d0451b589fde7aef7d30336b249bd2e  packages/db/src/repositories/catalog-repository.ts
ee2ec2b090bc4bac59a7ccc398713bae73430961d37ce6aa15e8a9454a8daedc  packages/db/src/repositories/planerka-availability-repository.ts
dc9249eae9908078f5db5b9b211d2a7436531cf87e55bb6cb45a8843a1680a4d  packages/db/migrations/0051_planerka_availability.sql
894b0539a62e91561478c66c97abaceeb0aebb52b9a2f280d1c0ad757cd7b46a  packages/db/migrations/meta/_journal.json
94fe0b47a395f8e7d8bfff46f1f040aad365b25836fc405b25cdd508f0a8b71e  packages/db/migrations/meta/0051_snapshot.json
48b81449512efe0cd4b56f5b1597aadf3da5f090b2e5a930fb38688b6e6f3fe0  packages/db/migrations/state/0051_sql_objects.json
1139781a97dae081f4d6de103adf98a00981b91976eb1f34101550ce18a3c0c9  packages/db/migrations/state/0051_manifest.json
e523ef9f49399ae88822e5ee4bf6ba80178cb56b400cbbd43b1aa536ff2d5f41  packages/worker/src/index.ts
918973a5db5b9217a1bd36367b55fdb44add7eee2821ddc4c94e75d795ce71a2  packages/worker/src/planerka-availability.ts
869c77722cf23b8a565fbd3a03079f9652b8db327e72386319e422af3d3a6fa7  packages/worker/src/planerka-availability.test.ts
1abb1651e4713f4b95dcaa42c77a9d0d66a2d480b818052cc9bbdcb3920e5d2b  packages/integrations/src/index.ts
ab1af73bdd967e939f01a1088d6e3295a5281937fddbf0c2855ae088725eff0b  packages/integrations/src/planerka/client.ts
fc870d9a268fadf7cea36a7fdb25cd793d68ef21964e9f397098c87f1171c597  tests/integration/planerka-availability.test.ts
99f29ceeb6df04e2ffed992b9c726bff5679bf604312132cbbef69045eba61e8  docs/runbooks/planerka-api-client.md
```

## Grouped review remediation handoff — 2026-10-13

All12 coordinator patch groups are implemented against the unchanged frozen intent.
No Vitest command, old test suite, pre-push gate, nested agent, commit, push, remote
operation or live provider call was performed in this remediation turn.

| Group | Implemented change and new consumer regression                                                                                                                                                                                                                                                                                                                                                               |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1     | Newest snapshot51,123 tables,43 functions and73 triggers; exact function/trigger inventories and provenance through0051. The old historical-gap and bigint baselines are unchanged. New integration metadata checks include the actual slot index and inventory.                                                                                                                                             |
| 2     | New mapping/service/expert/refresh/slot row locks use NOWAIT; contention aborts the whole transaction. Worker returns fixed database_busy outcomes; unrelated failures still propagate. Real held service/expert/slot regressions prove rollback and mapping availability to booking. Mapping mutation contention remains SQLSTATE55P03 for whole-transaction retry.                                         |
| 3     | Claim rechecks durable due/lease state after locking and the conflict UPDATE has its own current due/lease predicate. A real PostgreSQL BEFORE INSERT race fixture exercises the conditional conflict branch; ordinary competing-claim coverage remains.                                                                                                                                                     |
| 4     | Window arithmetic and CHECK use168 absolute hours. The non-UTC session regression exercises a DST boundary with fixed test dates without changing the production clock.                                                                                                                                                                                                                                      |
| 5     | Publication selects only the service/window and relevant external identities; a partial Planerka service/start index is declared and migrated. A held unrelated historical row must not obstruct publication.                                                                                                                                                                                                |
| 6     | Mapping INSERT invalidates existing observations, alongside UPDATE/DELETE and source/destination transfers. Tests cover insertion and disable/restore of the exact same mapping while the original lease remains otherwise live.                                                                                                                                                                             |
| 7     | Both catalogue readers suppress expert reservation overlaps across slots/services, preserve same-slot non-Planerka capacity, and independently enforce mapping eligibility. Tests restore synthetic freshness after trigger invalidation to avoid masking absent/disabled/future/duration mapping failures; active, expired and cancelled reservations are covered.                                          |
| 8     | Valid final-day intervals ending beyond the window are validated then omitted; other choices remain publishable. Malformed duration/bucket cases still fail.                                                                                                                                                                                                                                                 |
| 9     | An availability-only option on the common limiter checks durable actionable/in-flight booking work including retry delay, applies50ms lock_timeout and NOWAIT, and preserves the original booking admission branch. Pending creation depends on createEnabled; manual/terminal work does not starve imports. Real limiter tests cover backlog, actual recovery progress and a held account row with no HTTP. |
| 10    | Ordinary factory tests cover recovery ON/availability OFF with a real synthetic recovery operation, and durable admission exhaustion after preflight with unchanged freshness/no GETs and a fixed rate-limit report.                                                                                                                                                                                         |
| 11    | A test-only PostgreSQL insert trigger delays the late write path past lease expiry. A nontransactional sequence proves that path was reached; observations, inserted rows and publication watermark must roll back together. No production test hook was added.                                                                                                                                              |
| 12    | Ordinary factory emits only fixed outcome and count fields through the existing sanitized logger. Tests use real logger output, including rejection of extra sensitive fields. The runbook provides bounded read-only inspection of current failure states and last-publication age.                                                                                                                         |

The earlier test that waited for a held slot has been adapted to the required
nonblocking outcome. Lease-expiry verification is retained in the dedicated late-write
rollback regression and stale-worker tests, rather than silently dropping that requirement.
The narrow optional factory logger input accepts a genuine existing logger in the
composition regression; its default is the ordinary sanitized production logger.
The mapping fixture now explicitly distinguishes initial unrefreshed legacy rows
from synthetic already-observed rows, since INSERT itself now invalidates freshness.

### Verification and run budgets

- Worker file:2/3 consumed; last executed GREEN2 was30/30 before remediation.
- PostgreSQL integration file:2/3 consumed; last executed GREEN2 was21/21 before
  the final initial adjustment and grouped remediation.
- Ordinary runtime file:2/3 consumed; last executed GREEN2 was3/3 before remediation.
- Both modified repository guard files remain unexecuted; their exhausted budgets
  were respected. No new test case in this remediation is claimed as passing.
- Environment check with RequireDocker passed. PostgreSQL17.5 SQL replay and fresh
  introspection passed after the final SQL edits. Snapshot normalization, supplement,
  manifest and formatted output hashes were regenerated; previous SQL bytes remain
  unchanged. No drizzle-kit generate.
- Separate typechecks for db, worker, config, app-worker, integrations and
  observability passed. Final test typecheck, scoped ESLint (including both guards),
  formatting and whitespace checks passed.
- Database, observability and worker builds passed to refresh local declaration/
  runtime outputs required by genuine package consumers. One overlapping test
  typecheck saw declarations temporarily removed by the database build; after
  that build completed, the sequential test typecheck passed. No source or guard
  was weakened for this transient setup issue.
- Logs remain in the ignored evidence directory under remediation-*.log.

### Remaining work and risks

No known required patch group is intentionally left unimplemented. Final execution
of the new consumer/concurrency regressions remains the coordinator's reserved run3;
static checks and SQL derivation are not evidence that those regressions passed.
Re-review of the grouped patch, PostgreSQL16 compatibility, deployment/activation,
live provider access and human product acceptance remain separate. The prior
access_denied provider result is unchanged by this source work.

Final remediation source SHA-256 hashes (excluding this self-referential evidence file):

```text
84b31b2105c9047dc01b8432df0bf2316f3475430953fd1a7391e78a5b9f9bf4  .env.example
0cea2c8c208588365605741682e0996f80f406238a670658a9069256227ff4d7  apps/worker/src/main.ts
a095c476f6682947524246b65e473af1342daafe8ee0d7506ae5e20d5f39727e  apps/worker/src/runtime.ts
e0d4419d039370832c1d8ae125c7dce8d8e6c3e58d49607b5e6d026f128cbb3a  apps/worker/src/planerka-availability-runtime.test.ts
9c07210bfe06eb6fd52a3e74bfe710bb54ad1f2e3dc4610ef6b7b23e786ee18a  packages/config/src/env.ts
7c659fd6722671b9086be5e7e94cc90f25902f30bd65851675fcdbe79c17b5e4  packages/db/src/index.ts
f8fd496035a0d6c0398b570f3291ae7379cfcc7c5fb40c4a73440eb3370d36f7  packages/db/src/schema/booking.ts
70b945deb2bedfaa46ea33e9364a16394b2c8f332cbce0645a4d4ea68d66b78b  packages/db/src/schema/catalog.ts
3913876467d739a052c2e9f6e2c941934f081fbe2dbd4aa1310068a4742e276d  packages/db/src/repositories/catalog-repository.ts
b5685ded959f6a01abba00fb3b1757d85fa0d8b378c5c386e2d2dedd6d024c17  packages/db/src/repositories/planerka-availability-repository.ts
653fe7d99c203c36dd7d620a8246c2c0a1a8d74a1dfcd84a40e025c4cc774f4e  packages/db/src/repositories/planerka-booking-repository.ts
d8d48425445b6bc80e7b1d027a5141b433507db725b9673a8e516e177008c89e  packages/db/migrations/0051_planerka_availability.sql
894b0539a62e91561478c66c97abaceeb0aebb52b9a2f280d1c0ad757cd7b46a  packages/db/migrations/meta/_journal.json
3dec3981713de32d2b1364d00c15dac3b69c112c4daf9229a44b2e96e9f2e9d0  packages/db/migrations/meta/0051_snapshot.json
f23ca8d3c899704fd3752b0f0afec92e41eb100ad9680e418c1517ba359bc01f  packages/db/migrations/state/0051_sql_objects.json
f28767f69946495114ec8fbe638606b37a821b18d1f7951cf45c9e5899293012  packages/db/migrations/state/0051_manifest.json
e523ef9f49399ae88822e5ee4bf6ba80178cb56b400cbbd43b1aa536ff2d5f41  packages/worker/src/index.ts
d2f298c92850238d983a2a39c4c9c5cea4ba9c20bb255bb83994586c69f037c4  packages/worker/src/planerka-availability.ts
bee5f0165fb444347c64e411bff9febc88bb3b9cccb1dfdffd9922022cdaf6b1  packages/worker/src/planerka-availability.test.ts
1abb1651e4713f4b95dcaa42c77a9d0d66a2d480b818052cc9bbdcb3920e5d2b  packages/integrations/src/index.ts
ab1af73bdd967e939f01a1088d6e3295a5281937fddbf0c2855ae088725eff0b  packages/integrations/src/planerka/client.ts
57c8406f25b668393d50df17aa1203b9066ae5d3e11efb7148783b9ea7fa1857  packages/observability/src/telemetry-schema.ts
5fd029bbb75f4fdc2bd235710c18f7c50f771ac79fc31e069bd0f0b352dce93b  tests/integration/planerka-availability.test.ts
569217df533958f4c3885c059082a6b9cbf2e8ecde8f540b80048a255a89932d  tests/repo/migration-history-integrity.test.ts
48a55c5f0828c1dbd2e748df58c47310162e1ead0dcc5532e4bc80c6e99873e1  tests/repo/migration-state-baseline.test.ts
475c68af3f151b3891ded5a65b8d23918b2c558b99cb2612a6416d90861f166a  docs/runbooks/planerka-api-client.md
```
