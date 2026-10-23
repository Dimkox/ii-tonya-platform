# BlockA authorized invocation4 infrastructure failure

The owner explicitly authorized exactly one additional invocation of
`pnpm exec vitest run tests/integration/phase1-promo.test.ts` after the three-run
budget and corrected fixture review. Coordinator consumed that authority once.
Source remained `bea76b2748aa030494f172c58aac43ed15694d7e`, including the reviewed
`::text` fixture correction. No source/test expectations changed.

## Actual result

Invocation4 exited1: all15 cases skipped because beforeAll could not create its
isolated test database. `startExternalPostgresDatabase` received `Connection
terminated unexpectedly` at CREATE DATABASE, before migrations/application cases.
The fixture correction did not execute. Log: `/tmp/phase1-promo-owner-extra4.log`.
This is neither a passing suite nor an extra functional verification.

The retained owned project was `ii-tonya-phase1-promo-20261023`, image
`postgres:17.5-bookworm`. Invocation3 connected through its direct Compose IP;
invocation4 used its published loopback port55482. Both reached the same server;
no evidence establishes that this transport difference caused the failure.
No environment values or credentials were printed.

At14:37:07UTC the server logged backend9942 exit2, terminated other processes and
entered internal recovery. At14:37:13 it accepted connections again. No diagnostic
identified why the backend exited. Container state showed no OOM kill, container
restart or memory limit. Host memory was available. Root filesystem was99%full
with5.8GBavailable; this alone does not establish disk exhaustion as the cause.
Read-only independent audit confirmed this evidence and its limits.

## Infrastructure isolation

Original instance/data retained for diagnosis. A separate task-owned Compose
project `ii-tonya-phase1-promo-owner-recovery-20261023` now runs the same17.5 image
on loopback55483, its own generated volume,1CPU/1GiB memory and256MiB shared memory.
Its generated Compose configuration is private `/tmp` local state with mode0600;
credentials are task-generated and never committed, copied from real environments
or printed. Other databases/containers/worktrees were not modified.

Infrastructure-only smoke checked actual server_version_num170005, TCP connection,
CREATE and DROP of a unique empty environment-probe database. PASS. This executed
no repository migrations, domain SQL/assertions, fixture or application test. Log:
`/tmp/phase1-promo-infrastructure-recovery.log`. It is readiness evidence only,
not a disguised rerun or a claim of application correctness.

## Exact continuation gate

Original file invocations1–3 plus owner-authorized4 are consumed. Invocation5 is
NOT authorized. Do not rerun the file, expired-quote SQL equivalent or broaden to
old/full/provider suites. Request exactly one new focused-file invocation on the
fresh owned17.5 environment. BlockA remains pending its runtime gate; B/C/D/Phase2
must not begin. All source reviewers/owners and commands are terminal.

No provider request, paid operation, push, deployment, live flag or production
mutation occurred. The broader approved plan remains required after this gate.
