# Expert browser campaign implementation evidence

Spec: `docs/superpowers/implementation-artifacts/spec-expert-browser-campaign.md`.
Baseline: `eb381c35aa6f8fdf599fff884e2e63c018657e70`.
Spec context list is empty. Environment preflight passed: Node 24.21.0,
pnpm 11.9.0, PowerShell 7.6.6. No dependency installation.

## Implementation plan

1. Add API behavior tests using actual Fastify routes and the real campaign
   service with controlled repository/provider ports. Cover current session and
   owner authorization, strict bounded requests, CSRF/raw headers, absent/legacy
   capability, provider absence before writes, and ordinary buildApp forwarding.
2. Add rendered Chrome tests using actual account binding and browser clients,
   with controlled HTTP responses. Cover saved server amounts, one/three months,
   stable checkout retry, duplicate clicks, unsafe responses, and logout races.
3. Implement routes in expert-browser-session.ts and targeted app.ts forwarding.
   Add separate campaign client/view modules; integrate account lifecycle fencing.
4. Run each new file RED once and GREEN once. Run affected types, scoped lint,
   formatting and whitespace checks. Leave coordinator run 3 for independent review.

## Execution ledger

- API RED1: `pnpm exec vitest run apps/api/src/expert-browser-campaign.test.ts`, session 27975, exit 1; 20 failed/2 passed, 22 total. Missing routes returned 404. The two malformed-body cases already rejected by existing parsing are not behavioral RED. 1/3 used.
- Browser RED1: `pnpm exec vitest run apps/web/src/expert-campaign-browser.test.ts`, session 25646, exit 1; all 8 failed with `campaign_controls_missing` in actual Chrome. 1/3 used.
- Tests typecheck: `pnpm exec tsc --noEmit -p tsconfig.tests.json`, session 99594, exit 0 before implementation.

## Evidence boundaries

API GREEN2 started after preliminary coordinator review: now 29 cases, adding
four duplicate raw header tests over actual loopback HTTP (injection normalizes
duplicates) and lookup-failure assertions across all three campaign routes.
API GREEN2 session 57335 exited 1: 28/29 passed. The remaining test reached
successful tariff/quote/checkout responses and exact command assertions, then
incorrectly asserted spy calls on the lookup object instead of its method.
Corrected to `lookup.findByTokenHash`; correction UNRUN. API allocation 2/3;
coordinator final3 remains reserved. Browser remains 1/3; 11 cases prepared.

Browser GREEN2: `pnpm exec vitest run apps/web/src/expert-campaign-browser.test.ts`,
session 62098 exited 0: 11/11 passed in actual Chrome, 2.51s total. Browser
allocation now 2/3; final3 reserved. Covers exact quote/checkout payloads and
stable retry, concurrent click suppression, one/three-month selection, literal
tariff rendering, authoritative server amounts/discounts/expiry, unavailable
payments, rejected/expired quotes, malformed tariff/quote, unsafe checkout URL,
session expiry and logout during pending quote/checkout.

Static checks before GREEN2: initial API/web/tests typechecks found optional
`campaign: undefined` typing; corrected by explicitly permitting undefined on
the optional dependency. API typecheck session 38682, web 17531 and tests 74989
then passed, exit 0. No build output was changed or concurrent build started.

Controlled ports/browser fixtures are not PostgreSQL, provider or live evidence.
No old tests, full suite, provider calls, remote operations, flags, commits or
deployment are authorized by this increment. Independent review and coordinator
verification remain separate gates.

## Implemented changes

- Added cookie-authenticated tariffs, quotes and checkouts under
  `/v1/expert/browser/residency`, inside existing security hooks. Fresh lookup
  uses the existing principal resolver, including expiry/revocation checks;
  the campaign service retains owner authorization and all financial authority.
- Added strict bounded Buffer-to-JSON handling with duplicate-key rejection,
  unknown-authority-field rejection and non-leaking service error responses.
- Ordinary `buildApp` forwards only the campaign service and only with both
  expert session and residency billing flags enabled. Absent/legacy capability
  returns 503. No provider means the existing service creates no order.
- Added independent browser campaign transport and rendering modules. Transport
  checks response fields, integer minor-unit strings, a 64 KiB body bound, a
  10-second deadline and absolute credential-free HTTPS checkout URLs. All
  server names/text are rendered with `textContent`; money formatting uses BigInt.
- Account probe/login/logout lifecycle disposes campaign state and aborts/fences
  late responses. Checkout retains the saved quote ID and command key for
  uncertain retries; redirects are user-initiated links, never payment evidence.

## Handoff limits

Historical first handoff: independent final review and coordinator final3 were
pending; the corrected API spy assertion had not been rerun. Superseded by the
coordinator API result and web recovery section below. Old session/financial/provider gates
remain untouched. No PostgreSQL integration was run here; buildApp tests use
controlled service ports, and Chrome uses controlled HTTP responses with real
production account/client/view modules. This is not a composed browser-to-DB or
live-provider test. No workspace build or release evidence is claimed.

Receipt capture/admission, actual YooKassa API composition, Selarti and other
full-product release gates remain outside this increment. No commit, push,
remote operation, provider call, production flag or dependency change occurred.
Concurrent coordinator edits to AGENT-STATUS.md and production build evidence
were observed and left untouched.

## Initial stable review input (before recovery corrections)

Final API typecheck session 41079 and web typecheck session 35987 passed (exit 0).
Scoped ESLint, Prettier check and `git diff --check` session 34187 passed (exit 0).
Final tests typecheck session 51505 passed (exit 0). No active exec sessions remain.
Stable handoff is ready for Euclid review. Both new test files remain at 2/3;
coordinator owns final3 after review. The API assertion correction remains UNRUN.

Source SHA-256 fingerprints for Euclid (no commit created):

```text
ffaf288f0b8c4f1f648c96d1b7e61abd9ae11f89ecf294db4b93ec2118c05271  apps/api/src/routes/expert-browser-session.ts
a58daeb50a2948e525986b1287c391331eb73528383d48902c7901bf649677dd  apps/api/src/app.ts
b2fd0d4fc57347a454a6ed0134a03e7a5eab709b753540bac5e793c8f4a06545  apps/api/src/expert-browser-campaign.test.ts
92c1559c2361680bf859632f0442a736fe4146ca84eafe389b2f2d5e340447b0  apps/web/src/expert-account-view.ts
6bcb7f280a321a62dec20d519030ced447ec16456f72c0bcb39f053e60f5d739  apps/web/src/expert-campaign-client.ts
4bda50b2444a5ffdd4277d34a96e902dac20dd8830f2bbb9557d8ffcf8c3c166  apps/web/src/expert-campaign-view.ts
51a293590a57608b72441ce91baa929cd543d8cd0bc48e5aaa81185f949b866e  apps/web/src/expert-campaign-browser.test.ts
```

## Euclid recovery corrections and coordinator API final3

### Coordinator final browser verification

Euclid accepted both recovery corrections at source level, with the three
corrected fingerprints below. Coordinator checked those fingerprints unchanged
and ran `pnpm exec vitest run apps/web/src/expert-campaign-browser.test.ts` once:
session22062, start23:12:21, exit0,16/16 passed, duration3.43s. Browser allocation
is now **3/3 EXHAUSTED**, as is API. This verifies the controlled Chrome scenarios,
not live payment, PostgreSQL integration, historical auth gates or deployment.

Coordinator reports preflight session 8554 passed and API final3 session 63583
passed 29/29, exit 0, start 23:10:48, duration 3.74s. API source/test hashes match
the initial review input above. API is now **3/3 EXHAUSTED**. No API, app.ts or
API-test edits or Vitest runs were performed in this correction round.

Euclid identified two P2 browser recovery defects, verified against source:

1. Local quote expiry blocked replay of a possibly committed checkout after a
   lost response. `expert-campaign-view.ts` now initializes `attempted = false`,
   resets it only with the saved quote/command, and sets it immediately before
   the first checkout submission. The expiry guard changed exactly from
   `Date.parse(quote.expiresAt) <= Date.now()` to
   `!attempted && Date.parse(quote.expiresAt) <= Date.now()`. Subsequent attempts
   use the same quote ID/key and let the server decide replay validity.
2. Every account probe disposed unresolved checkout state. In
   `expert-account-view.ts`, probe-start `clearCampaign()` is replaced with
   `campaign.hidden = true` and `campaign.inert = true`. After current-probe
   success, the binding is retained only when authenticated user/expert IDs,
   CSRF binding and session expiry match. Otherwise it is disposed and, for a
   new authenticated session, rebound. Logout, failed probes and invalidation
   still dispose/fence state. A separate `campaignEpoch` advances on disposal;
   authorization callbacks use it instead of the account probe epoch, so a
   same-session probe cannot silence a subsequent campaign 401/403.

Five Chrome regression scenarios were added **before** the production fixes:

- `retry-after-expiry`: first checkout response lost, browser clock advances
  beyond quote expiry, replay sends the exact same command without repricing.
- `pending-same-session-probe`: committed/unanswered checkout, same-session
  probe, response loss, exact command replay without replacing the binding.
- `pending-probe-unauthorized`: probe denies authentication while checkout is
  pending; a later successful checkout response cannot restore private state.
- `pending-probe-identity-change`: changed owner identity disposes the old
  binding; its late checkout response cannot restore its quote/payment link.
- `same-session-probe-then401`: a retained checkout returns unauthorized after
  successful same-session probing; its authorization callback still clears UI.

All five regressions and the changed browser implementation are **UNRUN** by
explicit coordinator instruction. Browser file now contains 16 scenarios but
the last executed result remains 11/11 from GREEN2. Browser stays **2/3**, with
final3 reserved for the coordinator after rereview. This is source correction
and static evidence, not a new browser PASS claim.

Correction-round static checks: web typecheck session 84444, tests typecheck
56494 and scoped ESLint 36237 all passed, exit 0. Source edits are stable for
Euclid rereview; no behavior tests were executed in this correction round.

Changed review input SHA-256 (other source hashes above are unchanged):

```text
884bbe5a207e767c9bec882dbf904d5d26ae5f98633655726c7c324cc40b8508  apps/web/src/expert-account-view.ts
f781e110955a8606db6d337085842b5b588594bd83c3e0e5c3095f73540a1221  apps/web/src/expert-campaign-view.ts
3662bdfad7872e8e9ee50612a3305971d1cc47d15de16932fce3a00bdfa3bb76  apps/web/src/expert-campaign-browser.test.ts
```
