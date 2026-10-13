# Payment first-send admission — bounded implementation evidence

Spec: `docs/superpowers/implementation-artifacts/spec-payment-first-send-admission.md`.
Original baseline: `d7ec2897462947e76bc4f258398b77817fe5900a`.
Coordinator receipt checkpoint advanced HEAD during work; baseline is preserved.
Only three assigned source files, two new test files, and this evidence are owned.
No staging, commit, push, deployment, live provider call, or old test execution.

## Invocation ledger

Times below are UTC on 2026-10-13. Test allocations are per file.

| Invocation                                                                                                                                            | Session/chunk          | Result                                                                                                                                                                                                                                                                                                                            |
| ----------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pwsh -File scripts/check-development-environment.ps1 -RequireDocker`                                                                                 | chunk `5cbcf0`         | Exit 0; Node24.21.0, pnpm11.9.0, Docker29.9.0, Compose5.6.0; no failures/warnings                                                                                                                                                                                                                                                 |
| `pnpm exec tsc --noEmit -p tsconfig.tests.json` before implementation                                                                                 | `3392`                 | Exit2; new adapter test's bind spy needed `vi.mocked` for typing. Corrected locally; not a test run                                                                                                                                                                                                                               |
| `pnpm exec vitest run packages/integrations/src/yookassa/payment-first-send-admission.test.ts` RED1                                                   | `56720`, start00:26:50 | Exit1; 12 failed /4 passed (16), 708ms. Reproduced duplicate POST, old unbound resend, missing-capability fallback, absent admission ordering, recovery mismatch, commit/POST/bind ambiguity                                                                                                                                      |
| `II_TONYA_TEST_POSTGRES_ADMIN_URL=<isolated synthetic fixture URL> pnpm exec vitest run tests/integration/yookassa-first-send-admission.test.ts` RED1 | `49627`, start00:27:07 | Exit1;22 failed/0 passed,4.09s. Capability absent; real concurrent adapters made2 POSTs. One cascading fixture isolation failure followed synchronous missing-capability assertion releasing a client with open transaction; wrapper made async to ensure rollback finally runs. This run does not establish lock-expiry behavior |
| `pnpm exec prettier --write <five owned TypeScript files>` then `pnpm --filter @ii-tonya/integrations build`                                          | `46953`                | Exit0; ESM and declarations built                                                                                                                                                                                                                                                                                                 |
| `pnpm --filter @ii-tonya/db build`                                                                                                                    | `44832`                | Exit0; ESM and declarations built                                                                                                                                                                                                                                                                                                 |

Test budget: adapter2/3, PostgreSQL2/3. Author allocation is exhausted;
coordinator final3 is reserved until independent review. No other Vitest runs.

## Current implementation and rulings

Static follow-up: session `80211` runs Prettier on the new PG test/evidence and
`pnpm exec tsc --noEmit -p tsconfig.tests.json`; exit0.
Session `52526`: integrations/db typechecks followed by ESLint of the five owned
TypeScript files; exit0.
Adapter GREEN2 session `25819`: exit0,16/16 passed, start00:30:05,637ms;
budget2/3. PostgreSQL GREEN2 session `60159` used the same isolated fixture URL and
single-file command as RED1: exit0,23/23 passed, start00:30:20,6.96s; budget2/3.
All three lock-wait cases (implicit order, explicit order, explicit attempt) passed
with observed PostgreSQL lock wait before expiry and zero resulting operation.
Restart preserves a real reservation created by checkout from a historical grant
fixture. Only historical grant setup disables triggers within its isolated setup
transaction; checkout, admission, and assertions use normal constraints/triggers.
`git diff --check` passed (chunk `6acd80`).

- Shared claim validation/digest/transaction path now returns insertion ownership;
  generic claim unwraps its existing row result. Initial payment requires the new
  optional capability; runtime absence fails closed without legacy fallback.
- New operation and attempt enter unknown_outcome in the same committed transaction.
  Existing rows never confer send permission. INSERT RETURNING is the ownership proof.
- Initial admission locks order and attempt and checks both deadlines with fresh
  clock_timestamp after locks. Explicit attempts must be created, match amount and
  currency, and have no prior payment operation. This conservative restriction
  prevents changing command IDs from reusing an already consumed attempt.
- Adapter keeps verified bound GET and rejects unbound replay and exact-body recovery.
- No migration. Refund behavior remains on generic claim.
- Spec overrides skill defaults for no subagents, no commits, no full suite,
  bounded test runs, and coordinator-owned review/final3. `bmad-build` and
  `superpowers:executing-plans` were consulted; implementation proceeds inline.

## Environment and limits

Dedicated synthetic PostgreSQL17.5-bookworm container:
`ii-tonya-first-send-test-20261013`, loopback port32773. Each test run creates and
drops a uniquely named isolated database via the existing testkit, replaying real
migrations. Container remains available for GREEN2 and coordinator final3.
Recording transport only. Commit-response loss uses a narrow transaction wrapper
after a real commit, not an actual network fault. No provider composition,
receipt-disclosure admission, release acceptance, or production readiness claimed.

Independent review and coordinator final3 remain pending. Existing old adapter
tests have legacy expectations and are deliberately not edited or executed under
this ownership/test allocation. They will require separately coordinated
reconciliation: old successful-checkout doubles lack the new capability, and old
exact-body checkout recovery expectations conflict with this spec. No claim of
whole-suite compatibility is made.

## Stable review fingerprints

SHA-256 after GREEN2:

| File                                                                      | SHA-256                                                            |
| ------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| `packages/integrations/src/yookassa/operation-port.ts`                    | `1dbf7d327899b3366329da96b438b17fd50a18b7839bbf6c28313ddffe12fd64` |
| `packages/integrations/src/yookassa/payment-adapter.ts`                   | `1d7be29d640f6895983bfffc7b2db49d84855baac626dbdc8b46e5c4ff964bf2` |
| `packages/db/src/repositories/yookassa-operation-repository.ts`           | `d0ba037dc69e74eee3f6b37233bd4a6b337ce5c478a58215a77a7e4142e18321` |
| `packages/integrations/src/yookassa/payment-first-send-admission.test.ts` | `00269a5c29fcdeacf00762f75e3e869759df6999df517cac4a605bc161c8358b` |
| `tests/integration/yookassa-first-send-admission.test.ts`                 | `89efe2cdff910f2492f999993cde97ffd1da3a48d44bd10e478c7bf5774f1619` |

Matrix coverage: first/concurrent send, old unbound statuses/restart, changed
authority, commit-response loss, POST/bind ambiguity, bound GET/mismatch, missing
capability, incompatible recovery, explicit-attempt validation and lock expiry.
The transaction-response-loss wrapper commits real SQL then throws; this is
controlled fault injection rather than evidence of a real database network loss.
No active test/build handles at handoff. The dedicated container is retained for
coordinator final3. Only coordinator may consume the remaining focused runs.

Final formatting session `2015` warned on the optional capability's type layout;
its shell exit0 reflected the subsequent whitespace check, not a formatting pass.
Session `29164` mechanically formatted that port only, then all six owned files
passed Prettier and `git diff --check` passed. No behavioral edits or tests after
GREEN2. Updated port fingerprint above replaces the earlier formatting fingerprint.

## Authorized legacy fixture reconciliation

Coordinator separately granted ownership of only
`packages/integrations/src/yookassa/payment-adapter.test.ts` plus this evidence.
The three source files and two new tests remain frozen for Euclid/coordinator.
No old or new test execution is authorized to this implementer in this round.

- Checkout double now exposes initial_send_admitted with unknown_outcome;
  generic claim remains unchanged for refunds.
- Checkout ordering and receipt-authority/digest assertions target
  claimInitialPayment. Raw-contact exclusion and digest sensitivity remain.
- Exact-body checkout setup, preparation-failure, and concurrent-recovery cases
  now expect explicit unsupported-recovery errors before admission, snapshot
  writes, binding or POST; resolve/markUnknown remain forbidden on these paths.
- Generic refund cases retain their assertions for terminal rejection, bound
  replay, unknown outcomes and later refund attempts.
- Static session `91514`: Prettier on this old fixture, scoped ESLint, then
  `pnpm exec tsc --noEmit -p tsconfig.tests.json`; exit0, all static steps passed.
- No Vitest invocation, package rebuild, staging or commit in this round.
  Coordinator reports Euclid accepted the frozen source/new-test set and is
  starting final3 independently; those results are not yet observed here.

### Coordinator final3 report and stable legacy handoff

Coordinator subsequently reported both final3 runs completed exit0:

| File                                                                      | Session | UTC start | Result       |
| ------------------------------------------------------------------------- | ------- | --------- | ------------ |
| `packages/integrations/src/yookassa/payment-first-send-admission.test.ts` | `91870` | 00:33:14  | 16/16 passed |
| `tests/integration/yookassa-first-send-admission.test.ts`                 | `48095` | 00:33:15  | 23/23 passed |

PG final3 used the coordinator's synthetic receipt PostgreSQL17.5 instance on
loopback32768 with a unique testkit child database. These are coordinator-reported
results, not additional implementer invocations. Both new files are now3/3
EXHAUSTED. Euclid accepted the frozen three source files and two new tests per
coordinator report. Earlier pending statements above record prior chronology.

Legacy fixture reconciliation is stable, statically checked, and UNEXECUTED as
instructed. No test was removed; refund assertions are unchanged. Legacy fixture
SHA-256: `45d617989f50cc041c1499a02aa229b7c1e82b3e96cb3cc205371627919daa70`.
All five frozen source/test fingerprints still match the stable review table.
No active implementer command handles. No staging, commit, push or live effects.
