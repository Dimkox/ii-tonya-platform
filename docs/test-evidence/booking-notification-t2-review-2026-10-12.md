# Booking notification T2 independent review

Candidate baseline690797db plus uncommitted T2 and calendar prerequisites.
All three independent BMad layers returned before triage: Bacon(blind),
Kierkegaard(edge), Hypatia(verification). No reviewer ran tests or edited files.
Frozen package `.cache/notification-t2-review-20261012.md`. Coordinator inspected
the implicated SQL, claim/admission and provider completion/rejection code.
Scoped Prettier check across12 implementation/test files and git diff --check
passed after the handoff. This is not behavioral or release acceptance.

## Accepted patch findings — first fix batch

| ID | Severity | Finding and required evidence |
|---|---|---|
| P1 | high | Candidate LIMIT precedes contention/predecessor filtering. Add bounded fair scan continuation; a blocked oldest batch must not starve later independent reservations across polls. Test actual locks. |
| P2 | high | Request admission counts callback rows without matching notification action/expert/hash/credential expiry. Check each frozen binding; test a genuine valid pair and individually mismatched pairs. T3 issuer remains separate. |
| P3 | medium | Schema-valid source version may exceed SQL integer. Quarantine before insertion, continue processing other sources; test2147483648. |
| P4 | medium | Cancelled operation without provider UID means not_created, not verified external cancellation. Test grant projection and preserve unknown external outcomes. |
| P5 | high | Provider reject expires reservation but emits only client expiry, so expiry worker cannot later notify expert. Emit expert expiry atomically, with version-bound source and idempotent capture; test both intents. |
| P6 | high | Frozen context can be deleted/reinserted; delivery source/recipient bindings can be overwritten. Enforce immutable bindings and legal redaction/FK removal; test prohibited retarget/recapture and permitted erasure. |
| P7 | high | Database allows sending without lease/attempt and terminal state with active lease. Add enforceable state invariants compatible with claim/recovery, preserving cross-table atomic transitions. Test invalid rows and real recovery. |
| P8 | medium | Matching late receipt does not close its resolved unknown-delivery operator alert. Resolve only the matching uncertainty case, never unrelated conflicts. Test both cases. |
| V1 | high | Withdrawal test bypasses PostgresPrivacyRepository.withdrawConsentAtomically. Test that actual caller for pending and admitted work, including coordinated withdrawal/admission and erasure/admission barriers. |
| V2 | high | No same-recipient sending predecessor test. Prove cancellation waits behind sending confirmation and progresses after unknown/manual resolution without resend. |
| V3 | high | No contradictory late receipt after not_applied/failed. Test old receipt cannot overwrite newer active attempt/lease; conflict alert is retained. |
| V4 | high |0044 reconstruction compares constraints/indexes but omits supplement functions/triggers. Compare all supported SQL-only objects with actual PostgreSQL as existing0043 test does. |

All accepted fixes stay in the existing T2 file set and genuine delivery test.
Add assertions before code changes. Do not rename tests or invoke exhausted suites.
Run3 is still reserved until the complete patch and static review are ready.

## Cross-task findings retained for release

- **high, defer to calendar correction:** complete() reads validity before all
  locks, omits slot start, and evaluates lease in a potentially waiting SELECT.
  Read fresh database time and recheck hold/slot/lease after all locks. Existing
  calendarworkflow3/3 is exhausted; do not hide another run in a new test file.
- **high, T4 interface completion:** caller-provided requestDigest currently has
  only syntax validation and precedes returned render inputs. It is not proof
  of the wire payload. Before activation, bind the exact authorized rendering
  and persisted callback pair to the consumed attempt; add tampering/stale-view
  tests. No external caller may supply price/recipient/message authority.
- **high, T5 retention:** admitted attempts retain chat IDs after erasure. Define
  actual minimal-evidence retention and deletion/cryptographic-erasure lifecycle;
  never claim total deletion from current queued-address redaction.
- **medium, T4 integration:** completed/no-show currently carry cancellation_pending
  projection. Their fixed renderer does not claim cancellation, but runner mapping
  must not interpret this as actual cancellation state. Define explicit terminal
  projection and check the rendered path before enabling it.
- **medium, operating bounds:** global identity table locks intentionally fence
  noncooperating writers. Keep the race protection; contention/fairness and eventual
  scoped serialization need evidence before increasing throughput. Do not remove
  the barrier merely to make contention tests pass.
- **low, admission deadline:** sub15second remaining life is unadmittable and
  temporarily remains pending. Verify eventual suppression with DB time; never
  extend hold or weaken the15second network budget.

Source provenance review distinguished trusted transaction-owned outbox events
from provider-supplied facts. An arbitrary privileged SQL writer fabricating all
matching source facts is not an external sender capability. Current producer
atomicity and strict version/provider checks remain required. SQL is the migration
authority; missing mirrored Drizzle CHECK declarations alone do not establish a
runtime bypass. Full SQL-object reconstruction remains mandatory(V4).

No T2 acceptance, final RC, external acceptance or production change is claimed.

## Scoped closure and behavioral verification

Bacon re-reviewed the first correction batch against the frozen package and
returned P1–P8/V1–V4 ADDRESSED at source level, with no new critical/important
regression. Coordinator then ran the existing logical integration file exactly
once on the owned synthetic Compose PostgreSQL17.5 database. Environment check
withRequireDocker passed; test itself asserted server_version_num170005.

`pnpm exec vitest run tests/integration/booking-notification-delivery.test.ts --reporter=dot`
with the synthetic adminURL: **70/70PASS**, started17:15:32UTC2026-10-12,
duration23.46s. This is run3/3; budget exhausted. No full/multi-path suite or
existing exhausted calendar/payment/transport file was rerun. No provider calls.
All new correction cases and full supplement comparisons ran in this invocation.

T2 now has local scoped review and behavioral evidence. This supersedes the
earlier unexecuted-candidate status only forT2; cross-task findings above, actual
callback/API/worker composition, PG16 compatibility, backup restore and exact
release evidence remain required. Synthetic Compose retained for future isolated
callback work. No catalogue mutation, commit, push or production deployment.
