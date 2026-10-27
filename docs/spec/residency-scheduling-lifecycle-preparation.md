# S4 read-only preparation (reconcile after accepted S3)

Existing prior approved contracts are DONE, not new tasks to restart:
- docs/superpowers/implementation-artifacts/spec-phase1-block-d.md implements
  seven-day renewal bill, current paid coverage, reminders, calendar-month pause,
  automatic return and default-off worker/real Telegram composition.
- docs/superpowers/implementation-artifacts/spec-phase2-preparation.md implements
  P2.1 late-row-lock DB-clock booking integrity, P2.2 private client coupon/order/
  reservation commands, and P2.3 inactive VK/MAX builders. Preserve and audit
  compatibility; do not recreate or announce these as newly missing.
- The accepted D contract explicitly says paid calendar time continues on pause;
  no free extension/rewritten paid order. Automatic return requires real current
  paid, consented eligibility. This resolves the otherwise ambiguous latest
  'without losing status' wording without another owner question.

Canonical scheduling source is packages/db/src/schema/catalog.ts:
expert_services(id,expert_id,name,code,language,active,duration_minutes),
slots(id,expert_service_id,provider,external_slot_id,starts_at,ends_at,observed_at,
capacity) with unique(provider,external_slot_id), positive capacity. No parallel
available_slots ledger. Rich service stable IDs from S3 must map to these.

Booking authority is PostgresBookingRepository.reserveProtectedChoice ->
reserveInTransaction with sorted slot/client/expert advisory locks, row locks,
SERIALIZABLE retries, actual final DB-clock TTL/lead recheck, reservation capacity
and expert/client overlaps. Native regeneration/import/external-busy must share
that authority/lock ordering; no reserved/booked customer may be overwritten or
silently cancelled. Alternative services can offer overlapping potential times,
but confirmation must share expert conflict and buffer occupancy across services.

Freshness matters: current booking and catalog readers use observed_at<=now and
15-minute freshness. Native confirmed schedule must have explicit source authority
and a reachable bounded refresh/validity path; do not forge provider observations
or make generated slots disappear15minutes later without considering the native
contract. Audit every read/choose/reserve route, not only raw slot insertion.
External provider freshness stays unchanged. Public visibility requires current
financial/quality/archive eligibility; draft schedule previews aren't live grants.

Existing currentExpertResidencyVisibleSql in catalog-repository denies any archived
application timestamp and paused lifecycle on read; publication is also paid gated.
Current D reconcile repairs main projection only with canonical active paid period,
original consent/current route and no blocking holds; don't bypass new rich version
approval or restore a rejected/private draft when reactivating.

New S4 work: service-duration+buffer scheduling, explicit IANA timezone/weekdays/
workday/breaks, bounded monthly horizon/count; full preview/current owner confirmation;
CSV/text manual import with existing service resolution, ambiguity/error reporting,
strict instant/date/duration validation, occupancy/holds preservation, idempotency,
manual add/remove/external-busy commands and audit. Handle DST absent/ambiguous times
explicitly; no silently shifted appointments. Slot name lookup must be owner-scoped
and reject duplicate-name ambiguity; never interpret CSV formulas as actions.

Lifecycle additions: exact approval/material/promo timeline,7-day promo and3-day
main-unpaid escalations, and daily rolling30-day resident cancellation ratio>20%
manager alert. Define denominator from real reservation history, unique bookings,
strict integer comparison and zero-denominator behavior; never substitute pending
holds or infer provider cancellation facts. Human quality decision, not invented
automatic ban. Missing materials should be an internal content escalation rather
than fabricated promotion completion. Keep pending refund policy manual.

Need actual end-to-end local normal ingress+worker witnesses from paid interview
through rich approval/promo/main publication, then regenerate with holds, renewal,
archive/search exclusion and return. Prior P2 already completed; only actual new
compatibility gaps justify changes/rechecks. No dynamic rooms, Zoom/GCal, client
web cabinet, Kanban/BI/emailSMS or production/provider activation.

Existing booking meeting-url disclosure is explicitly restricted to30minutes before
the meeting (booking-repository.ts near253, DEC-PLT-004). Static room support must
reuse that protected disclosure and consent path, not expose room URL in public
catalog/draft preview for another user. Bind approved room/address snapshot to the
actual booked service/version; current profile edits cannot silently change an
already booked appointment or notify the wrong client. Existing Planerka integration
is historical and does not authorize dynamic calendar activation in new Phase1.

The legacy application archive_at/archive_until_date are distinct from D lifecycle
pause; /pause writes lifecycle only. Audit consumers but don't conflate administrative
intake archive with automatic paid pause or blindly clear a rejected/archived intake.


Additional concrete native-booking compatibility gap found in the source audit: every
expert_confirm in booking-repository.ts unconditionally calls enqueuePlanerkaBooking,
whose repository requires s.provider='planerka' and enabled mapping or throws
planerka_mapping_unavailable. Domain transition expert_confirm deliberately remains
reserved until real provider completion; callback replay also expects reserved.
New native static-room slots cannot simply reuse this branch or silently change the
existing provider transition globally. Reconcile a source-authorized native confirmation
path through notification capture, callback authority/replay, reservation audit and
protected booking view. Native approval must be a real DB fact, never a fabricated
Planerka success. Keep historical external flow unchanged and prove both paths.

Execution sizing: after acceptedS3b, split S4 sequentially into bounded contracts
if needed: (a) native service schedule/booking and private initial review integration,
(b) durable decision/activation notices, overdue/quality manager escalation and
whole-package journey. This is delivery organization under existing approval,
not scope removal, parallel independent-block development or another owner gate.
Keep native booking and source-validity changes together because an inserted slot
without reservation/confirmation/logistics consumers is not a delivered feature.
No timezone dependency is currently evident in package/lock/domain searches; choose
a verified exact local-time resolver and prove DST behavior without weakening Node24
or relying on host/browser timezone. Only add locked dependencies when justified.

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

Notification source/channel reconnaissance: resident-workspace-notification-
composition.ts is the existing PAID ONBOARDING handoff, bound to the promo bot and
issuing a work-bot deep link. resident-review-notification-composition.ts is also
bound to promo/form verification. Neither is the final main-payment resident
instruction nor work-bot card-review producer. Do not relabel them or send owner
card content through the promo token. S4b must create/compose genuine main-activation
and work-card-review source facts/jobs, reusing reviewed claim/recovery/transport
patterns and original WORK-bot authority. Current lifecycle notices cover renewal
stages, not main acquisition success. One onboarding handoff remains exactly once.

Standard operator_cases/local-outbox admits safety/negative-feedback/delivery
incidents only, so do not forge a safety case for overdue promotion or refusal
ratio. Use explicit owner-sourced lifecycle/quality escalation types in the protected
manager interface, with current facts/cohort and an actionable review/close path.
Kanban and new generic external messaging remain outside scope. Manager-visible
queue proof must be actual API/UI; owner unsolicited notices require actual durable
original-bot transport proof, not mere queue materialization.

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
