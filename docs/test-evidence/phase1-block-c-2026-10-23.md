# Phase1 Block C local implementation evidence — 2026-10-23

Status: in progress, not local acceptance or release evidence. Baseline
`656cf89a025d46dfa6bc8e0cf92a3e6eee355c21`. New integrated PostgreSQL file
`tests/integration/phase1-card-publication.test.ts`: zero of three invocations.
No provider calls, push, deployment or live activation.

## Implemented boundaries under final integration

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
