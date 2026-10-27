---
title: 'Planerka REST API client'
type: 'feature'
created: '2026-10-12'
status: 'in-review'
baseline_commit: 'a1d8f9353414ff7a1bc1df18a1c113f20b123849'
review_loop_iteration: 0
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Tonya has a disabled Planerka port but no working HTTP client.
The owner explicitly requests writing the connection code while subscription
payment and production activation remain deferred.

**Approach:** Implement a typed server-side REST v2 client against the official
provider contract, with deterministic offline tests. This is the transport
increment of the wider expert-approval workflow, not its completed rollout.

## Boundaries & Constraints

**Always:** Validate commands and provider responses. Keep credentials and
attendee data out of diagnostics. Preserve uncertain mutation outcomes. Use
operation-specific documented API versions. Run bounded focused verification.

**Ask First:** Real booking probes, provider account changes or production
activation. Those actions can create events and send notifications.

**Never:** Fake a successful reserve/confirm operation, retry creation after
an uncertain send, activate payments, change production env, or hardcode a key.
Do not weaken the disabled runtime configuration to make tests pass.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Availability | Valid event type and bounded dates | Validated date-grouped slots | Reject malformed response |
| Creation | Valid attendee, type and start | Validated provider booking with UID | Never infer success |
| Lookup | Valid UID | Booking with matching identity | Typed missing result for 404 |
| Cancellation | Valid UID and optional reason | Matching cancelled booking | Repeated cancellation supported |
| Access denied | 401 or 403 | Sanitized access error | No automatic retry |
| Slot taken | Creation returns 409 | Definite conflict | Caller selects another slot |
| Rate limit | 429 | Rate-limit classification | No implicit request loop |
| Uncertain mutation | Timeout, connection failure, 5xx or malformed success | Unknown outcome | Reconcile before retry |
| Unsafe input | Invalid UID, dates, key or payload | Local validation failure | No HTTP request |
| Unsafe transport | Redirect, oversized or stalled body | Bounded failure | No credential forwarding |

</frozen-after-approval>

## Code Map

- `packages/integrations/src/planerka/planerka-port.ts`: legacy interface
  assumes provider reserve and confirm; do not implement false semantics.
  Its slot normalizer remains available for a later catalogue mapping layer.
- `packages/integrations/src/planerka/disabled-planerka-adapter.ts`: retain
  current disabled adapter and default behavior.
- `packages/integrations/src/yookassa/client.ts`: existing server client pattern;
  inspect for transport injection and safe error conventions, not provider rules.
- `packages/integrations/src/index.ts`: public exports for the new client/types.
- `packages/config/src/env.ts`: PLANERKA_ENABLED currently false-only; unchanged.
- `packages/db/src/repositories/booking-repository.ts`: currently emits client
  confirmation alongside provider confirmation; workflow composition is separate.
- `vitest.config.ts`: discovers package-local tests and source aliases.
- `packages/integrations/tsconfig.json`: excludes tests from package typecheck;
  run repository test typecheck separately.
- `docs/superpowers/specs/2026-10-12-planerka-live-design.md`: larger workflow
  context and activation boundaries, not a claim of implemented functionality.

Read-only provider references: https://help.planerka.app/api and
https://planerka.app/rest/v2/doc.json. Base URL is
https://planerka.app/rest/v2. The key found in the owner's source document
returned 401 for profile and event types; owner deferred paying the tariff.
Do not copy document credentials into fixtures or repository files.

## Tasks & Acceptance

**Execution:**
- [x] `packages/integrations/src/planerka/client.test.ts` — write and run
  failing offline tests for the matrix, request serialization and sanitization.
- [x] `packages/integrations/src/planerka/contracts.ts` — define validated
  request/response schemas from the referenced OpenAPI. Include profile,
  event types, slots, booking details, creation and cancellation contracts.
- [x] `packages/integrations/src/planerka/client.ts` — implement profile,
  event-type listing, slots, paginated booking listing, UID lookup, creation
  and cancellation. Inject fetch for offline transport tests; default to native
  fetch. Fixed trusted origin, redirect rejection, total timeout and bounded
  streaming response reads. Validate each returned page rather than fetching
  all pages implicitly. Validate returned identity on UID operations.
- [x] `packages/integrations/src/index.ts` — export the new client, errors and
  public types without replacing the disabled legacy adapter.
- [x] `docs/runbooks/planerka-api-client.md` — document server-only use,
  operation outcomes, deferred workflow wiring and activation checklist.
- [x] `AGENT-STATUS.md` — record actual tests, review status and remaining work.

**Acceptance Criteria:**
- Given the new exported client, when exercised through an injected transport,
  then supported operations use documented endpoints, versions and envelopes.
- Given an uncertain creation response, when the client returns, then callers
  can distinguish it from a definite rejection and no second POST was sent.
- Given the unchanged runtime configuration, when this increment is installed,
  then production booking and provider activation remain disabled.
- Given a successful local verification, when reporting delivery, then state
  explicitly that worker/database/client workflow wiring remains unfinished.

## Spec Change Log

## Design Notes

Provider-native create/cancel/read is a separate API surface. It must not claim
to satisfy unsupported reserve/confirm semantics. Persistent idempotency,
rate scheduling across workers, expert mappings and reconciliation belong to
the subsequent workflow integration. No in-memory lock is a substitute for
database operation ownership. A valid external booking is not automatically a
confirmed Tonya reservation; that requires the later transactional workflow.

## Verification

- `pnpm exec vitest run packages/integrations/src/planerka/client.test.ts`
  — observe RED then GREEN; at most three focused invocations.
- `pnpm --filter @ii-tonya/integrations typecheck` — no package type errors.
- `pnpm exec tsc --noEmit -p tsconfig.tests.json` — check test typing if this
  repository configuration exists; inspect the actual scripts before execution.
- Scoped ESLint and formatter checks on changed files, plus `git diff --check`.
- Independent review of response validation, uncertain outcomes and secret
  handling before claiming this increment complete. No exhausted account tests.

### Execution evidence — 2026-10-12

All three focused invocations consumed: initial missing-module collection failure
(not behavioral RED), then26/26 and final32/32 passing. Every matrix row has
executed passing offline coverage. Both typechecks, scoped lint/format and
whitespace checks passed. Four independent review findings were patched with
regression coverage: stream deadline starvation, attendee/host binding,
pagination consistency and timezone-aware slot grouping. Closure review accepted
three fixes but found premature pagination termination still possible. Added
request-skip-aware remaining-count validation and a regression case; this final
patch has NOT been executed because the three-invocation budget is exhausted.
One explicit additional focused invocation is required for final verification.
No live provider call, workflow wiring, activation or release evidence is claimed.

Owner-authorized extra invocation on2026-10-12 at13:16:34UTC passed32/32,
including the final pagination correction. This supersedes its unverified status
above. The one-run exception is consumed. Production remains unchanged.

### Final transport verification — 2026-10-12

Owner authorized two further invocations. Run5 at13:27:05UTC established behavioral
RED:8failures/58tests for duration binding, interval consistency, range endpoints,
UTC grouping, pagination bounds and record guest limits. Production patches then
passed package/test typechecks, lint and whitespace checks. Independent closure
by Huygens found no remaining concrete transport blockers. Run6 at13:28:57UTC
passed58/58. All granted invocations are consumed; no further repeat is authorized.

Final review also strengthened schema-valid identity mismatch, nonzero/final/empty
pagination, outgoing-size and uncertain-cancellation coverage. No undocumented
provider page-number formula or participant minimum was introduced. The initial
collection failure remains NOT behavioral RED; it is not reclassified retroactively.
Release gates remain separate: this is locally verified transport, not a complete
booking workflow or production acceptance. Status stays in-review until release
requirements are resolved; no hosted CI success is claimed.
