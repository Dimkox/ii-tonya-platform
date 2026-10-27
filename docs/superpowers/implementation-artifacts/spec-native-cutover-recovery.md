---
title: "Bounded native cutover with verifiable recovery"
type: "bugfix"
created: "2026-10-13"
status: "in-progress"
baseline_commit: "4357ad2268b4a5e70a00f063a06c115a58de1332"
review_loop_iteration: 0
context: []
---

<frozen-after-approval reason="commercial release requires recoverable deployment">

## Intent

**Problem:** The native deployment switches current before migrations with live
Restart=on-failure services. Its error handler ignores recovery failures and deletes
the candidate even if current still selects it. Validation does not contact target.

**Approach:** Validate and stage first; quiesce both services before unit/symlink
changes, migrate with bounded waits, then start and verify. Preserve all release
artifacts on failure, report recovery failure separately and verify the restored
application. Rollback never claims to undo committed database migrations.

## Boundaries & Constraints

**Always:** Canonical root /opt/ii-tonya-platform, pinned SSH host key and existing
restricted sudo commands. Validate exact SHA, runtime and signed artifact before
quiescence. Verify both services stopped before switching. SQL lock timeout10s,
statement timeout120s, migration service TimeoutStartSec180s; abort on timeout.
Restoration is best-effort but its failures must be aggregated, surfaced and never
converted to success. Preserve incoming and candidate directories after failure.
Check API readiness, active services and fresh heartbeat belonging to current
worker PID. All loops bounded; no credentials or customer records in diagnostics.

**Ask First:** New privileged commands not already available, changed operational
deadline requirements, irreversible data repair, or exhausted test reruns.

**Never:** Delete artifacts during uncertain recovery; hide restoration errors;
start candidate against uncompleted migrations; call validate successful without
target access; restore a database backup automatically over production writes.
No application/financial behavior changes or provider calls in this increment.

## I/O & Edge-Case Matrix

| Scenario                 | Input / State                      | Expected Output / Behavior                                      | Error Handling                                                          |
| ------------------------ | ---------------------------------- | --------------------------------------------------------------- | ----------------------------------------------------------------------- |
| Valid release            | Signed candidate, ready target     | Stage, stop/verify, install units/switch, migrate, start/verify | Bounded checks                                                          |
| Preflight failure        | Missing inputs, target or approval | No quiescence or switch                                         | Nonzero diagnostic                                                      |
| Quiescence failure       | API or worker remains active       | Never switch current                                            | Preserve artifacts and restore prior service state                      |
| Migration failure        | SQL/lock/deadline failure          | No candidate application start                                  | Restore prior application only if compatible; report schema uncertainty |
| Health failure           | Candidate not ready                | Restore previous units/current                                  | Verify recovery independently                                           |
| Recovery failure         | Unit/link/restart/check fails      | Preserve both releases and incoming                             | Distinct nonzero recovery result                                        |
| First deployment failure | No previous release                | Stop candidate safely, preserve artifacts                       | Explicit no-previous recovery limitation                                |
| Stale worker signal      | Old PID or unchanged heartbeat     | Reject readiness                                                | Bounded timeout                                                         |

</frozen-after-approval>

## Code Map

- `scripts/deploy-native-remote.sh`: validate exits at38; rollback ignores worker
  readiness; error handler131 suppresses recovery then157 deletes; switching178–187
  precedes migration. Preserve checksum/source/runtime validation order.
- `deploy/systemd/ii-tonya-migrate.service`: uses current/api, currently no timeout.
  Quiescence allows existing fixed path without introducing new privileged tools.
- `scripts/migrate-native.mjs`: construct migration-only PG pool with explicit
  per-connection timeout options; ensure every migrator connection receives bounds.
  Do not add limits to ordinary application pools or trust transaction start time.
- `packages/db/src/client.ts`: current createDb accepts only connectionString.
  Extend with optional typed connection settings if needed for the migrator; keep
  existing callers unchanged. Do not import undeclared pg/drizzle dependencies
  directly from the deployed API entrypoint: its package only depends on the DB
  workspace package. Reject conflicting URL options that bypass timeout bounds.
- `apps/worker/src/main.ts:725`: heartbeat already at /tmp; do not change worker.
  Service PrivateTmp requires reading /proc/<MainPID>/root/tmp/ii-tonya-worker-heartbeat.
- `tests/repo/native-rollback-drill.test.ts`: reuse shell-shim fault testing pattern,
  but existing exhausted tests cannot be executed without separate permission.
- `tests/repo/native-production-release.test.ts`: reconcile only assertions actually
  changed by safe sequence; no weakened signature/runtime invariants.

## Tasks & Acceptance

**Execution:**

- [ ] Modify deploy script and migration unit/entrypoint for bounded, quiescent
      cutover and honest recovery. Keep successful deployment cleanup scoped; failure
      preserves artifacts even if recovery succeeds, retaining diagnostic evidence.
- [ ] Add `tests/repo/native-cutover-recovery.test.ts` using isolated temp directories
      and command shims to execute actual remote shell bodies, not only string assertions.
- [ ] Add `tests/repo/migrate-native-timeouts.test.ts` to verify migration-only connection timeout
      configuration and cleanup on failure without contacting production.
- [ ] Record exact tested source, failure cases, target preflight, remaining0050
      compatibility requirement in `docs/test-evidence/native-cutover-recovery-2026-10-13.md`.

**Acceptance Criteria:**

- Given an old service may restart, when migration starts, then both services have
  been stopped and candidate startup cannot occur until migration succeeds.
- Given link restoration fails, when recovery ends, then no selected release path
  is deleted and command reports recovery failure distinctly.
- Given a stale heartbeat, when health checks run, then active systemd state alone
  cannot produce success; require advancing heartbeat and stable current MainPID.
- Given successful application recovery, when reporting it, then committed migration
  state is not represented as rolled back; database compatibility remains explicit.

## Spec Change Log

## Design Notes

Owner delegated technical choices; coordinator selected this design, not a human
acceptance certificate. Follow docs/superpowers/plans/2026-10-13-native-cutover-recovery.md.
Sole implementer owns named deployment/migrator/DB-client files, two new tests,
and own evidence. Payment files are frozen under separate review; do not edit them.
No nested agents, staging, commits, push, real SSH/systemctl or production effects.
Run source and shim checks only. Preserve shared status and review guide edits.
If a required decision cannot be implemented within these boundaries, report it
before broadening scope. Record each test invocation immediately.

Choose short bounded downtime over adding new privileged transient units. Existing
systemctl stop suppresses automatic Restart behavior for intentional stops; verify
inactive state before cutover. Handle partial stop failure by recovering both old
services without switching. A stopped service can still be externally started;
this automation assumes exclusive release ownership and must reject concurrent
deploy/rollback through a scoped host lock before mutation.

### Reviewed operational decisions

Existing installation admission requires both previous application services active
and healthy. Initially inactive/failed services cause preflight refusal, not a
silent repair. Record quiescence_started before the first stop; partial stop failure
restores both previously active services, even before any unit/link switch.
The fixed current/api migrator means exact ordering is stop/verify both, install
candidate units, switch current, migrate, then start applications. No application
start or restart is issued until the migration process is terminal.

Use a fresh unique incoming directory for each upload, never overwrite a shared
SHA directory. The final remote shell holds unprivileged flock on
/opt/ii-tonya-platform/.deployment.lock, acquisition timeout10s, through validation,
mutation and recovery. Manual rollback takes the same lock. Before quiescence,
write an in-progress marker containing previous/candidate identity and phase. A
later invocation finding this marker refuses mutation; SIGKILL/disconnect cannot
turn unknown prior cutover into permission for a new one. Trap ERR/HUP/TERM/INT
where possible; retain marker and artifacts if recovery is incomplete.

After migration timeout/error, request stop and verify service inactive plus
MainPID=0 before changing selected paths. If process termination or database
commit state cannot be established, keep applications stopped, retain marker and
report manual recovery required. Never infer SQL rollback from a shell exit.
Automatic old-application restart after migration began requires explicit
prevalidated compatibility evidence binding old SHA, candidate SHA and complete
migration manifest. Evidence must cover committed candidate schema as well as old
schema; missing compatibility means preflight refusal before downtime. This is an
input to the release process, not a boolean fabricated by the deploy script.

For first installation, absent units are allowed only when no previous current
exists and no live application process is reported. Failed installation stops and
disables installed application units, removes their installed unit files and
unselects current only if it still equals this candidate. Preserve release files;
verify the safe state and report any failed action. Existing approved sudo
install/systemctl/rm commands suffice; do not assume privileged shell/flock.

SSH uses ConnectTimeout10 plus ServerAliveInterval5/ServerAliveCountMax3. Target
health polling has overall60s and each curl max-time5/connect-timeout2. Readiness
requires stable worker MainPID and start identity around two advancing namespace
heartbeat reads, both newer than startup, using a budget of max60s or twice the
validated configured poll interval plus10s, capped300s; reject larger configuration
at preflight. Per-command service waits must be bounded and report failure, never
rely on a loop surrounding an unbounded command. Do not kill arbitrary processes.

Migration connection settings reject decoded/repeated URL options and timeout
parameters that could override the chosen bounds; reject nonempty inherited
PGOPTIONS rather than silently overriding operator configuration. Apply bounds to
every pool connection and verify backend termination separately after timeout.

Read-only production probe2026-10-13 observed heartbeat mtime1791851163 against
server epoch1791851164 via process-root namespace, without sudo. Migrate unit
TimeoutStartUSec=infinity confirmed. This proves probe feasibility, not recovery.

## Verification

Two new files each authorRED1/GREEN2, coordinator final3 after independent review.
No full/multi-path/exhausted runs. Run bash syntax, scoped lint/format, relevant
types. Fault shims must cover every matrix case and assert no deletion on failure.
No real systemctl, SSH mutation, provider call or deploy during development.
Final live activation still requires exact artifact/schema compatibility evidence.
