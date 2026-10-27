---
title: Expert browser saved-quote purchase journey
type: feature
created: 2026-10-12
status: in-progress
baseline_commit: eb381c35aa6f8fdf599fff884e2e63c018657e70
context: []
---

## Intent and delegated design

Owner requests the actual commercial product on ii-tonya.ru, with unavailable
paid external APIs disclosed rather than blocking all review. The expert account
currently has only login/logout. Implement its real tariff selection, one/three
month saved quote and checkout interaction through existing campaign service.
This is not a demo calculator and must not fabricate paid status. Existing
technical-choice delegation applies; no new commercial rules or human acceptance.

## Boundaries

Preserve separate expert cookie authentication and session/identity ownership.
Browser never receives bearer tokens and never supplies authoritative userId,
expertId, price or discount. Existing server-calculated quote is authoritative.
Checkout without provider returns unavailable before order/reservation creation.
Do not label missing implementation, authentication failure or unknown provider
failure as unpaid subscription. Do not change financial algorithms or activate
production flags. Do not add a consent/signature entrance requirement.

## Code map and ownership

- apps/api/src/routes/expert-browser-session.ts: own additive campaign routes
  inside existing encapsulated security hooks; preserve session handlers/CSRF.
  New optional campaign dependency must have kind campaign, never legacy pricing.
- apps/api/src/app.ts: targeted dependency forwarding only, including normal
  buildApp composition. Preserve provider and auth activation checks.
- apps/web/src/expert-account-client.ts and expert-account-view.ts: targeted
  campaign integration; preserve logout/probe epoch protection.
- New apps/web/src/expert-campaign-client.ts and expert-campaign-view.ts if useful
  for small units; avoid growing session modules into unrelated responsibilities.
- packages/application/src/expert-campaign-service.ts and contracts quote schemas:
  read-only reuse listActiveTariffs, quote, checkout. Missing checkout provider is
  already rejected before createCheckoutOrder. Never replace with placeholder.
- apps/api/src/expert-campaign-composition.ts and server.ts: read-only ordinary
  composition already provides campaign service when billing/session enabled.
- Own new apps/api/src/expert-browser-campaign.test.ts,
  apps/web/src/expert-campaign-browser.test.ts and own evidence file
  docs/test-evidence/expert-browser-campaign-2026-10-12.md.

No other files without coordinator agreement. No parallel writers, nested agents,
remote operations, secrets, provider calls, commit/push or dependency installation.
Do not alter existing exhausted tests to hide failures or reset run allocation.

## Execution and acceptance

1. Add GET /v1/expert/browser/residency/tariffs and POST quotes/checkouts under the
   same prefix. Resolve principal from current expert cookie via existing lookup
   on EVERY request; authenticate owner through existing campaign service. Reuse
   current no-store, rate limit, Origin, raw-header and CSRF protections. Bounded
   JSON parser must work with existing raw Buffer parser and strict contract
   validation. Unknown body authority fields reject, never silently strip.
2. Forward real campaign dependency in ordinary buildApp; absent/legacy capability
   yields explicit503 with no financial writes. Do not enable billing implicitly.
3. Render server tariff names safely with textContent, distinguish base monthly
   price from final saved quote. Let expert select one or three months. Display
   monthly/total quote, expiry and server discounts without browser recalculation.
   Use integer minor units, not floating-point money arithmetic.
4. Checkout submits saved quoteId and stable idempotency key. Retain the same key
   for uncertain retry; prevent duplicate concurrent clicks. No repricing on
   retry. Expired/rejected quote needs an explicit new calculation.
5. Validate server response shape and external checkout HTTPS URL before showing
   a user-initiated link. Never treat return navigation as payment confirmation.
   Only say paid if authoritative response actually establishes it.
6. Clear quote/tariff/user state on logout/session change; late responses must not
   repopulate or redirect after logout. Provide bounded loading/error/retry UI,
   keyboard-labelled controls and live status. Disabled payment stays truthful.

Given an authenticated expert, when tariffs/quote are requested, then the real
service receives only that principal and validated inputs. Given expired session,
forged origin/CSRF, duplicate auth headers or injected IDs/prices, then service
mutations do not run. Given provider absence, checkout creates no order. Given
logout during quote/checkout, stale results cannot restore private UI. Given a
valid quote, checkout uses its exact ID and stable command key. Given malformed
or unsafe responses, the browser neither renders HTML injection nor follows URLs.

## Verification

Read repository instructions and TDD/writing-good-tests instructions. Preflight
before edits. For EACH of the two NEW files: author RED1/GREEN2, coordinator3 after
independent review. Record executions immediately, including collection failures.
Use actual Fastify browser routes with service and controlled ports; use existing
browser-test approach for actual rendered interaction, no external calls. No old
test/full/multi-path runs. New tests are for these new routes/UI, not substitutes
for outstanding expert-session PG/browser or financial87 gates.
Run affected types, scoped lint/format/diff; coordinate builds before typechecks.
Evidence must distinguish API/browser fixtures from full DB/provider/live proof.
Keep same implementer for review fixes. Report stable handoff and exact results.

## Remaining full-product limits

Receipt capture/admission, real YooKassa API composition, Selarti bridge and other
full-goal items remain necessary. This increment connects the real purchase UI;
it does not declare eb381c35 or the next candidate a completed commercial release.
