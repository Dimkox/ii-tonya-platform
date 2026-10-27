# Booking handoff revocation — Task 1 evidence

Task 1 implementation handoff, 2026-10-12. Independent review and final focused
run belong to the coordinator. Task 2, release acceptance, retention policy and
external deletion evidence are not completed by this work.

Base: `690797db64fd80aa1aeccea8003543de470d8c16`, branch `codex/planerka-api`,
canonical remote `https://github.com/Dimkox/ii-tonya-platform.git`. Worked directly
in the shared dirty worktree and preserved existing changes. No nested agents,
commit, push, deployment, live provider call or exhausted test invocation.

## Interface and behavior

Exported from `@ii-tonya/db`:

```ts
new PostgresBookingHandoffRevocationRepository(db).consumePending(limit);
// Promise<{ examined: number; processed: number; quarantined: number;
//           operatorRequired: number }>
```

Limits are integers 1–100; runtime uses 20. `examined` includes contended or active
legacy candidates. `processed` and `quarantined` count newly committed receipts;
`operatorRequired` counts their unresolved operator cases. Repeated receipts are
no-ops. The instance retains a UUID keyset cursor across polls and wraps at the end;
the cursor is scheduling state, never evidence or authorization.

The consumer takes the existing document/subject barriers before the source lock,
uses a 50ms lock timeout and a 1s statement timeout per candidate transaction,
rereads the source and skips active dispatch/reconciliation leases. It verifies
the strict event schema, exact producer keys and SHA256 rebuilt in producer field
order (`userId`, `consentDecisionId`, `purpose`). Journal validation requires the
same consent ID/user and `expert_handoff` denied/revoked fact. Later grants do not
invalidate history; cascaded note withdrawal uses the actual handoff journal fact.
The privacy producer was not modified.

Receipt, content-free alert and source transition commit together. Outcomes:

| Outcome               | Source terminal state | Coverage                          | Alert reason                              |
| --------------------- | --------------------- | --------------------------------- | ----------------------------------------- |
| `processed`           | `succeeded`           | `historical_disclosure_untracked` | `handoff_historical_disclosure_untracked` |
| `quarantined_invalid` | `dead_letter`         | `invalid_source`                  | `handoff_invalid_source`                  |
| `quarantined_legacy`  | `dead_letter`         | `historical_disclosure_untracked` | `handoff_legacy_outcome_unverified`       |

Invalid sources carry no trusted consent reference. All receipt recipient counts
are zero **known actionable** recipients, not proof of zero historical disclosure.
No recipient is guessed, no remote deletion is asserted and no new delivery or
delivery attempt is created. Neutral notification and client-messaging authority
are unchanged. Legacy attempt counts or attempt facts remain uncertainty even if
the original outcome evidence is absent; no work is reset for sending.

Generic unrestricted claim, exhaustion and recovery exclude only this dedicated
topic. Every direct generic mutation rejects it through the shared locked-row
funnel, including otherwise valid old claim tokens. Existing topic/owner/bot
fences remain in place.

## Focused verification and budget

The supplied synthetic container was verified before each test invocation:
`ii-tonya-notification-t2-20261012-postgres-1`, `postgres:17.5-bookworm`, running at
`192.168.112.2`, actual `server_version_num=170005`. The testkit creates and removes
isolated databases using the supplied `II_TONYA_TEST_POSTGRES_ADMIN_URL`; the
retained container was not removed. Node24.21.0, pnpm11.9.0. Coordinator supplied
the successful environment preflight.

Both invocations used exactly:

```sh
pnpm exec vitest run tests/integration/booking-handoff-revocation.test.ts
```

| Run    | UTC start           | Result                                                                                       | Duration |
| ------ | ------------------- | -------------------------------------------------------------------------------------------- | -------- |
| RED1   | 2026-10-12 18:23:08 | 46 failed / 46; behavioral assertions against compileable scaffold and old generic ownership | 3.84s    |
| GREEN2 | 2026-10-12 18:26:53 | 47 passed / 47                                                                               | 6.08s    |

**Budget: 3/3 exhausted.** Coordinator final run3 at18:34:52 returned50/51PASS,
5.11s total. The existing authority-lock observation test failed at
`expect(observed).toBe(true)`; all added independent legacy-evidence/count-constraint
assertions passed. This is a failed final run, not acceptance.

Both observer loops query `pg_stat_activity` repeatedly inside one transaction.
[PostgreSQL17 documentation](https://www.postgresql.org/docs/17/monitoring-stats.html#MONITORING-STATS-VIEWS)
states that current-query information is snapshotted within a transaction.
Coordinator added `pg_stat_clear_snapshot()` before each poll in both loops,
preserving the production50ms timeout and all assertions. Review accepted that
cache correction but identified the remaining50ms sampling race; the failure's
precise interleaving was not captured. The final test-only correction therefore
replaces both polling loops with a controlled real-executor boundary gate.

The subject case pauses before submitting the unchanged advisory-lock SQL,
proves source NOWAIT lockability, then releases and requires actual55P03 followed
by cursor continuation and eventual processing. The document case commits the
changed topic before releasing the unchanged authority statement, requires real
SQL success and checks zero processing after source reread. This is a controlled
authority-boundary proof, not a sampled PostgreSQL lock-wait observation.

Harvey changed only the test file; all unrelated test bodies remained unchanged.
Typecheck/lint/format/diff passed. McClintock independently source-accepted the
gate, proof and cleanup. No rerun yet. Owner was asked asynchronously for one explicit extra run.
Do not replay this file or rename its coverage without that permission.

Raw local output: `/tmp/ii-tonya-handoff-red1.log` and
`/tmp/ii-tonya-handoff-green2.log`. No full or multi-path suite was run.

Coverage includes direct denied/revoked facts, genuine privacy producer/cascade,
later grant, JSONB digest ordering, invalid subject/purpose/decision/fact/hash/keys/
shape/extra fields, two consumers, forced transaction rollback, bounded pages,
observed advisory lock wait with source still lockable, contended source, source
topic reread after document lock, active/expired legacy leases, attempt uncertainty,
generic claims/recovery/exhaustion/nine direct mutation paths, unrelated generic
product claim preservation, neutral notification preservation, append-only receipts
and contradictory receipt constraints.

The observed lock-order assertion was strengthened and the source-topic reread
case was added after RED1, before GREEN2. That added case has GREEN evidence but
no separately observed RED. No claim that every schema guard individually failed
in RED1: some assertions follow the first failing consumer assertion.

Static checks, all exit0:

- DB typecheck and `tsc -p tsconfig.tests.json --noEmit`, before RED and before GREEN.
- ESLint over the six owned TypeScript files, including both DB barrels.
- Prettier check over those six files plus the journal and three0046 JSON artifacts.
- `git diff --check`; new owned source/artifact paths checked separately as well.

## Migration evidence

Journal ended0045 when0046 was allocated. Hand-authored SQL creates only the
minimal receipt table, constraints and append-only trigger. Existing
`reject_append_only_change()` is reused. No earlier SQL changed.

Isolated PostgreSQL17.5 SQL replay through0046, fresh-directory Drizzle0.31.10
introspection and positional catalog normalization succeeded (exit0). The
temporary reconstruction database/directory were removed by that tool. Generated
snapshot links to0045; SQL supplement includes real trigger/function/constraint/
index/extension definitions. SHA validation passed for all47 SQL inputs, all46
unchanged prior inputs, both generated artifact hashes, snapshot lineage and the
new receipt table/trigger. `drizzle-kit generate` was never run.

## Coordinator follow-up and limits

These existing repository guard files are outside the assigned file ownership;
they were inspected but neither edited nor executed:

- `tests/repo/migration-history-integrity.test.ts`: latest snapshot expectation
  remains44; advance to46 and add `booking_handoff_revocation_receipts_append_only`
  to the sorted trigger inventory.
- `tests/repo/migration-state-baseline.test.ts`: provenance list ends44; include45
  and46 when coordinating guard maintenance. This is not permission to rerun an
  exhausted file.

Independent adversarial review, coordinator run3 and these guard updates remain
acceptance work. No hosted CI/Database Gate result is claimed. Task2 composition
and operator guidance are coordinator-owned. Local processing does not establish
legal approval, retention/anonymization completion, remote deletion, production
enablement or completion of the broader notification T5/commercial goal.

## Changed paths owned by this increment

- `packages/db/src/repositories/booking-handoff-revocation-repository.ts`
- `packages/db/src/repositories/outbox-repository.ts`
- `packages/db/src/schema/booking-handoff-revocations.ts`
- `packages/db/src/schema/index.ts`
- `packages/db/src/index.ts`
- `packages/db/migrations/0046_booking_handoff_revocation.sql`
- `packages/db/migrations/meta/_journal.json`
- `packages/db/migrations/meta/0046_snapshot.json`
- `packages/db/migrations/state/0046_manifest.json`
- `packages/db/migrations/state/0046_sql_objects.json`
- `tests/integration/booking-handoff-revocation.test.ts`
- `docs/test-evidence/booking-handoff-revocation-2026-10-12.md`

Ignored local work notes/script:
`.superpowers/sdd/2026-10-12-booking-handoff-revocation/progress.md` and
`.cache/handoff-revocation/reconstruct.ts`.
