# Residency lifecycle completion (S4b)

Source contract: [implementation spec](../superpowers/implementation-artifacts/spec-resident-lifecycle-completion.md).
This increment adds operational follow-up to the existing paid residency flow.
It does not change financial authority, subscription intervals or provider gates.
The native baseline was `117af4a74b104bb0f0967868a8d7e46894b05c7b`.
No live provider, deployment or automatic feature enablement is part of this change.

## State and ownership

Migration `0075_resident_lifecycle_completion` is additive. The five tables have
separate lifetimes and authority; combining attempts with a queue row would lose
uncertain wire outcomes and combining daily checkpoints with an activation marker
would allow repeat welcomes.

- `resident_lifecycle_subjects`: one user-owned scan cursor, immutable first usable
  main-invoice source/time and one first-publication marker. Existing publications,
  including paused/inactive ones, receive `observed_baseline` and an observation
  timestamp; their unknown historical activation date stays null. No welcome is
  backfilled. Only the shared successful settled-card projection creates a new
  first-activation marker. Payment success alone is insufficient.
- `resident_work_notices`: immutable original WORK identity, consent snapshot and
  card-review/activation source; mutable pending/unknown/delivered/cancelled state.
  Reviews and the first welcome have unique source keys. Missing legacy WORK
  identity must not fail a valid settlement/review or invent a delivery target.
- `resident_work_notice_attempts`: immutable wire payload digest and sequence,
  durable unknown before network dispatch, then a validated receipt or proven
  non-delivery. A composite deferred FK binds each notice's last attempt to its
  own id and count. Deferred constraint triggers validate final delivery state.
  The receipt must match original bot/chat and a numeric positive message id.
- `resident_work_bot_state`: shared WORK throttle/pause. A second pending notice
  behind a throttle and temporarily ineligible first activation spend no wire
  attempt. Maximum three proven attempts; unknown is not an automatic retry.
- `resident_lifecycle_cases`: immutable source/deadline or daily cohort evidence,
  with a separate staff resolution. Closing a case never changes payment,
  publication, delivery result or a reservation. Daily zero/non-alert checkpoints
  are `no_action`, not visible work for staff.

All private rows cascade with physical subject erasure. Withdrawal cancels queued
notices; delivery revalidates exact original consent and route after locking.
Waitlist join command receipts are now immutable on UPDATE, while DELETE remains
available to the existing privacy erasure path.

## Operational rules

`RESIDENT_LIFECYCLE_COMPLETION_ENABLED=false` and
`RESIDENT_WORK_NOTICE_DELIVERY_ENABLED=false` are independent default-off switches.
Both require the existing expert-card capability. WORK delivery additionally
requires the matching configured WORK bot token. Existing paid-renewal flags do
not enable either new capability. No token belongs in source or diagnostic output.

The normal worker scans at most fifty due subjects with a fifteen-minute cursor.
Acquisition scanning includes fee-only residents; it is separate from the old
paid-renewal scanner. Only never-published residents receive acquisition cases.

- More than seven days after first card approval with no actually delivered,
  usable current materials: internal `materials_missing`. Placeholder text is
  never material delivery and never starts the resident's deadline.
- More than seven days after usable delivery, without manager-confirmed current
  proof: `promotion_overdue`. A pending/unknown material job is not a receipt.
- More than three days after the first verified usable main payment link, still
  unsettled: `main_payment_overdue` only while a current usable checkout exists.
  Unissued/unknown/unavailable checkout is `payment_reconciliation`, not resident
  fault. Replacing a link or order cannot change the captured first deadline.
- Daily UTC quality window `[now - 30 days, now)`: unique real client reservations
  in booked/completed/no-show/client-cancelled/expert-cancelled states. Actual
  human expert refusals include pre-booking refusal. Alert strictly above 20%;
  1/5 and 0/0 do not alert. Provenance comes from the real reserve audit or a
  matching waitlist join, entry and client receipt; missing provenance is counted
  separately and excluded from the denominator. There is no automatic ban.

Current tariff reads never create an invoice. Lifetime price remains readable
without an eligible link. A link appears only for the owned current pending main
order with verified provider binding, unexpired deadline, current card/profile
and consent authority. The old campaign refresh cancels its own notices without
clearing lifetime checkout state. Paid locked terms have no discount countdown.

## Staff interface and recovery

Use the existing `/admin/expert-verification` staff panel, **Сопровождение
резидентов**. Its list, detail and close endpoints under
`/v1/admin/expert-cards/lifecycle` require a valid session and fresh MFA on every
operation; responses are `no-store`. Detail exposes resident/source ids, deadline
or cohort window/counts. Closing uses expected revision and an idempotency key.
Retry an uncertain close with the same command. A conflicting revision requires
refresh. Logout clears private detail and discards delayed responses.

An unknown WORK attempt is retained and surfaced for review; restarting the
worker does not resend it. A validated provider receipt captured by the running
process can repair a lost database acknowledgement without a second wire call.
If that in-memory receipt was lost, staff must inspect the delivery externally;
closing the case records that investigation but does not fabricate a receipt or
make the attempt retryable. No force-resend control is introduced.

To contain an incident, disable the new worker/delivery flags and stop accepting
new work; normal shutdown waits for its in-flight cycle and drains retained WORK
receipts before closing the database, using the remaining shared shutdown budget.
The drain makes no transport calls. Existing database statement/lock timeouts
remain unchanged. If the shared close budget expires, close reports the timeout
and proceeds to resource cleanup; an already-started recovery can still be
settling. Recovery is not guaranteed after budget exhaustion or process crash.
Failed persistence keeps the attempt unknown. Keep the additive tables for
investigation. Do not roll back historical SQL or delete immutable payment facts.
Do not reactivate a provider, bot or production deployment through this runbook.

## Verification and limits

Runtime evidence belongs under route `35ab697bf43e`, package
`20261027-task-35ab69`; it is not committed as bulk logs. The populated upgrade
witness used the direct Drizzle SQL migrator on PostgreSQL 17.5, created two actual
published residents (one paused) and one fee-only approved card, applied
0075 with that migrator, preserved ten source tables byte-for-byte as JSON projections,
and proved observed-only baseline/resume behavior plus repeat-migrate idempotency.
The first two harness failures remain diagnostic evidence. This proves populated
SQL application and preservation, not execution of the repository `migrateDb`
exact-prefix preflight. No fresh prefix-preflight execution is claimed.

State reconstruction replays all hand-authored SQL on an isolated PostgreSQL17.5
and introspects into a fresh temporary directory. `0075_snapshot.json` and the
SQL-only catalogue retain composite FK positions and deferred/validation flags.
Do not use `drizzle-kit generate`. The split historical0074 fixture adjustment is
only compatibility maintenance; it is not the normal migration witness.

Each distinct focused integration file has a maximum of three executions. Older native
suite evidence is reused only as historical evidence, never presented as a fresh
run. Browser verification uses the shipped panel and real Chromium with synthetic
loopback responses; PostgreSQL API authorization is verified separately. Neither
is evidence of live delivery. The previous final Getzilla qualification failed;
local passes here do not erase that result or establish release readiness.

The complete PostgreSQL0075 SQL catalogue is 1,064,832 bytes, just above the
unchanged 1,048,576-byte general inspection bound. Its sole exception requires
that exact path, exact byte count and the registered SHA-256 before inspection.
Wrong-size, wrong-hash and adjacent-path inputs remain rejected. No historical
catalogue was truncated or rewritten to fit the bound.

The separate authority proof covers previously unexecuted adversarial boundaries:
superseded reviews, changed original recipient, observed PostgreSQL contention
between durable claim and wire dispatch, current proof revocation, privacy, and
actual replacement-order first-invoice continuity. Its expiry setup uses only the
named immutable-snapshot trigger in its disposable fixture, sets a short future
deadline and waits for that deadline. Before tested reads it asserts the original
trigger enabled state/definition, unchanged other order fields, and consistent
creation/first-issuance/payment/provider/quote times. This is simulated elapsed
time, not a claim that a production payment naturally expired during the test.

## Review corrections

Quality provenance follows a promoted reservation through immutable reschedule
facts, including a change of expert or service. The complete ordered chain must
start at the joined slot, connect every slot/version transition, match the owner's
reschedule audit and version hash, and end at the current slot. Missing, wrong-owner
or forked facts remain unproven; aggregation still counts one reservation once.
`resident-lifecycle-reschedule-lineage.test.ts` exercises actual promotion, two
reschedules, replay, human decline and adversarial chains. Its first run exposed
the defect, second passed both cases, and third passed those cases but failed an
additional experimental PG17 transaction-timeout probe: connection termination
prevented Drizzle rollback. That timeout approach and obsolete probe were removed;
the failed diagnostic remains retained. No new DB timeout behavior is shipped.

`resident-lifecycle-shutdown.test.ts` runs the actual worker composition/runtime
with synthetic WORK transport and a mocked lost database acknowledgement. It
proves normal close waits for recovery, handles an in-flight receipt, preserves
unknown on recovery failure and shares its remaining budget without resending.
The earlier real PostgreSQL lost-acknowledgement proof remains separate evidence.
