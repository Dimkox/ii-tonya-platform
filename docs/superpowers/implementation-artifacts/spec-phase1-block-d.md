---
title: Expert residency renewal and calendar lifecycle
status: done
baseline_commit: 35f341c0e5c5bc1507f46a0cf87250f92b186eeb
context:
  - docs/superpowers/implementation-artifacts/spec-phase1-through-phase2-execution.md
  - docs/superpowers/implementation-artifacts/spec-phase1-block-c.md
  - packages/db/src/repositories/expert-residency-provider-inbox-repository.ts
  - packages/db/src/repositories/expert-campaign-quote-repository.ts
  - packages/db/src/repositories/expert-onboarding-main-payment-repository.ts
  - packages/worker/src/expert-residency-expiry.ts
  - apps/worker/src/runtime.ts
---

## Reuse and compatibility

Canonical settled expert-residency order intervals own paid time and renewal stacking.
Existing expiry work expires unpaid orders; client package billing is a different
ledger and is not an expert entitlement source. Reuse the campaign quote engine,
explicit main acceptance, canonical verified settlement and strict injected checkout
capability. No parallel price engine, generic mint, automatic charge or new client UI.

Pause keeps the account/card and original paid calendar intervals. Paid calendar
time continues during pause; no free extension, banked credit or historical period
rewrite is introduced. Return only re-evaluates actual current paid coverage. This
conservative compatibility rule implements the frozen execution contract: a return
without valid paid entitlement remains suspended/payment-required.

## Required behavior

- D1: at seven days before the current paid end, create one durable owner-bound
  renewal bill per expert/paid-end cycle. Quote current server terms using the
  existing engine; the bill is provisional until fresh explicit owner acceptance.
  An expired A/C acceptance is never reused. Expired quotes re-quote and require
  renewed acceptance; existing unpaid/unknown provider orders recover the same
  order until their original deadline. If the old campaign term is unavailable,
  require an explicit supported choice rather than silently changing period/price.
  Fully configured owner invoice commands automatically return a real validated
  same-order checkout link. Managers perform no routine technical billing step.
- D2: evaluate canonical coverage with PostgreSQL time. Overdue hides publication
  and disables existing full expert access while the work bot retains lifecycle,
  payment and archive commands. Bound reminders to one per cycle/stage: seven days,
  one day, overdue, and seven days overdue/archive offer. Retries/restarts never
  duplicate a confirmed or uncertain send.
- D3: private owner `/pause YYYY-MM-DD` accepts a strictly future return date no
  later than three PostgreSQL calendar months. Hide immediately, retain data and
  audit the change. `/resume` and automatic due return restore only current paid,
  eligible, consented ownership; otherwise remain payment-required. Concurrent
  settlement/refund/pause/erasure must not resurrect publication or unpaid access.

The renewal bill/quote is a real durable invoice intent, not a provider payment or
accepted price. Actual payment order/link follows explicit acceptance through the
existing canonical path. Bind its exact accepted quote to the bill inside the
checkout transaction; no latest-acceptance race or replacement of an existing bill
order. Successful renewal reconciles next billing date from canonical intervals;
refund/reversal and archived state must remain authoritative.

## Surfaces and delivery

Actual trusted work-bot ingress handles `/residency`, `/renewal`, fresh quote and
accept/invoice commands, `/pause` and `/resume`; existing expert navigation survives.
Reuse numeric-bot/update receipts, authenticated private identities and original
consent barriers. No fake Telegram updates or fabricated consent for scheduled work.

Actual bounded worker creates due bills/notices, suspends overdue access and
re-evaluates returns. Delivery uses the real fixed-origin bounded Telegram transport,
current private scope and consent immediately before send. Durable attempt markers
are unknown-outcome quarantine, never continuing send authority or blind retry.
External delivery/new checkout flags remain independently default-off and require
complete reviewed capabilities. Existing financial reconciliation continues with
new admissions/delivery off. Erasure removes live lifecycle/notification data and
raw routing fields while retaining only required immutable financial audit UUIDs.

## Ownership and verification

- Storage owner: new0055 SQL/journal, lifecycle schema/repository/audit/notice storage,
  privacy disposition and narrow shared receipt operation type extension.
- Financial owner: exact renewal quote/order binding and paused settlement projection
  compatibility in existing main payment/gate modules; no canonical mint export.
- Ingress owner: lifecycle application service/config, actual API work composition,
  owner quote/accept/invoice/link commands and focused new non-PG tests.
- Worker owner: bounded lifecycle runner, actual worker composition/runtime/main,
  real notice transport integration and focused new non-PG tests.
- Lead: sole new integrated PG file, evidence/status, final composition contracts,
  independent review and local checkpoint. Metadata reconstruction owner assigned
  after0055 freezes. One writer per file set; reviewers report rather than edit.

Non-PG behavior RED first. New integrated file uses real hooks for heavy preparation,
explicit measured transition bodies and existing bounded drain. Verify paid-end
boundaries, seven-day uniqueness, quote expiry/acceptance/order recovery, late verified
payment, pause/return calendar limits, refund/erasure races, unknown notice delivery
and actual bot/worker wiring. Preserve financial snapshots, maturity/debt and first
source. Explicit task-wide count override permits necessary focused corrections;
record all attempts, no repeated unchanged suites or repeat-tool count above3.
Relevant types/lint/format/diff, actual PostgreSQL17.5 migration state and independent
entitlement/edge review precede the D local commit, then Phase2 continues.

## Integration refinements from source review

One bill remains unique per expert/paid-end cycle. Append-only invoice-attempt
bindings preserve each accepted quote/order; a new attempt requires the old canonical
order to be terminal expired plus a fresh explicit accepted quote. Pending/unknown
orders recover unchanged. Atomic owner acceptance and invoice use one existing
checkout transaction and durable real update receipt, without fake Telegram events.

Paid coverage follows the continuous settled interval chain containing DB now,
including adjacent prepaid periods and stopping at refund gaps. New verified money
for a disconnected future period remains financial truth without granting current
publication/access. Projection only uses exact settled main-binding/review proof;
it never replays settlement or backfills qualification. Pause dates use the UTC
PostgreSQL calendar. The `paidUntil` display field is current continuous paid end
or the last past paid end; lifecycle status/current coverage authorize access,
and a disconnected future end is never presented as current paid coverage.

Historical residents retain calendar/pause compatibility. The new D bill reports
`requires_card` until an actual approved C workflow exists; it does not fabricate
onboarding or weaken C financial authority. Existing generic legacy checkout and
navigation remain available where already enabled. Test time boundaries use audited
schema-valid short legacy tariff fixtures and genuine GET settlement; public admin
minimum duration and settled history are unchanged. Real C monthly publication,
renewal, pause, refund and erasure paths remain covered. No engineered clock is added.

## Local acceptance

The first focused D PostgreSQL17.5 invocation passed12/12 with all runtime bounds,
financial/history assertions and real GET paths intact. Scope123/123 and history8/8
passed on their first D runs; relevant builds/types/lint/format and independent
financial/storage/worker/fixture reviews passed. Local implementation is complete;
provider/content/custody/release gates remain separate. Continue Phase2 locally.
