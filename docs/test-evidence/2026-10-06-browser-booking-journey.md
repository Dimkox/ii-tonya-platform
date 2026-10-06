# Browser booking local evidence — 2026-10-06

Code revision: `2c0c7c92e2f1cc40ab102bb0fe321cb375ba8d5b`.
Foundation evidence: [grant baseline](2026-10-06-booking-grant-foundation.md).
Plan: [browser booking](../superpowers/plans/2026-10-06-browser-booking-authority.md).

## Implemented locally

Owner-only20-row active booking pages use receipt creation/handle keysets and preserve
cancelled anchors. A finite browser bridge keeps one secure cookie/CSRF lifecycle,
checks fresh grant authority and leaves list/cancel available with reserve off.
The account UI supports structured catalogue search, protected reservation, active
list recovery and cancellation. Polling is bounded10 reads/30seconds. Uncertain
writes block new writes until all owner pages have been reconciled; writes are never
automatically replayed. No private handles are put into URLs or localStorage by UI.

## Verification

- New list application8, API9, PostgreSQL3 assertions passed; PG2/3 invocations used.
- New bridge14 and existing browser-account6 passed.
- Existing booking application6 and routes6 passed.
- New booking client6 and view3; existing privacy client9 passed.
- Real Chrome account regression2 passed after behavioral RED2. An earlier fixture
  routing failure was corrected before reproduction; browser concurrency3/3 budget
  consumed. Chrome was available locally; this test requires `google-chrome` on PATH.
- PostgreSQL journey2 passed: synthetic verified-proof boundary, actual grant/session
  transaction, protected catalogue materialization fixture, reserve, reload list,
  cancel, old read denial and fresh-login cancellation with reserve off. PG2/3 runs
  consumed; first failed collection due to root Fastify resolution. No provider call.
- Environment Node24.21.0/pnpm11.9.0/Compose passed; PostgreSQL17.5 isolated fixture.
- Application/DB builds, API/web/tests types, scoped lint, web build and whitespace
  passed. No full/multipath suite or exhausted historical file was repeated.

The first booking-client test invocation failed because its new module was absent;
that is collection failure, not behavioral RED. Do not describe it otherwise.

## Independent review and correction

Kepler accepted Task3 with two nonblocking coverage gaps (duplicate/reverse slot-time
ordering and exhaustive error/no-store assertions). Hooke accepted Task4 and found two
Important account defects. Both were reproduced and corrected in real Chrome:

1. Shared authority changes now invalidate the entire private account view, removing
   old-account consent controls before a recovered session can authorize actions.
2. Privacy's button snapshots exclude the booking-owned subtree, so independent
   asynchronous controllers cannot overwrite one another's disabled states.

Deferred minors: bfcache restoration requires account refresh; `/account/` currently
does not initialize booking despite rendering the account page; list coverage above.
Reviewer source inspection is not independent execution of every reported command.

## Release truth

This is local implementation evidence, not production acceptance. Production was not
changed and is last recorded at425e647. RC push/gate status is recorded separately.
The first normal pre-push refused publication: one older schema parity test still
pinned journal0039. The exact baseline was advanced to the already-approved0040
entry, preserving all assertions; focused regression went RED1/GREEN3. This is a
test-inventory correction, not a migration edit or check bypass.
Exact-SHA external Trust CI and Database Gate, real inventory and real-user Telegram
login remain unproven. The synthetic journey is not live identity/provider evidence.
Follow the [current activation section](../runbooks/client-booking-activation.md)
and preserve reads/cancel/expiry during rollback. The full commercial product is not
certified by this slice. Written consent/signing remains outside launch prerequisites.
