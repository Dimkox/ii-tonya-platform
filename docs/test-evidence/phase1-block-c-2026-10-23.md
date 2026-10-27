# Phase1 Block C local implementation evidence — 2026-10-23

Status: local implementation accepted after C8; release gates remain separate. Baseline
`656cf89a025d46dfa6bc8e0cf92a3e6eee355c21`. New integrated PostgreSQL file
`tests/integration/phase1-card-publication.test.ts`: eight recorded invocations, including the single-case C7 diagnostic; full C8 passed20/20 under the task-wide owner count override.
No provider calls, push, deployment or live activation.

The entries retain chronological investigation history; final C8 acceptance is recorded below.

## Implemented boundaries

Private trusted work-bot text/photo/document references enter revisioned drafts.
Protected existing staff sessions edit strict professional fields, approve/return
reviews and confirm promotion evidence. Raw references remain protected text and
have an explicit physical-erasure disposition. Approved real material templates
produce bounded worker work; absent owner content remains waiting content. The
actual fixed-origin multipart Telegram transport requires complete matching
receipts; partial, timeout or crash outcomes remain quarantined without blind retry.

Main payment retains explicit owner quote acceptance, immutable existing tariff
snapshots, original TTL, exact stored purpose and actual canonical GET proof. Only
successful canonical settlement may publish the approved matching revision and
activate residency. Referral qualification uses an additive audited promo source
variant: legacy source precedence and cross-source uniqueness remain authoritative;
the existing1000RUB/30-day reward supersedes the100-point indication while pending,
and registration itself creates no available balance. This schema incompatibility
with the old mandatory single-use code is recorded as `@conflict_alert` in the C spec.

## Observed focused evidence

- Main financial command18 and strict canonical helper3 pass; DB types and scoped
  lint pass. Independent coordinator review accepted exact event/order binding,
  publication source guard, post-lock expiry on blocked/admitted paths and refreshed
  canonical clock. Runtime PG coverage remains pending.
- Card storage contract36 pass, including private-reference/public-field rejection.
- Work service28, config24, actual work-route17 and source composition9 pass before
  subsequent integration/replay corrections; final changed-source results pending.
- Staff facade initial10 pass; null malformed edit regression observed10pass/1fail
  before production validation fix, then11/11 pass. Logs:
  `/tmp/phase1-c-admin-null-red.log`, `/tmp/phase1-c-admin-null-green.log`.
- Manager HTTP7 and staff client10/view10/shared-session2 pass. Independent staff
  source review accepted protected no-store access, text-only raw references,
  revision-bound commands, uncertain-command keys and late-response cleanup.
- Actual materials transport deadline regression observed23pass/3fail, then26/26
  pass. Independent rereview accepted monotonic deadline checks at actual write and
  receipt boundaries, exact SQL receipt scope/count/digest and phase2 template relock.
- Actual worker runner/lifecycle/composition/preflight20 pass.

Independent ingress review identified a prior legacy-receipt replay boundary bypass
and mutation replies sent again on durable replay. These are assigned production
fixes with focused new regressions; acceptance is pending. Actual main invoice link
composition is also being completed through an explicit strict first-send custody
capability, default off. An invoice ID alone is not accepted as completed checkout.

## Remaining local gates

Complete app/server wiring, checkout/link and replay fixes; consent-document epoch
barrier/schema; final integrated fixture review; actual PostgreSQL17.5 metadata
recapture and guards; bounded focused integrated PG verification; relevant package
builds/types/lint/format/whitespace; final independent review and local block commit.
A consumed five invocations and B consumed two with23/23 passing; neither file is
being rerun for this block. Protected rotated disposable PG credentials are read
fresh in memory only. Local success will not satisfy merchant, processor/backup
erasure, first-send custody or exact-SHA release gates.

## Final source gates before integrated PG

Source fixes close legacy work-receipt replay and mutation reply replay. New focused
service42 (RED14/42), config28 (RED5/28), actual work-route20 (RED3/20) and normal
package composition9 pass. Actual app/server wiring6 passes, including protected
staff route reachability, exact webhook secret and startup requirements for custody
capability plus canonical merchant callback. Missing callback was reproduced with
5passing/1failing before its production startup fix. Final wiring log:
`/tmp/phase1-c-wiring-final-green.log`. Actual application/config builds and API
typecheck pass. Full web types and final app-worker types/build pass.

Post-publication erasure review found and fixed two copied-data/retention issues:
expert display name/access flags now clear in the same transaction, and immutable
first-settlement channel-identity FKs preserve only inert UUID tombstones. Raw
Telegram ID is replaced with `erased:UUID`, bot key/chat are NULL and mapping blocked;
unreferenced mappings and expert sessions are deleted. Financial snapshots remain
unchanged. Independent narrow source rereview accepted this disposition. The new
integrated file covers actual publication and qualified reward erasure/late proof.

Actual isolated PostgreSQL17.5 metadata replay of55 SQL migrations succeeded:
150tables,63functions,105triggers,1013constraints,408indexes,2extensions. Existing
catalogue changed only the authorized narrow0048 source function; prior constraints,
indexes and triggers remain.0054 snapshot/catalogue/manifest and exact guard pins
are reconstructed, not schema-generated. Final RequireDocker environment check and
DB/integration builds pass. Functional C PG remains unrun at this checkpoint.

Configured C5 tests use a synthetic injected custody declaration solely to exercise
the real canonical adapter's order binding, stored operation, GET recovery and no
blind POST after unknown outcome. They do not prove production strict first-send
cancellation. That runtime capability remains unresolved and default off.

## Integrated invocation record

Invocation1 exited1 before collection: the new root test imported
`@ii-tonya/config`, which is not a root dependency or Vitest alias. No cases or DB
setup ran; the invocation is nevertheless counted. The test now imports the real
relative config source. Independent import review, full tests TypeScript and scoped
lint passed; no alias, runner, guard or proof-brand changes. Log
`/tmp/phase1-c-card-pg1.log`.

Invocation2 started with20 cases after this correction; result pending. Its separate
log is `/tmp/phase1-c-card-pg2.log`. Final third slot remains reserved for concrete
corrections. No A/B files or functional SQL probes have been run.

Invocation2 exited1 with2 passing and18 failing cases. The failures share raw-media
insertion before manager review; financial/publication paths were not reached.
Owner binding/replay and legacy receipt fencing passed. Existing server logs identify
`invalid regular expression: invalid repetition count(s)`: PostgreSQL ARE limits
bounded repetition to255, while the new media CHECK patterns used `{1,512}`.
The production fix preserves the512-character file-ID limit using a character-class
`+` expression and an explicit total-length check, retaining NULL denial. Non-PG
regression, schema parity, metadata recapture and review precede the reserved third
invocation. No manual functional SQL probe or extra PG invocation is authorized.

A subsequent source-check launcher failed before execution because the pinned
Corepack pnpm11.9.0 cache had lost its `dist` directory while retaining its install
marker. The cause of that external cache loss is unconfirmed. The incomplete cache
was preserved reversibly in `/tmp`, and `corepack prepare pnpm@11.9.0 --activate`
restored the exact pinned version; `pnpm --version` and the full RequireDocker
environment check then passed. No repository dependencies, lockfile or constraints
changed, and no functional verification slot was consumed by those launch failures.

The SQL ARE regression reproduced2 failures with36 existing checks passing, then
passed38/38 after the exact production fix. Scoped lint, formatting and whitespace
passed. Frozen0054 SQL is
`526ac3bd5fa9ac6edfee72128d2898ae19b1ea6555161091b897db0ed1f860f8`.
The coordinator independently accepted unchanged NULL denial, ASCII charset and
1..512 file-ID bounds. Final DB build passed after matching schema CHECK edits.
Log: `/tmp/phase1-c-sql-media-are-green.log`.

Invocation3 exited1:15/20 cases passed; five failed with the unchanged5000ms Vitest
case timeout. There were no reported assertion or SQL failures. Log:
`/tmp/phase1-c-card-pg3.log` (182.17s total,53.01s collection,128.73s cases).

Passing cases include real1/3-month settlement/publication, raw-media erasure and
late money, NULL authority rejection, exactly1000RUB pending maturity with qualified
applicant erasure/late GET, consent-notice SERIALIZABLE retry, legacy source
precedence, no retroactive ineligible reward, unknown checkout no blind resend, and
legacy work-receipt fencing. This does not establish full C acceptance.

The five timeout cases are HTTPS private/public-field rejection; original invoice
replay after new quote acceptance; deadline lock wait without withdrawal; deadline
lock wait with withdrawal; configured successful owner checkout. Their assertions
must not be described as completed or passing. All three authorized invocations are
consumed. No fourth invocation or equivalent manual execution has occurred.

Read-only review identifies a real fixture cleanup risk: Vitest timeout does not
cancel an async body, so its DB work could outlive the case while the next setup
resets the same fixture. Whole-body bounded drain/fail-closed setup fencing is being
added with a separate non-PG regression. Normal setup for those cases moves to
bounded hooks; the5000ms behavior deadline, real3-second synthetic quote TTL, observed
lock crossing and all financial assertions remain unchanged. No production timeout
or authority is relaxed.

Long collection and broad timing inflation correlate with shared host pressure but
do not prove it as the sole cause. At17:20UTC the host load was15.08/11.92/8.30 with22
reported CPUs. The owned PostgreSQL container remained healthy with zero restarts,
1CPU/1GiB limits; post-run idle snapshot was7.76% CPU and49.69MiB. No external
processes or containers were changed. Deadline cases also included full onboarding
plus a real three-second wait inside five seconds; separating setup corrects this
known fixture-budget issue without widening the case timeout.

## Reviewable WIP checkpoint after budget exhaustion

The fixture repair is complete and independently source-reviewed. A separate
non-PG drain helper tracks complete bodies and setup hooks, observes rejections,
checks a monotonic two-second cleanup deadline and permanently blocks another
fixture reset after an unresolved/late drain. The microtask readiness regression
was reproduced on helper invocation2; final invocation3 passed5/5. All three helper
invocations are consumed. Full tests TypeScript, focused lint, formatting and
whitespace passed. Log: `/tmp/phase1-case-fence-unit3.log`.

Heavy normal setup moved to bounded hooks for the timeout cases. All20 cases,
default5000ms limits, existing15000ms quote-expiry override, real3-second synthetic
quote TTL, lock observation and financial assertions remain unchanged. This repaired
PG fixture has not been executed. No production source or migration changed during
this harness repair, so unchanged scope/history guards were not repeated.

This is a local WIP checkpoint pending explicit owner authorization for exactly one
additional focused C-file invocation. C is not complete; D and Phase2 have not
started. Production first-send custody, owner content, merchant and exact-SHA release
gates remain separately closed. No provider call, deployment or remote push occurred.

## Owner-authorized extra invocation4

The owner explicitly authorized exactly one additional C-file invocation. The root
coordinator launched it on WIP`921d108d0b947e164a56314e8185d91862fac6e1` after a passing
RequireDocker preflight; the implementation lead ran no duplicate or probe.
Log:`/tmp/phase1-c-card-pg4.log`, exit1,12/20 passing and8 failing,103.68s total with
4.38s collection. All four invocations are now consumed; no fifth is authorized.

The two deadline cases reached the canonical committed-expiry rejection
`EXPERT_RESIDENCY_PAYMENT_EXPIRED`. The fixture incorrectly expected a resolved
expired result; production deliberately commits expiry/releases and then throws.
Only that caller expectation is being corrected, preserving every subsequent
expired/no-interval/inbox/no-publication/no-access assertion. Production behavior
remains unchanged.

One-month publication and both first-source cases hit the unchanged5000ms case
limit. The latter unfinished body exceeded the two-second drain and correctly
poisoned the following three cases before they could reset shared fixtures. Those
three are not described as runtime assertions completed. Remaining heavy fixture
setup moves to bounded hooks;20 cases,5000ms limits, real3-second TTL and all financial
assertions remain. The helper is unchanged and its3/3 verification budget remains
exhausted. No functional run or manual SQL probe is permitted during this repair.

The extra4 fixture correction is complete and independently source-accepted against
`921d108d`. It asserts the canonical expiry error class and exact code before every
existing financial-truth check. Remaining publication and first-source setup moved
to tracked bounded hooks; no production, helper, SQL or state artifact changed.
Twenty cases, default5000ms limits, existing15000ms override, real3-second TTL and
all assertions remain. Full tests TypeScript, focused lint, formatting and whitespace
passed; logs`/tmp/phase1-c-pg4-fixture-types-done.log` and
`/tmp/phase1-c-pg4-fixture-lint-done.log` are empty with exit0. This revised integrated
fixture is unexecuted. No PG, helper, scope/history or manual-probe invocation ran
during the correction. A new local WIP checkpoint precedes the coordinator's exact
request for one additional focused invocation; C remains unaccepted.

## Owner-authorized extra invocation5

The owner explicitly authorized one fifth C-file invocation. Root alone launched
session69562 on clean`572c7a5b1335e3e3c8d8524b963ef1502bd2c592` after RequireDocker
passed, using the current protected synthetic configuration in memory. It exited1:
19/20 passed, with only the qualified1000RUB reward case exceeding the unchanged
5000ms body deadline (6484ms including hooks). Total126.03s, collection10.21s;
log`/tmp/phase1-c-card-pg5.log`. All five authorizations are consumed. No sixth or
manual equivalent is authorized.

The previous canonical-expiry, first-source, normal checkout, erasure and notice
cases passed. The remaining reward fixture still performed inviter/consent/
registration setup, full approved-card setup, two additional registrations, feature
control approval and main checkout/provider preparation inside its timed body.
That coherent prepayment preparation moves into a tracked bounded hook, retaining
its frozen100 precondition and every subsequent money/maturity/immutability/
erasure/late-proof assertion. All20 cases are also audited for the same remaining
setup/body mistake, without adding behavior or widening any timeout, TTL or drain.
Only fixture source/static checks and independent review may run before a new
reviewable WIP checkpoint and exact owner permission request.

### Complete revised fixture boundary audit (source only)

Independent review audited all20 expanded cases against`572c7a5b`. Ordinary
preparation runs in tracked bounded hooks. The table describes source structure;
it is not a claim that the revised fixture has run.

|   # | Case                         | Hook preparation                                                                                                     | Timed behavior retained                                                                                                  |
| --: | ---------------------------- | -------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
|   1 | Publication,1 month          | Approved card, accepted checkout, bound provider                                                                     | Prepayment authority checks, actual callback/replay, publication, erasure/audit                                          |
|   2 | Publication,3 months         | Approved card, accepted checkout, bound provider                                                                     | Prepayment checks, actual callback/replay, publication                                                                   |
|   3 | Owner/bot/revision/replay    | Paid interview and handoff                                                                                           | Wrong owner/token/bot/revision/digest and exact update replay                                                            |
|   4 | Materials/unknown outcome    | Approved card                                                                                                        | Missing-content gate, real template transition, partial send, quarantine/no retry                                        |
|   5 | Telegram reference rejection | Approved card                                                                                                        | Private public-payload rejection                                                                                         |
|   6 | RF reference rejection       | Approved card                                                                                                        | Private public-payload rejection                                                                                         |
|   7 | HTTPS reference rejection    | Approved card                                                                                                        | Private public-payload rejection                                                                                         |
|   8 | Accepted quote replay        | Approved card and original checkout                                                                                  | Fresh acceptance, original invoice replay, no extra order                                                                |
|   9 | Raw erasure/late payment     | Approved card, checkout, bound provider                                                                              | Actual erasure, merchant GET, no recreation                                                                              |
|  10 | NULL/source escape           | Approved card/review and expert actors                                                                               | Invalid entry/review/receipt/code-source writes rejected                                                                 |
|  11 | Qualified1000 reward         | Inviter consent/registration, card, extra registrations, frozen100 precondition, control approval, checkout/provider | First callback, exact100000/30-day pending/no available credit, supersession, immutability, erasure/late GET/old handoff |
|  12 | Immutable quote expiry       | Approved card and real3-second BASE quote                                                                            | Real DB-clock expiry, old acceptance rejected, explicit new acceptance; existing15-second override                       |
|  13 | Deadline without withdrawal  | Card,3-second quote/acceptance/order, provider/proof                                                                 | Observed lock wait across expiry, exact canonical rejection and committed financial truth                                |
|  14 | Deadline with withdrawal     | Same preparation                                                                                                     | Observed lock wait, actual withdrawal, canonical expiry and audit                                                        |
|  15 | New consent notice race      | Card, checkout, provider/proof                                                                                       | Observed wait, real new notice, bounded SERIALIZABLE retry/no authority                                                  |
|  16 | Legacy first source          | Audited code, actors/consents, card, checkout/provider                                                               | Actual callback, original source precedence/audit                                                                        |
|  17 | Prior ineligible first       | Canonical first snapshot, actors/consents, card, checkout/provider                                                   | Actual callback, no retroactive qualification, marker retained                                                           |
|  18 | Configured checkout          | Card/acceptance, provider/client/adapter/service and actual HTTP app                                                 | Actual first POST, stored binding, GET recovery, no extra POST                                                           |
|  19 | Unknown checkout             | Same variant-specific preparation                                                                                    | Actual unknown POST, next update cannot retry POST or return a URL                                                       |
|  20 | Legacy receipt fence         | Paid interview, normal composition, completed/pending receipts and HTTP app                                          | Duplicate ACK/retryable rejection, no claim/card mutation, fresh update works                                            |

Post-settlement session seeding stays with erasure behavior because it references
the newly established financial marker identity; moving it earlier would fabricate
that snapshot. All money/maturity/immutability/erasure/late-proof assertions remain.
No helper, production, migration, timeout or TTL changed. Independent fixture
source review accepted the complete audit; functional verification remains pending.

Final comprehensive fixture closure passed full tests TypeScript, focused lint,
formatting and whitespace checks. Logs`/tmp/phase1-c-pg5-fixture-types-final.log` and
`/tmp/phase1-c-pg5-fixture-lint-final.log` are empty with exit0. All file ownership
ended. Only the C test file and evidence/status/spec records changed; helper and
production remain untouched. No test/PG/probe or scope/history rerun occurred.
A clean local WIP checkpoint is required before any exact sixth-run permission
request. This remains an unexecuted fixture revision, not C acceptance.

## Explicit task-wide verification count override

The owner answered “разрешаю, что за бесконечный цикл” to the coordinator's exact
request to override the number-of-runs restriction for the current entire task.
Necessary focused verification may continue without further count-permission loops;
actual invocations and failures remain recorded. Existing assertions, runtime
limits, repeat-tool maximum3 and financial/privacy/release boundaries remain.

Root alone launched C invocation6, session89705, on
`82b72348349fd9f8ba66b7082c991130a45b6b0c` after RequireDocker passed, with current
protected synthetic configuration read only in memory and an exclusive log:
`/tmp/phase1-c-card-pg6.log`. Result is pending. The implementation lead ran no
duplicate, helper rerun or probe. C acceptance and D/Phase2 continuation await the
actual result, with no further count approval request required.

## C8 full local acceptance

C6 exited1 with17/20 passing: configured normal checkout timed out and its expired
drain correctly fenced the last two cases. No source hang was proven. A systematic
read-only callgraph audit found sequential transactions across the HTTP/provider
boundary, with potential legacy wait risks but no demonstrated nested transaction
or lock cycle in this fixture. No unrelated production hardening was introduced.

C7 selected only normal configured checkout with safe fixed-label phase tracing.
It passed under the unchanged5000ms limit: HTTP482/188/279ms; standalone binding and
verification66/65/71ms. This diagnostic did not constitute full acceptance.
Log`/tmp/phase1-c-card-pg7-diagnostic.log`.

C8 ran the complete ordered file once with the same gated phase capture and exited0:
20/20 passed,71.57s total,4.30s collection,66.82s cases. Log
`/tmp/phase1-c-card-pg8-traced.log`, lead session37597. Normal checkout HTTP phases
515/168/308ms, standalone DB73/72/72ms; unknown checkout HTTP363/143/228ms,
standalone DB80/79/77ms. Every phase completed. The earlier isolated timeout's cause
remains unproven; no product latency claim or widened case budget follows.

All original assertions, default5000ms case limits, existing15000ms quote-expiry
override, actual3-second TTL and two-second cleanup drain remain. Gated test-only
trace logs fixed labels/stage/rounded milliseconds, with no identifiers, URLs,
parameters or errors. Independent review accepted forwarding and safety; its low
spy-restoration finding was fixed with an unconditional nested finally. That cleanup
change received static review/checks without an unchanged full-file rerun.

Prior relevant package builds/types,38/38 card regression, application/config/API/
worker/web focused checks, actual0054 reconstruction, scope123/123/history8/8 and
independent financial/storage/privacy/ingress/staff/transport/fixture reviews remain
recorded. No aggregate or unchanged suite was repeated. C is locally complete;
strict first-send custody, approved owner content, merchant/processor/backup and
exact-SHA release gates stay separate/default-off. D then Phase2 continue under the
already-authorized execution contract.

Final post-cleanup static checks passed: full tests TypeScript
(`/tmp/phase1-c-accepted-types.log`), scoped ESLint
(`/tmp/phase1-c-accepted-lint.log`), formatting and whitespace. No unchanged full
run followed the reviewed unconditional spy-cleanup change.
