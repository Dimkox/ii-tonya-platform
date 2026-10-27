---
title: Native resident scheduling and booking
created: 2026-10-27
type: feature
status: in-progress
baseline_commit: c207735727210660ac949b78b84cf7463519fb99
review_loop_iteration: 0
context:
  - AGENTS.md
  - docs/agents/expert-residency-team.md
  - docs/source/residency-phase1-owner-2026-10-26/resident-onboarding.txt
  - docs/source/residency-phase1-owner-2026-10-26/sales-technical-final-correction.txt
  - docs/source/residency-phase1-owner-2026-10-26/phase1-final-comprehensive.txt
  - docs/superpowers/plans/2026-10-26-residency-phase1-final-package.md
  - docs/spec/residency-scheduling-lifecycle-preparation.md
---

<frozen-after-approval reason="owner approved entire Phase1 package, isolated worktree, autonomous sequential implementation and necessary focused reruns">

## Intent

Deliver S4a native duration-based schedule generation/import, owner preview and
confirmation, private initial-card schedule review, actual client reservation and
expert confirmation, and protected logistics delivery. This is one cohesive source-
authority/booking increment; S4b closes resident lifecycle notices and whole journey.
S3b is independently accepted and gated; its delivered source is the baseline.
The reconciled boundaries below are mandatory acceptance requirements.

## Boundaries & Constraints

Avoid an initial-onboarding dependency cycle: paid interview may create PRIVATE
schedule rules/previews against current draft services before manager approval. Include
that confirmed schedule in the same owner/manager rich review, bound to exact service
and draft revisions. It grants no public slots. On approval, map accepted stable IDs
and schedule data into canonical inventory with all later promo/payment visibility
gates. Published resident updates use approved live services until their replacement
is approved. Do not require pre-existing approval merely to prepare a private schedule,
or invent a minimum number of slots as a new payment gate.

Each approved rich service maps stably to the existing expert_services identity.
Informational RUB service prices remain separate from subscription invoices/client
coupons. Draft service versions and schedule previews grant no client visibility. Native slots
bind to the approved service version used to generate them. When a new duration/
logistics version becomes approved, withdraw incompatible unoccupied old availability
and regenerate only from approved data; preserve held/booked appointment snapshots.
Those snapshots include service identity/title/duration/buffer and approved logistics,
so later catalogue edits cannot silently change an existing booking. Expert occupancy
includes buffer; client overlap concerns the actual appointment interval. Changed
rules may report preserved existing conflicts but cannot silently cancel customers.
Do not expose private photos, contact details or room URLs through slot search.
Only approved currently paid/consented/visible residents have bookable native slots.

Collect explicit IANA timezone, working weekdays/hours, breaks, bounded date horizon
and nonnegative buffer. Generate candidate intervals separately per selected service:
step is duration+buffer; a service and its necessary buffer must fit the work period
and respect breaks. Validate timezone/calendar dates, non-overlapping breaks and
positive typed duration before generating. Cap horizon, slot count and computation.
DST nonexistent/ambiguous local times require explicit resolution, never silent shifts.
No date-only server-local or browser-local inference. Retain original local+zone and
actual UTC instants so a future timezone change cannot move existing appointments.

Provide a bounded complete preview, omissions/errors and explicit owner confirmation
bound to schedule/service/profile revision and every page. Changed rules, service
approval, owner or consent invalidate stale previews. Add the actual owner bot entry,
authenticated routing, help text and response rendering; methods reachable only from
unit tests are insufficient. No raw JSON command is the only ordinary user flow.

Manual import supports YYYY-MM-DD HH:MM-HH:MM ServiceName and CSV. Resolve only this
owner's approved stable services; duplicate display names are ambiguous and require
an ID choice. Reject impossible dates/timezones, unknown services, wrong duration,
invalid ranges, duplicates and collisions; show row-level errors before atomic commit.
Treat formula-looking strings as data, never executable code. Preserve imported raw
input under the same bounded private custody/deletion as other owner input.

Reuse slots and reservations, provider/external identity uniqueness and canonical
expert/slot advisory and row locks. Generator/import/manual busy changes take the same
lock order as booking. Never overwrite/cancel held or booked slots, create duplicate
capacity or silently move a customer. Regeneration replaces eligible unoccupied native
future inventory only, with truthful preserved-conflict preview. Different services
may offer overlapping alternatives, but any held/booked expert interval plus buffer
must exclude a second reservation across services. Manual external-busy intervals
hide or remove only genuinely free availability and report existing bookings for
human action; do not pretend an external calendar operation happened.

Native owner-confirmed slots need explicit source validity across every catalogue,
choice and reservation read, including DB-clock checks after waits. Existing external
provider observed_at freshness remains unchanged. Do not counterfeit observations
or let confirmed native inventory disappear after the existing15-minute provider TTL.
The validity horizon is the explicitly previewed/confirmed period; do not silently
extend recurring availability beyond the owner's confirmed dates. Native slots must
remain unavailable if their approval/owner/consent/financial or
schedule-source authority expires or is withdrawn. Recheck inside commit transactions.

The existing expert-confirmation path unconditionally enqueues Planerka and requires
its enabled mapping; its reserved state waits for genuine provider completion. New
native inventory needs an explicit native DB confirmation branch, source-bound audit,
callback replay and notification capture. Do not forge a provider success or change
all external confirmations to booked. Exercise native and existing external paths.

Static room/address data belongs to the actual approved service/version and booked
appointment snapshot. Preserve the accepted30-minute protected meeting-link disclosure
window and original client authorization. Later profile edits cannot silently change
booked logistics. Dynamic rooms, Google Calendar/Zoom, Yclients/Dikidi, new client web
cabinet, Kanban/BI and production provider activation remain excluded.


## Required existing-consumer changes

Native confirmation requires consumer changes beyond the reservation transition:
- packages/contracts/src/booking-notifications.ts currently gives
  client.booking_confirmed a provider payload. Define real native version/source
  authority rather than inventing a Planerka operation UUID.
- booking-notification-repository.ts source capture and delivery eligibility
  require planerka_booking_operations booked/provider_uid for confirmation; the
  reservation request additionally assumes observed_at freshness. Update both
  native branches and verify ordinary worker delivery, preserving all external
  operation checks and original identity/consent/unknown-outcome behavior.
- booking-repository.ts readOwnedActiveBookingsInTransaction currently labels any
  booked reservation without a Planerka provider_uid as confirmation_unverified.
  Native source-authorized booked appointments must render accurately in actual
  /reservations/client and expert query consumers; a raw booked row alone is not
  end-to-end completion. Fake legacy/no-native/no-provider rows stay unverified.

These changes belong in S4a native schedule/booking with its real protected logistics
and notifications. S4b is resident review/activation/overdue/quality notices and final
combined journey, not a reason to postpone necessary native booking consumers.

Automatic logistics communication is also not present in the current booking
renderer: it deliberately rejects arbitrary meetingUrl/PII in generic views. The
owner's approved activation script says online links and offline address/map are
sent automatically. S4a must implement a dedicated source-bound private logistics
notice for actual booked native appointments, through the original authorized
client bot with current consent, immutable approved booking snapshot, deduplication,
unknown-outcome recovery and erasure. Online delivery is due no earlier than the
accepted30-minute window and before the meeting; offline approved address/arrival/
map may follow confirmed booking so travel can be planned. Recheck cancellation/
recipient/time under delivery authority. Do not broaden generic notification
views into arbitrary URL/PII senders, leak details in public search, or claim that
a protected read endpoint alone supplies automatic delivery. Preserve existing
external-provider/calendar semantics. This is requested functionality from resident-
onboarding.txt lines229–237, not a new marketing channel or external integration.

Database confirmation guard also needs an append-only native authority branch:
migration0043 planerka_reservation_transition rejects any reserved→booked without
a genuine booked Planerka operation/provider_uid. Preserve0043 bytes and all
external cancellation/recovery/erasure guards. A new hand migration must validate
real immutable native confirmation/source facts; do not disable the trigger,
fabricate external rows or broadly exempt any slot whose caller supplies a native
provider string. Native cancellation should settle local booking/notification state
without an invented calendar operation; legacy unknown cancellations stay manual.

Cancellation-cohort wording: use requests actually submitted by clients, not only
ones subsequently accepted by the expert. This preserves the requested accounting
of expert refusals before booked status. Keep the explicitly defined unique
created_at cohort and final/current-outcome denominator, integer>20 and zero skip.

## Tasks & Acceptance

- [ ] Typed rules/generator/import and readable owner commands: timezone/DST, service
   duration+buffer, breaks, explicit horizon/count, truthful row errors, immutable
   preview pages and confirmation of all entries. Missing fields ask the owner in
   the bot, never infer host time or generate hidden recurring dates.
- [ ] Additive schema/state for private draft schedule revisions, accepted stable
   service mapping, confirmed native availability, busy intervals and immutable
   booked snapshots. Current financial/safety/consent/approved version remains
   publication authority; initial private preparation causes no dependency cycle.
- [ ] Same canonical expert/slot/client locks and final DB clock for regeneration,
   reserve/confirm/import/manualbusy. Preserve held/booked customers and buffered
   expert occupancy; old external15-minute freshness remains strict. Native valid
   horizon does not masquerade as external observation and does not autoextend.
- [ ] Native source-bound confirmation through SQL guard, callback replay, outbox,
   normal notifications and real client/expert reads. Cancellation/complete/no-show
   preserve old provider semantics. Do not populate fake Planerka proof.
- [ ] Protected approved logistics snapshots and actual automatic client delivery;
   online30-minute window, cancellation/consent/current recipient recheck and durable
   dedup/unknown recovery/erasure. No generic arbitraryURL notification permission.
- [ ] Prove real normal owner ingress/private initialreview, actual duration/buffer/DST
   and import boundaries, PG lockwait/regeneration/hold collisions, native older-than-
   15min versus stale external, native callback replay and worker notification/client
   reads, immutable booked logistics after profile edits, populated migration and
   ordinary API/browser review. Preserve failed and passing evidence.

## Execution remainder

One implementer, three independent review lenses, canonical gate and mandatory
push/DraftPR. No live activation or routine permission request. Then S4b, not
whole-package completion here. The cancellation cohort mentioned below belongs
to S4b, recorded for compatibility; do not add its quality-monitor producer in S4a.

Read-path visibility must be checked explicitly: currentExpertResidencyVisibleSql
in catalog-repository.ts presently checks administrative archive and lifecycle
pause only; listPublicServices/findEligible/listAvailability additionally rely on
e.active/e.verified, not immediate current coverage. Native inventory cannot rely
on a future lifecycle worker to clear a stale projection. Require source-bound
current approved publication, consent and real paid coverage at catalogue/list/
choice/reserve/confirm, with final DBclock after locks. Audit enrolled-resident
legacy read compatibility too; do not silently impose new enrollment facts on
unrelated historical external experts. Include an actual expired resident before
worker reconciliation in the read/booking denial matrix, while eligible ordinary
external legacy behavior stays preserved.

Existing /schedule is already a read query in expert-telegram-query-service.ts;
keep it compatible and expose distinct readable edit/import/busy actions in the
canonical original expert bot, including paid private interview. Do not replace
queries with an unrelated command router or require UUID/JSON as normal entry.

Timezone research (read-only, no dependency/lock/source changes): current Node24.22.1
reports globalThis.Temporal undefined, ICU78.3. Do not assume native Temporal exists.
Primary references inspected on2026-10-27:
- https://tc39.es/proposal-temporal/docs/zoneddatetime.html describes
  ZonedDateTime.from options; explicit disambiguation=reject refuses missing/repeated
  local times and overflow=reject refuses out-of-range date components. Defaults
  constrain/compatible can silently adjust inputs and are inappropriate here.
- https://github.com/js-temporal/temporal-polyfill/blob/main/CHANGELOG.md lists0.5.1.
- https://github.com/js-temporal/temporal-polyfill/blob/main/index.d.ts documents
  offset rejection when explicit offset disagrees with the named timezone.
A locked @js-temporal/polyfill candidate may avoid handwritten DST resolution, but
it has not been installed/executed in this task. Verify exact bytes/license/API and
actual Node24 behavior before choosing; no host-clock inference or engine weakening.
For intervals spanning an offset transition, verify elapsed duration and local
workday/break/buffer limits together; resolving only the start is insufficient.

Distinguish new inventory/confirmation admission from an already booked obligation.
Ordinary voluntary pause or unpaid listing expiry must not cancel, move, relabel
as unverified or erase an existing native booked appointment. Preserve authorized
client/expert reads, cancellation and the approved logistics snapshot under current
privacy/safety rules. Do not accidentally require a new subscription payment merely
to honor a previously booked meeting. New reservations and reserved→booked still
require current admission. Actual privacy revocation/deletion or safety restrictions
retain their own existing suppression/cancellation authority. Cover pause/expiry
after booked in the compatibility matrix, separately from future-slot invisibility.

Actual client discovery consumer found: apps/worker/src/client-catalog-outbox.ts
uses AvailabilitySlot.observedAt, freshSlots15-minute checks and protected choice
expiry = min(request expiry, observedAt+15minutes). PostgresCatalogRepository.read
returns unavailable if any observedAt is null. Updating only SQL search/native
reservation would therefore leave native slots undiscoverable or falsely expired.
Carry explicit validated native validity/source through the normal worker reader,
freshness filter and choice issuance; bound choices by request/confirmed-native
validity without manufacturing provider observations. Preserve external freshness
and all request ownership/expiry constraints. Main composition is in
apps/worker/src/main.ts around757. Include a genuine client catalogue request→
protectedchoice→reserve witness for native rows older than15minutes, not direct
reserve-only tests. Existing24-hour booking lead remains unless owner changes it.

Stable service mapping must include owner/draft authority. S3 rich service UUIDs
can be supplied through validated advanced edits and are unique inside a profile,
not a global authorization token. Two owners may use the same rich service UUID.
Do not directly upsert expert_services by that UUID without ownership binding;
use an owner-scoped stable mapping and prove cross-owner collision isolation.
Preserve mapping across approved updates of the same owner's service and snapshot
the reviewed version at booking. Renaming a service cannot transfer existing slots
or use another owner's service-name/UUID as import authority.

Catalogue discoverability also requires es.code and es.language non-null in
listPublicServices/findEligible. Rich services currently have a title/format but
not these legacy catalogue fields. Reconcile canonical mapping with existing
client-catalog conventions and visible supported platform locale; do not create
otherwise-valid native rows that are permanently filtered out. Stable machine
service codes are identifiers, not expert qualifications or user-controlled
financial authority. Normal client catalogue proof must discover the newly
approved service, not a separately hand-seeded legacy service.

Native service identity must remain separate from display text. Existing public
catalogue renders serviceCode as the service label (catalog-view.ts), so a newly
generated UUID-like native code must not become the user's only service name.
Carry/render the manager-approved service title through the existing bounded
catalogue/choice presentation with backward compatibility; keep internal identity
for filters/binding. Do not expose full private rich JSON, room/contact URLs or
unapproved text to solve the label problem. Include normal client discovery of
two distinctly named/duration services, not only SQL service rows.

Native client-facing confirmations/cancellations should use ordinary booking
language. Current external cancellation renderer describes calendar state; do not
call native confirmation a verified external booking or tell a native client that
their calendar cancellation is unknown/not created. Use a source-typed native
presentation branch with the actual local outcome, preserving existing external
provider uncertainty language and authority checks. No internal UUID/native-driver
jargon is needed in the user's normal message.

Separate initial card review from later availability-only changes. Owner source
resident-onboarding.txt lines198–204 explicitly makes schedule updates immediate
after owner confirmation, without manager moderation, while logging them. For an
already approved service, changing working hours/breaks/horizon or adding/removing
free slots must not require a new card approval, invalidate the existing published
profile, or wait for the next lifecycle worker. Retain owner revision/preview,
consent/admission and booking-conflict checks. Service content/duration/logistics
changes still require the normal rich-card review; only their current approved
version can generate public availability. Initial private schedule remains visible
in initial owner/manager card review. Prove both distinct paths through ordinary
commands: initial private review and immediate later free-slot update.

## Code Map

- `packages/contracts/src/resident-rich-profile.ts`,
  `packages/application/src/expert-card-service.ts` and
  `packages/db/src/repositories/expert-card-repository.ts`: current partial profile,
  service identity, owner confirmation, manager approval and immutable versions.
- `apps/api/src/expert-card-composition.ts`, `expert-card-telegram-ingress.ts`,
  `routes/expert-cards.ts`: canonical work-bot owner and protected manager ingress.
- `packages/db/src/schema/catalog.ts`, `schema/booking.ts`,
  `repositories/catalog-repository.ts`, `repositories/booking-repository.ts`:
  canonical service/slot/reservation authority, locks and lifecycle actions.
- `packages/domain/src/reservation.ts`,
  `packages/contracts/src/booking-notifications.ts`,
  `packages/db/src/repositories/booking-notification-repository.ts` and
  `booking-notification-authority.ts`: truthful native branch alongside the existing
  provider confirmation, callback and worker notification authority.
- `apps/worker/src/client-catalog-outbox.ts`, `booking-notifications.ts`,
  `main.ts`: real discovery freshness, protected choices and delivery composition.
- `packages/db/migrations/0043*`: immutable historical Planerka transition guard;
  append authority through a new hand migration instead of changing historical SQL.
- `tests/repo/hybrid-message-gateway-schema-parity.test.ts`: update exact current
  journal tail only, retaining pinned0041 and B1 checks. Register new typed tables
  and reconstructed state without loosening historical guards.

One implementation owner may edit source/tests/new SQL/state/runbook/evidence in
this bounded block; root owns spec/master/status/review/coordinator/delivery. No
other agent concurrently mutates the same files or runs heavy PG/build jobs. Keep
the one protected PG17.5 cluster, private parser and semantic helper for the final
journey. Record final exact source/raw/gzip hashes and preserve failed evidence.

Mixed-source capacity remains one expert's capacity. A native hold/booking plus its
accepted buffer must exclude a conflicting legacy external slot reservation for the
same expert, and the reverse ordering must also be safe. Reuse canonical locks and
current reservation facts rather than guarding only a native-specific repository.
Do not reinterpret historical external bookings as native or invent their buffer;
existing interval facts remain authoritative. Include a mixed-source collision or
lock-order witness if the same expert can carry both source types in current schema.

Ordinary timezone selection should present readable city/timezone labels and UTC
offsets while storing an explicit IANA zone chosen by the owner. A raw IANA string
may remain an advanced input, but do not expose implementation identifiers as the
only ordinary setup. Never infer the choice silently from city or host timezone.
If a new timezone dependency is necessary, intentionally update its declaration
and authoritative lock graph together, pin/audit the exact package and install
from that reviewed graph with the required frozen-lockfile workflow. Do not weaken
Node/package-manager requirements or replace the lock graph to fit local tools.

Initial schedule review must be bound to actual owner/manager confirmation and its
immutable approved version, not merely rendered next to the card. If schedules
live in a separate table, include the exact rule/service/preview revision in the
existing confirmation/digest authority and review snapshot. Mutating a private
schedule after owner confirmation must require a fresh complete preview/review.
This is distinct from later availability-only changes against already-approved
services: those use their own owner-confirmed schedule revision and do not reopen
card moderation or invalidate otherwise current custom-tag decisions.

Scope-registration lesson from S3b final gate: tests/repo/scope-boundary.test.ts
checks more than the focused payment-schema guard. Register every newly reviewed
route, executable/automation path and exact normalized-content hash, all changed
barrel/package-manifest hashes, and both existing journal-map entries in
tests/repo/support/payment-scope-boundary-core.ts. Keep classifiers/negative probes
strict; no wildcard exemption or limits raised to fit new code. Run the focused
full scope-boundary file after coherent source changes, plus the exact state/history
guards. S3b's initial610/613 gate failed solely because those registrations were
missed; do not repeat that known omission in S4.

Also advance the mirrored exact route inventory in
tests/repo/expert-referral-scope-guards.test.ts when adding reviewed routes. Its
strict sorted equality is intentional and must remain strict. Run this focused
file alongside the main scope guard before the final branch gate; S3b's second
gate612/613 exposed this otherwise-missed companion registration.


## Exact execution identity and ownership

Work only in /home/pall/projects/ii-tonya-base/work/ii-tonya-platform/.worktrees/phase1-owner-plan-20261023,
branch codex/residency-native-scheduling-20261027. Baseline is delivered S3b
c207735727210660ac949b78b84cf7463519fb99; next hand-authored migration0070.
Do not modify0069 or earlier SQL or run drizzle-kit generate. SQL journal tail,
typed schema, state baseline and exact schema/history/scope guards change together.
S3b state is213tables/156functions/194triggers/1449constraints/533indexes/2extensions.
Preserve the existing state reconstruction provenance and regenerate from actual
isolatedPG17.5, not guessed schema snapshots.

One implementer owns application/domain/contracts/db/API/worker/web source, tests,
new migrations/state and necessary exact registry updates, operational runbook and
hashed test evidence. No descendants. Root owns this frozen contract, master plan,
AGENT-STATUS, coordinator/review records and branch delivery. The implementer may
mark Tasks & Acceptance checkboxes and add implementation/evidence notes outside
the frozen block, but must not silently narrow requirements. Read exact existing
interfaces first; adapt helper layout as needed while preserving every behavior.
Missing business text uses honest placeholders, not blocking consent/proofs or
invented operator/user actions.

Use already running task-owned PG17.5 container
 ii-tonya-verification-form-20261026-postgres-1 at loopback55483,1CPU/1GiB.
Protected0600 /tmp/verification-form-20261026.compose.json contains rotated local
credentials: read them only in child memory/environment. Never print config/env,
connection URLs or secrets, or pass credentials in command arguments. No new
competing database cluster. Keep parser
/tmp/residency-private-parser-20261026/socket/parser.sock and semantic helper
/tmp/residency-semantic-tags-20261027/socket/semantic.sock for later whole journey.
Safe reconstruction driver is
.superpowers/sdd/rich-onboarding-second-20261027/reconstruct.ts
(rawSHA256144775f6f5209fa6fc5826181c21a2965b7619d9771a1606abe5f35e35414126);
review current semantic reconstruction evidence for the latest69 baseline too.
Never revive earlier unsafe credential-in-argv harnesses.

Required environment preflight passes Node24.22.1/pnpm11.9.0/PowerShell7.6.9/
Docker29.9.2/Compose5.6.1. Install only the committed/reviewed dependency graph with
pnpm install --frozen-lockfile. Serialize PG/reconstruction/heavy builds. Preserve
RED and subsequent corrective evidence; no unchanged broad repeats or repeat-helper
count>3. Owner authorizes necessary focused reruns after real corrections. Commit
source and evidence with exact revision and raw/gzip hashes; do not archive secrets,
model binaries, generated build output, node_modules or local tool state.

External integrations/default ceilings remain disabled. Only synthetic/local
provider/clocks for proof, honestly labelled. No real messages, deployment/live
activation, payment/refund execution, staging mutation, push or merge by implementer.
Root performs exact acceptance review, full branch gate and mandatory gated push.
There is no hostedCI by current repository policy; do not claim hosted release
readiness. Source changes affecting money/booking authority need realPG witnesses.
Protected API/UI changes need ordinary composed ingress and actual browser proof,
not only unit handlers. Preserve exact resource/time commands/results including
failed runs. Include recovery/rollback constraints in the runbook.

## I/O & Edge-Case Matrix

| ID | Input or circumstance | Expected witness |
| --- | --- | --- |
| NS01 | Paid interview, private current services, no manager approval yet | Ordinary owner setup/import/full preview; initial schedule bound to subsequent exact card owner+manager approval; no public visibility |
| NS02 | Existing approved service, availability-only change | Owner confirmation updates eligible free availability immediately; no card moderation/custom-tag invalidation; preserved held/booked rows |
| NS03 | Workday/breaks, duration+buffer, DST missing/repeated/offset crossing | Strict bounded generation and explicit error/resolution; no silent shifts; both real elapsed duration and local work/break limits valid |
| NS04 | CSV/text valid, invalid dates/duration, duplicate title, other-owner UUID/name, formula-like text | Bounded private retained input, row errors, bound disambiguation, atomic commit; no execution or ownership crossover |
| NS05 | Hold/book race versus regeneration/import/manual busy, native/external mixed order | Canonical locks, finalDBclock, no overwritten/moved customer or buffered double booking; report retained conflicts |
| NS06 | Native confirmed slots older15min versus external stale slots | Actual public discovery/title→worker choice→reserve succeeds only for valid native; external15min and24h lead unchanged |
| NS07 | Paid expiry/paused/archived/revoked before worker projection | Publicread/choice/newreserve/newconfirmation denied immediately; unrelated eligible external legacy remains compatible |
| NS08 | Native expert confirmation/replay and native cancel | True immutable native proof, SQLguard permits, normal outbox/clientexpert reads and truthful notification; no fake provider fact |
| NS09 | Forged booked/native label versus real external provider completion | No native bypass; legacy unknown stays unverified and real provider checks unchanged |
| NS10 | Online30min window/offline confirmation; canceled/revoked/wrongrecipient/unknown outcome | Actual dedicated automatic private delivery at allowed time, exact immutable booked logistics, privacy/dedup/recovery/erasure enforced |
| NS11 | New service version/duration/logistics; same richUUID across owners | Stable owner-scoped mapping, eligible free replacement only; old booked snapshot immutable; other owner isolated |
| NS12 | Resident pauses/expires after a confirmed booking | No canceled/moved/relabelled obligation; authorized booking reads/cancel/logistics remain under privacy/safety rules |
| NS13 | Populated pre0070 upgrade and exact state/guard checks | Immutable historical rows survive; actual PGstate reconstruction and strict exact inventories pass |
| NS14 | Actual protected manager/browser review/session expiry | Complete initial schedule snapshot visible and revisionbound; original auth/freshMFA/session fencing preserved |

Every matrix row needs a concrete executed passing test or actual local acceptance
witness, with source-pinned evidence. A test file merely existing is insufficient.
</frozen-after-approval>

## Implementation Notes

Root prepares this contract from previously completed reconnaissance; no need to
restart that research or rerender the BMad workflow. No story_key, so sprint sync
is skipped. Next step uses one fresh context-free implementer, then three read-only
independent reviewers. Subsequent S4b remains required after accepted S4a delivery.
