# Group residency implementation gap

Source audit: Kant,2026-10-12. Independently reviewed actual event, booking,
catalogue and SQL paths, including differently named capacity/overlap checks.
No live mutations or test execution. This is an open product requirement, not
an implementation or acceptance claim.

## Existing behavior

- Ownership is slots → expert_services → experts → user. There is no explicit
  group-event publication identity or organizer ownership in this model.
  `packages/db/src/schema/catalog.ts:23`.
- Admin service activation toggles service visibility. It does not create an
  event or consume paid residency allowance.
  `packages/db/src/repositories/admin-repository.ts:551`.
- Catalogue checks active/verified expert, active service, slot freshness/time
  and remaining seats, not paid residency or monthly group allowance.
  `packages/db/src/repositories/catalog-repository.ts:115`.
- Seat counts are per slot, not monthly event counts. Expert-overlap admission
  rejects intersecting reservations including another attendee in the same slot.
  `packages/db/src/repositories/booking-repository.ts:1393` and1720.
- The Planerka booking path explicitly requires capacity1. Removing that check
  alone cannot implement group attendance or event publication.
  `packages/db/src/repositories/planerka-booking-repository.ts:62`.
- Renewal appends paid duration; it creates no monthly usage periods. Order
  expiry concerns unpaid orders. Neither is a monthly allowance reset.
- Expert suspension/unverification and service deactivation are not residency
  pauses: they neither preserve/shift paid entitlement periods nor record carryover.

## Source precedence and unresolved semantics

Accepted V2 START/BASE/PRO retain monthly limits0/1/3. A quote snapshot copying
those values does not implement three separately available months for a90-day
purchase, nor authorize a nine-event pool available immediately.

Update4 tabs «Доп в рекл-бот» section6 and «Второй доп в рекл бот» block2.4
replace the old three-month pause copy: a1–2month pause preserves residency
status, profile/history/settings, and return does not require repeated placement,
verification or briefs. This is not permission to delete a profile after a
hard-coded old three-month deadline. It does not itself specify whether prepaid
time freezes or how unused event allowance carries over.

Old main-source section4.3.3 describes excess-event charges for training centres,
studios and salons. Do not apply its10/15percent financial terms to expert V2
without an applicable source/decision. Old base/exclusive pricing prose likewise
does not silently replace accepted V2 tariff facts.

Further source reconciliation is active for period boundaries, counting at
publication versus occurrence, cancellation/republication, rescheduling, pause,
renewal/tariff changes and excess-event charging. Do not invent those money or
entitlement policies from the stored integer limit alone.

### Reconciliation result

DEC-FIN-020 explicitly defines each event card as consumption of a group unit;
attendee reservations or attendance do not consume separate group units.
DEC-FIN-021 establishes rolling30×24hour residency periods from settlement, not
calendar months. These supersede the earlier uncertainty above about counting
unit and cadence. Preserve the existing unexpired paid interval on early renewal;
do not reset its boundary merely because another payment arrives.

The four update4 tabs add no formula for unused expert allowances, cancellation
refunds or voluntary-pause financial accounting. Owner questions now pending for
carryover/cancelled-card restoration/overage handling and whether pause freezes
paid days and remaining allowance. Proposed answers are not accepted policy.
Neither source establishes pooling three monthly allowances at purchase time.

## Required integration

1. Explicit group-event identity, owner and publication lifecycle.
2. Transactional event-to-paid-period admission, unique consumption and bounded
   concurrency; derive entitlements from the settled order snapshot.
3. Catalogue and booking eligibility rechecks that admin activation cannot bypass.
4. Cancellation, rescheduling, republication, pause and reversal transitions using
   the same usage authority. Deliberate group attendance/capacity support.
5. Real-PG concurrency and authenticated journey evidence before any live claim.

Keep the real catalogue empty. Synthetic events belong only in isolated tests.
