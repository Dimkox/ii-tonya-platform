# Commercial-review release and recovery

Status: preparation only. No final RC or deployment approval evidence is asserted here.

## Scope and authority

Deliver the complete commercial product for human review at ii-tonya.ru. The owner authorized implementation and deployment, with an empty real catalogue. Do not add written-consent/signing steps to entry. Factory integration and Trust CI are excluded; absence of external acceptance must be disclosed. Automated checks do not constitute human acceptance.

## Current verified target

On2026-10-12 the dedicated host serves native and web revision
`43a93e2131cde6bb09a6825fc5b83dfbf91fc600`.
Read-only server health and HTTPS checks are recorded in
`docs/test-evidence/production/2026-10-12-readonly-preflight.md`.

The live `.previous-release` currently names
`releases/48009f9ce4de9f8258eede8d59b950899eafd0a8`.
It is NOT proof that this is the correct rollback target for a future release.
Capture the actual native/web symlinks immediately before switching and verify
their schema compatibility. Do not rely on historical values in the older native
deployment runbook.

## Required RC evidence

### Current integration and recovery checkpoint — 21:43 UTC

Dedicated expert session implementation passed final API24/24 and independent
source review, but PG/browser corrections remain unrun after19/21 and5/6.
Saved-quote expert routes are now composed by the ordinary server, with genuine
DB/session/referral dependencies. Service final28/28 passed; new PG/HTTP final
11/12 failed only a canonical tariff-name expectation, corrected but unrun.
Providers remain absent/disabled; checkout returns503 before financial writes.
These facts do not establish working paid checkout or an enabled expert cabinet.
Evidence: expert-authenticated-entry-2026-10-12.md and
expert-campaign-api-2026-10-12.md under docs/test-evidence.

A real encrypted production PG16.15 logical backup was restored to an isolated
matching16.15 instance;102 same-snapshot table counts matched. Candidate SQL0042–49
replayed on that COPY after42 historical hashes matched. The source database and
services were unchanged; temporary restored data was removed. The archive/key and
read-only restore helper remain on the dedicated server. Manifest HMAC was added
after the drill and reviewed; same-host custody, ACL/role omission and absent
financial/PITR/exact-SHA rollback checks remain limitations, not cleared gates.
See docs/test-evidence/production/2026-10-12-logical-backup-restore.md.

### Payment authority blockers — 2026-10-12 follow-up

Campaign checkout PG3 at20:19:02 passed71/72 and exposed a real reversal/settlement
authority defect: reversal can release a pending order's credit without cancelling
the order, followed by another release at settlement. A split-grant reservation
can also be partially released and then skipped or over-released by another path.
This was detected in isolated synthetic tests/source, not a claimed live incident.
Implementation of atomic invalidation, per-grant outstanding release and visible
late-payment handling is authorized in
`docs/superpowers/implementation-artifacts/expert-credit-invalidation-fix.md`.
It is a release blocker. Do not weaken the exact-ledger oracle or deploy based
on71 passing neighboring cases. The file's3/3 budget is exhausted; extra1 was
requested from the owner and remains unapproved.

The direct- and repayment-backed cancellation corrections subsequently passed
scoped independent source review. Current87 cases remain unrun; static passes
and source acceptance do not replace the failed last PG result or release gate.

Group-event publication and monthly allowance enforcement are absent, not merely
disabled. The stored0/1/3 tariff limits and90-day quote duration do not grant or
enforce usage periods. Update4 pause promises also lack a residency lifecycle.
Track these full-product blockers in
`docs/operations/2026-10-12-group-residency-gap.md`; do not present group tariffs
or pause support as completed based on catalogue seat counts or profile toggles.

Independent source review confirmed two existing expert-settlement defects:
distinct orders for the same expert can calculate overlapping residency periods;
deadline checks use transaction-start time after a lock wait. These are not
production incident claims, but both violate ERR-FR-030/031 and block payment
release acceptance. Track reproduction/fix/review in
`docs/superpowers/implementation-artifacts/expert-settlement-authority-fix.md`.
Do not infer coverage from duplicate callbacks for the same order or concurrent
payments for different experts. Require distinct-order same-expert concurrency
and a real lock wait crossing the deadline.

Late provider payment is a distinct financial exception. A rejected entitlement
inbox row is not a refund and is not consumed by the existing attempt-based
reconciler. Require durable authenticated evidence and an unresolved operator
signal for both expiry-before-callback and callback-waiting-through-expiry orders.
No release claim may equate an expired local order with absent provider money.
The candidate operator procedure is
`docs/runbooks/expert-late-payment-operations.md`. Its protected routes and
published support journey must be verified before calling the exception operable.

Campaign arithmetic has37 passing focused tests; shared request schemas have48;
immutable quote storage has67 passing focused PostgreSQL tests. None is a live
campaign checkout. Quote-bound order creation and campaign settlement dispatch
are now assigned under
`docs/superpowers/implementation-artifacts/spec-expert-campaign-checkout.md`.
API/Telegram/promo/provider composition and monthly entitlement enforcement still
remain required. Do not activate discounted checkout from storage checks alone.

The late-payment operator API passed22 focused cases, including outer buildApp
forwarding; operator PostgreSQL queries passed10. Settlement final run passed8
of9: raw timestamp representation caused one assertion failure. Its test-only
correction passed source review but has not been rerun; the owner was asked for
one extra invocation beyond3/3. This remains an explicit release-verification
gap, not a passing settlement gate. See the current header of
`docs/test-evidence/expert-settlement-authority-2026-10-12.md`.

### Notification controls and rollback — candidate0045

These are release instructions, not evidence that the controls were enabled.
The environment flag and database gate are different controls:

- `BOOKING_NOTIFICATION_ADMISSION_ENABLED=false` stops this process's new
  reservation-origin capture and backlog capture. It does not globally disable
  lifecycle producers for reservations that already have a saved context.
- `booking_notification_bot_controls.admission_enabled=false` is the global
  database authority for new lifecycle intents. Explicitly disable it for the
  exact reviewed bot when stopping admission. Do not infer this from an env change.
- `BOOKING_NOTIFICATION_SEND_ENABLED=false` stops new HTTP invocations in the
  restarted worker. A previously consumed/in-flight call may finish once.
- Keep `BOOKING_NOTIFICATION_RECOVERY_ENABLED=true` and
  `BOOKING_CALLBACKS_ENABLED=true` while existing attempts/buttons need resolution.
  Keep callback signing material and old vault keys until their retention permits
  removal; do not switch to a release that cannot consume the outstanding buttons.

Provision the control row explicitly before enabling the worker, initially with
admission disabled. Record target bot identity privately, operator authorization,
release SHA and before/after values without exposing tokens or callback content.
Startup only checks the row; it must never provision, resume or clear throttle.
Use the repository's explicit `setAdmissionEnabled()` operation under its lock
contract, not an unreviewed bulk UPDATE. The operation does not create a missing
row, clear `paused_at`, change `pause_reason`, or shorten `not_before`.

For rollback: disable the exact durable admission gate; disable process admission
and sending; stop accepting new work immediately; drain current HTTP/completion up
to the shutdown deadline; then close DB. Preserve local recovery and compatible
callback ingress. Verify no new attempts appear and pending attempts reconcile
without another sendMessage. A crash before receipt persistence remains unknown
and requires operator review; there is no durable receipt spool or Telegram
history-based recovery. Already-started SQL is not forcibly cancelled by drain.

Before claiming release readiness, test this procedure against the exact candidate
and migration0045 on the production-compatible database version, including restore.
Current local tests do not prove this production rollback procedure.

### Handoff withdrawal evidence — T5 candidate, not activated

The local revocation consumer is under implementation. Do not activate it from
this procedure alone. Require its reviewed migration, focused evidence and actual
worker composition first. Its receipt means local processing, not remote deletion.

For an operator case originating from `booking.handoff_revoked`:

1. Locate the source and local receipt by their internal references in the protected
   operator environment. Do not copy payloads or identifiers into public reports.
2. Verify the receipt binds the actual consent decision, user and `expert_handoff`
   purpose. Both `denied` and `revoked` can be valid. A later grant does not erase
   the earlier withdrawal. A cascaded note withdrawal has its own handoff decision.
3. Interpret zero known actionable recipients narrowly. It does not prove that no
   historical disclosure occurred. `historical_disclosure_untracked` requires
   historical evidence review; never derive recipients from the currently assigned
   expert or from a consent scope alone.
4. Keep invalid-source and legacy uncertain-delivery cases distinct. Never repair
   a questionable source by supplying a guessed consent ID, setting it pending, or
   manufacturing a successful Telegram response. Case acknowledgement is not
   evidence of delivery, recipient deletion or completed account erasure.
5. Preserve independent booking-message authority. Withdrawing optional handoff
   consent alone must not revoke ordinary booking notifications or undo a booking.

For notification delivery uncertainty, inspect the exact attempt and its bound
bot/chat/message receipt through the trusted reconciliation path. `delivered`
requires an authenticated matching receipt. `unknown` or `manual` must not be
resent merely because no message ID is available. A terminal `failed` result is
not interchangeable with unknown outcome. Conflicting evidence remains a case;
an operator checkbox cannot replace provider facts.

The current erasure candidate retains raw attempt/receipt bindings. Do not claim
full notification-identifier anonymization. The metadata schedule in
`docs/operations/data-retention.md` is not approved for live data, and neither
three years of retention nor35-day backup expiry is an approved deletion result.
Keep this limitation in the human-review handoff until policy, implementation and
actual backup evidence are complete.

### Candidate evidence checkpoint — 2026-10-12, after16:13UTC

This is an uncommitted development candidate, not a release SHA. Production was
not switched during this work. The following distinctions must survive handoff:

| Capability                        | Evidence now                                                                                                 | Remaining before product acceptance                                                                                 |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------- |
| All-tab specification registry    | 29tabs, SQLite integrity=ok, private remote copy hash matched; update4 reconciliation recorded               | Implement/reconcile remaining requirements; document title “implemented” is not evidence                            |
| Provider-confirmed booking        | Local73-test calendar evidence; independent scoped review; legacy correction subsequently7/7 migration tests | Actual notifications, provider availability/mappings and final combined RC                                          |
| Booking notification presentation | 61/61 focused tests; independent T1 review accepted                                                          | Recipient/consent ledger, transport, callback/API and worker composition; templates do not send                     |
| Selarti                           | Native-client implementation active; documented response mismatch identified                                 | Complete/review native client, durable correlation/response bridge, authenticated composition and live availability |
| Expert discounted quote           | Accepted Energy schedule and5000RUB final floor recorded                                                     | Actual quote/check-out integration currently returns base price; historical orders must remain unchanged            |
| Public site/account               | Last server-side HTTPS200 and live SHA43a93e2 evidence                                                       | Fresh independent browser and authenticated scenario acceptance; server200 alone is insufficient                    |
| Planerka credentials              | Candidate key found; one profile GET returned401                                                             | Verify usable plan/key and account ownership; payment restriction is possible, not proved                           |
| Recovery                          | Runbook and retained releases identified                                                                     | Isolated backup restore, exact candidate compatibility and valid rollback target                                    |

Test budgets: calendar workflow3/3 exhausted; calendar transport6runs exhausted;
paid-order repository extra run4 exhausted; notification renderer2/3; Planerka
migration-state2/3 after the seven-test run at16:13:13UTC. Do not rerun exhausted
files through a generic release command. No hosted CI/Trust CI is claimed.

The temporary legacy-review PostgreSQL17.5 container, its network and synthetic
volume were removed after the passing run. Existing containers and real data were
preserved. No catalogue seeding, written-signing gate or production activation was
introduced by these checks.

1. Freeze one full Git SHA after all applicable audit requirements are reconciled,
   implemented and reviewed. Link every deferred/unavailable obligation explicitly;
   do not call isolated transports a finished product.
2. Verify combined migration lineage including client payments0042 and calendar
   operations0043 on isolated PostgreSQL17.5. Preserve all prior SQL. Historical
   tests from a different branch are not combined-RC evidence; exhausted test
   files require a specific owner exception, not renamed copies.
3. Prove client authentication, account authorization, actual assistant response,
   operator handoff, empty catalogue, appointment lifecycle under synthetic local
   inventory, checkout settlement/refund idempotency, privacy behavior and truthful
   public copy. No synthetic profiles may enter the real catalogue.
4. Check unavailable subscriptions and provider credentials separately. Record
   exactly which journeys cannot run live and what the customer must enable.
   Customer willingness to pay later does not make the provider available now.
5. Run scoped typechecks, lint, formatting, whitespace and independent review.
   Record omitted hosted CI/external acceptance honestly. Do not require factory
   work excluded by the owner, or fabricate a replacement receipt.
6. Build the frozen API/worker and web artifacts; bind checksums, SBOM, signature
   and provenance to that exact SHA. Retain the existing env outside artifacts.

## Cutover and rollback

Read-only host check on2026-10-12 found /usr/bin/pg_dump and pg_restore16.15;
pg_lsclusters reports local16/main online on5432. Available root-filesystem space
was5,379,920KiB. This identifies installed/local services, not by itself the
application's authenticated database connection or a usable backup. Verify actual
application server_version_num before selecting dump/restore clients and proving
migration compatibility. Repository evidence database remains PostgreSQL17.5;
do not silently replace its pin or upgrade production to match local tests.
No backup/restore, package installation or database mutation was attempted in
this check. Fresh-target compatibility and restore evidence remain required.

Follow-up peer-authenticated read-only psql connection as ii_tonya to the project
database named ii_tonya returned server_version_num160015. This confirms that
database is PostgreSQL16.15, not17.5. No credentials were printed and no SQL write
was performed. Verify runtime DATABASE_URL targets this same database before
cutover; include PostgreSQL16 compatibility evidence without replacing mandatory
17.5 evidence or silently upgrading the live cluster. Ledger implementer notified.

- Before migration, obtain an identified restorable backup and verify a restore
  in isolation. The repository disaster-recovery drill is marked not executed.
  The observed systemd timer list has no named application PostgreSQL backup;
  this does not prove that hosting snapshots or another backup mechanism are absent.
  Follow-up recovery inventory at20:56–20:58UTC confirmed the previous release
  directory and required entrypoints, but no matching backup file within the
  bounded two-directory/depth2 search. Full scope and limits are recorded in
  `docs/test-evidence/production/2026-10-12-recovery-inventory.md`.
- Inspect runtime capabilities without printing secrets. Separate new-operation
  admission from completion/cancellation/reconciliation of existing work.
- Rehearse API, worker and web compatibility on both sides of the migration.
  Do not apply the generic deploy script blindly: its automatic error path rolls
  application code back but cannot undo committed migrations or external effects.
- Switch only verified immutable artifacts. Check external HTTPS from a working
  browser network, not just loopback readiness. Compare served SOURCE_SHA.
- On failure, stop new admissions. Retain a worker capable of reconciling new
  payment/calendar operations. Restore only a verified compatible API/web pair;
  do not downgrade into code that can falsely confirm appointments.
- Preserve paid facts, provider UIDs, pending operations, audit evidence and the
  existing database. Database recovery is forward-fix unless a separately reviewed
  isolated-restore promotion is explicitly selected. Never erase production to
  make migration verification pass.

## Human handoff

Provide the public URL, exact release SHA, scenario results, known limitations,
provider setup/payment instructions, rollback target and recovery evidence.
Mark the outcome ready-for-review only when that evidence exists; record the
human verdict separately after the reviewer actually evaluates the product.
