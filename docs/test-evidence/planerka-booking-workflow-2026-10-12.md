# Planerka booking workflow — local candidate evidence

## Addendum: legacy projection closure — 2026-10-12,16:13UTC

Hubble independent source review accepted the P2 correction: completed/no_show
are excluded from the active list, while cancelled/expired unresolved calendar
outcomes remain cancellation_pending. Audit rows and pagination anchors remain.

Coordinator executed the EXISTING tests/integration/planerka-migration-state.test.ts
at16:13:13UTC:7/7 PASS, including5 new pre0043-history regression cases and2
original state-reconstruction checks. This file was1/3 and is now2/3; no exhausted
workflow test was run. New cases genuinely exercise migration-created legacy
reviews, not renamed copies of the workflow suite. No full/multi-path test command.

Environment check passed; isolated Compose project ii-tonya-legacy-review-20261012
used PostgreSQL17.5 with server_version_num170005 verified before running. An
initial standalone connection probe from repository root lacked pg module
resolution; rerunning it from packages/db passed. This was not a test invocation.
No production database, provider messages, flags or deployment were touched.
This addendum supersedes pending-P2-verification notes, not other release gates.

Baseline: `690797db64fd80aa1aeccea8003543de470d8c16` on `codex/planerka-api`.
Candidate remains uncommitted. This is not exact-SHA release evidence, a live
provider probe, notification delivery evidence or production acceptance.

## Changes and boundaries

Imported the unchanged authorized payment prerequisites from
`ab4cd4a7d30ccbf4a58997f0aabbe23d45b2f01b` and
`068b808989ac64bf9d1111800b155ef70454e0c7`. Merged barrel exports rather than
replacing current account code. Coordinator independently confirmed eleven new
settlement files matched source bytes and all42 pre0042SQL files were unchanged.
No financial rules, coordinator audit/policy/preflight files or AGENT-STATUS were
edited by this implementer. No commit, push, deployment or activation occurred.
Final implementer byte comparison also passed for all11 settlement files,
all3 calculation/specification files and all42 pre0042SQL files.

Migration0043 adds explicit real-service mappings, reservation-unique provider
operations, an account request limiter and a legacy-booking audit queue. It uses
hand-authored SQL with database-derived snapshot/supplement linked to0042.
Approval retains reserved occupancy and publishes no confirmation. Verified
provider completion commits UID, booked status and a unique confirmation event
together. Cancellation, expiry, stale leases, returned-UID recovery and erasure
are durable. API/web expose pending and unverified states. New creation and
recovery use independent default-off configuration switches.

## Actual focused test invocations

Counts are executions during this implementation, not numbers of assertions.
All final results below are fresh. No coordinator test runs are included.

| File                                                      | Invocations       | Observed results                                                                                                                                                                                                                                                 |
| --------------------------------------------------------- | ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/domain/src/reservation-provider.test.ts`        | 2/3               | Run1 behavioral RED: approval returned booked. Run2 GREEN1/1.                                                                                                                                                                                                    |
| `packages/domain/src/reservation.test.ts`                 | 1/3               | GREEN7/7; historical expectation updated to the approved pending contract.                                                                                                                                                                                       |
| `packages/application/src/booking-service.test.ts`        | 1/3               | GREEN6/6; fixture emits no premature confirmation.                                                                                                                                                                                                               |
| `packages/config/src/planerka-workflow.test.ts`           | 2/3               | Run1 behavioral RED2/2: missing capability validation/projection. Run2 GREEN2/2.                                                                                                                                                                                 |
| `packages/worker/src/planerka-booking-dispatcher.test.ts` | 1/3               | GREEN2/2; startup ownership/mapping checks and recovery-only access.                                                                                                                                                                                             |
| `apps/web/src/booking-provider-state.test.ts`             | 2/3               | Run1 behavioral RED: pending state rejected. Run2 GREEN2/2, including cancellation response preservation across pagination.                                                                                                                                      |
| `apps/web/src/booking-provider-browser.test.ts`           | 1/3               | GREEN1/1 in local headless Chrome; real rendering functions, synthetic data, no external requests.                                                                                                                                                               |
| `apps/api/src/routes/client-booking-provider.test.ts`     | 1/3               | GREEN1/1: pending list and202 cancellation result.                                                                                                                                                                                                               |
| `tests/repo/migration-history-integrity.test.ts`          | 1/3               | GREEN8/8.                                                                                                                                                                                                                                                        |
| `tests/repo/migration-state-baseline.test.ts`             | 1/3               | GREEN7/7, including0043 input/artifact hashes.                                                                                                                                                                                                                   |
| `tests/integration/planerka-booking-workflow.test.ts`     | **3/3 EXHAUSTED** | Run1 setup failure ECONNREFUSED, no behavior tested. Run2 executed12:7 passed/5 failed because PostgreSQL rejects regex repetition bound256. Fixed to character validation plus length bound. Run3 GREEN16/16 at14:47:48UTC, including added review regressions. |
| `tests/integration/booking-concurrency.test.ts`           | 1/3               | GREEN18/18. Successful approval fixtures seed valid mappings; historical terminal/read fixtures carry explicit provider facts.                                                                                                                                   |
| `tests/integration/planerka-migration-state.test.ts`      | 1/3               | GREEN2/2: independent PostgreSQL17.5 replay/introspection and SQL-only catalogue comparison through0043.                                                                                                                                                         |

The one allowed multi-path command was consumed at14:47:46UTC: ten non-PG
files above,37/37 passed. PostgreSQL workflow16, legacy booking18 and migration
state2 ran separately. Final total: **73 passing tests across13 files**.
The PostgreSQL run2 is a failing implementation check, not a claimed clean
pre-implementation TDD RED. Not every newly added case was executed before code.

Exhausted transport `packages/integrations/src/planerka/client.test.ts` and paid
order repository tests were never invoked. Imported paid migration-state test
was not rerun (historical2/3 remains unchanged). No full suite or `pnpm verify`
was run. Do not repeat the exhausted workflow test, rename it, or include it in
a broad suite without an explicit additional-run authorization.

## Matrix and recovery evidence

The16-test PostgreSQL file covers authorized approval, foreign/stale/duplicate
decisions, missing mappings, one actual dispatcher create invocation, bound UID
and unique confirmation, transaction rollback at publication, mismatched host/
event/attendee/time, cancellation inside the provider call, compensation with
creation disabled, pre-send cancellation, definite conflict, unknown POST without
replay, expired lease fencing, a late UID racing an operator decision, expiry,
account-wide concurrent request admission, cancellation timeout plus GET recovery,
erasure blocking/deletion protection, worker rollback with retained UID and GET
recovery, and completed visits ceasing to block local erasure.

The legacy booking regression exercises consumed Telegram callback behavior.
Chrome exercises pending versus booked text and the usable empty catalogue.
The API test verifies public projection and asynchronous cancellation response.
These do not prove real authentication, live provider availability, real mappings,
full browser navigation or notification delivery.

## Environment and static checks

Development check passed with Docker: Node24.21.0, pnpm11.9.0,
PowerShell7.6.6, Docker29.9.0, Compose5.6.0. Owned Compose project
`ii-tonya-planerka-workflow` used `postgres:17.5-bookworm`; tests asserted170005.
The internal network did not publish its host port, causing the first setup
failure; subsequent tests used the verified isolated container address.
After verification, the owned synthetic PostgreSQL container, project network
and test volume were removed. No pre-existing container or real data was removed.

Domain, config, application, database, integrations and worker builds passed.
Worker initially encountered stale integrations declarations; rebuilding the
existing transport exports corrected that without changing transport source.
API/worker/web typechecks, tests typecheck, scoped ESLint, Prettier normalization
and `git diff --check` passed. PostgreSQL reconstruction produced109 tables,
703 constraints and307 indexes; formatted snapshot/supplement hashes were
refreshed before the passing migration-integrity and independent state tests.

## Independent review and remaining gates

Read-only independent reviewer session
`01a1308b-f62a-7ed1-8c94-8b3a25831997` reported six findings. Corrected locally:
UID loss after completion rollback; late-UID/operator race; completed visits
blocking erasure; historical unverified booked projection/audit; and cancellation
feedback inferred from an incomplete page. Relevant workflow/browser regressions
passed. These fixes have not received a second independent closure review.

The sixth finding remains open: **there are no production notification consumers
for `telegram.reservation_request`, `client.booking_confirmed`, or booking
cancellation/expiry topics**. Publication is atomic and durable, but expert
approval-request delivery and client confirmation delivery are not implemented.
No fake handler was added. End-to-end booking acceptance is therefore incomplete.

Real inventory/availability import, working credential and event-type evidence,
operator tooling for manual outcomes, live target authorization, notification
composition, independent closure review and exact-candidate release/rollback
evidence remain separate gates. Historical bookings are quarantined for review;
their UIDs are not invented and creation is not replayed. No hosted CI, Database
Gate or Trust CI success is claimed. See the Planerka runbook for recovery-preserving
rollback; never disable recovery merely to stop new creation.

## Authorized activation preflight — 2026-10-12,14:57UTC

The owner explicitly lifted the production activation prohibition. Read-only SSH
used the existing deployment identity and strict pinned host-key verification.
Observed live state:

- Native and web:43a93e2131cde6bb09a6825fc5b83dfbf91fc600.
- API, worker and nginx:active. Readiness:postgres, migrations, workerLease and
  adapters all true. Server-side HTTPS root/account:200. This is not independent
  external-browser acceptance.
- Production PLANERKA_API_KEY and PLANERKA_ACCOUNT_ID:absent. Local inspected
  Planerka credential/base URL fields:placeholders. No secret values were printed.
- PLANERKA_ENABLED=false; new create/recovery switches unset;
  CLIENT_BOOKING_ENABLED=true; CLIENT_BOOKING_RESERVE_ENABLED=false;
  TELEGRAM_ENABLED=false.
- A READ ONLY transaction with a5-second statement limit returned experts0,
  expert_services0, slots0,42 migration rows, and no Planerka mapping/operation
  tables. No customer rows or connection credentials were printed.
- Source inspection still finds telegram.reservation_request and
  client.booking_confirmed only at durable producers, not delivery consumers.

Turning on the new worker without credential/account configuration fails its
configuration gate; creation additionally requires genuine mappings. Owner
authorization does not supply those facts or implement missing delivery handlers.
No deployment, migration, flag change, calendar mutation or message was attempted.
No additional tests were run: all per-file counts above remain unchanged.
Release backup/isolated-restore and exact-candidate evidence remain outstanding;
the generic deployment script was not invoked. Coordinator-owned files were
not edited. Both SSH preflight processes exited successfully; no remote task or
test session was left running.
