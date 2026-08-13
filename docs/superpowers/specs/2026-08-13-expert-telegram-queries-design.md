# Expert Telegram Queries Design

**Status:** approved approach; written-spec review pending  
**Date:** 2026-08-13  
**Owner:** Dmitry  
**Implementation branch:** `codex/expert-referral-api-telegram`

## Objective

Complete the deferred expert-bot query surface with `/schedule`, `/client`, and
`/stats` while preserving PostgreSQL authority, expert ownership, consent-based
data minimization, webhook replay safety, and production-default-off behavior.

## Selected approach

Use private-chat Telegram commands backed by application query services. `/client`
never accepts a name or client identifier. It returns buttons for the requesting
expert's active reservations; each button contains an opaque, signed, single-use,
short-lived callback. `/stats` returns only server-computed aggregates for a fixed
30-day window. The Telegram adapter renders and transports results but does not
authorize reads or calculate business facts.

Rejected alternatives:

- `/client <reservation-id>`: simpler, but exposes internal identifiers and invites
  cross-tenant probing.
- Telegram Mini App: richer UX, but adds a separate web application, session model,
  and deployment boundary outside this increment.

## Stable requirements

### EXP-BOT-001 — Command ingress

The webhook accepts `/schedule`, `/client`, and `/stats` only from a Telegram
private chat where `message.from.id` equals `message.chat.id`. It validates the
webhook secret, numeric identity, UTF-8/schema/size limits, expert eligibility,
rate limit, and `update_id` inbox claim before processing. Unknown commands receive
a bounded help response. Duplicate updates produce no duplicate query or message.

### EXP-BOT-002 — Fail-closed feature composition

`EXPERT_TELEGRAM_QUERIES_ENABLED` defaults to `false`. Enabling it without the
complete command/query capability fails application composition. Disabling it
leaves existing booking callbacks isolated and rejects query commands without
calling query repositories. This flag does not enable the live Telegram provider;
provider activation remains a separate approved release action.

### EXP-BOT-003 — Schedule query

`/schedule` uses the existing authorized booking query for the current expert and
the configured display timezone. The initial bounded window is from the
authoritative clock through the next seven days. Only active `reserved` and
`booked` appointments are returned. Meeting URLs appear only for booked,
expert-owned appointments.

### EXP-BOT-004 — Client selection

`/client` lists at most 20 active reservations owned by the requesting expert,
ordered by start time and stable reservation order. The list contains time and a
non-identifying label. It contains no client UUID, contact, package, coupon,
payment, or conversation history. Each selection uses an opaque callback no longer
than 64 bytes, bound to Telegram identity, expert, reservation, operation, current
reservation version, and expiry of at most 10 minutes.

### EXP-BOT-005 — Minimal client view

Consuming a valid client-view callback returns only:

- client display name or the fallback `Клиент`;
- appointment time in the configured timezone;
- service display name;
- explicitly consented expert preparation note, when current consent is granted.

The server rechecks expert eligibility, Telegram binding, reservation ownership,
active reservation status, version, and callback expiry in one authoritative
operation. The callback is single-use. Failed or cross-wired checks reveal no
existence information and return a generic unavailable response.

### EXP-BOT-006 — Expert statistics

`/stats` returns aggregates for the requesting expert only:

- upcoming active appointments;
- completed appointments in the preceding 30 days;
- cancellations in the preceding 30 days;
- no-shows in the preceding 30 days.

The response contains no client identifiers, client text, financial facts, data
for other experts, or arbitrary date-range input. Counts are non-negative safe
integers produced by PostgreSQL and merely rendered by the Telegram adapter.

### EXP-BOT-007 — Sensitive-read audit

Every successful minimal client read appends an immutable audit event containing
the actor expert, reservation object, operation, correlation ID, and policy
version, but no client text or contact data. Denied reads produce a security audit
fact without exposing the probed object in Telegram. Aggregate `/stats` reads emit
only operational telemetry without client-level facts.

### EXP-BOT-008 — Transport and leakage controls

Telegram request logging remains disabled. URLs and bot tokens are redacted.
Application errors, repository faults, malformed callbacks, and transport failures
produce bounded, sanitized messages. No raw update, callback claims, note text,
authorization header, token, client contact, or query result is logged.

## Components and boundaries

1. **Telegram webhook parser** validates private command messages and delegates an
   authenticated update to the command processor after inbox claim.
2. **Expert command processor** resolves the expert binding, selects the command,
   invokes application query services, and supplies server facts to the view port.
3. **Booking query service/repository** remains the authorization boundary for
   schedule, active reservation selection, minimal client view, and aggregates.
4. **Callback issuer/store** extends the existing opaque callback mechanism with a
   separate `view_client` operation. It cannot invoke booking transitions.
5. **Telegram adapter** renders bounded text/buttons and performs only Bot API
   transport.

No LLM, Make workflow, Google Sheet, or Telegram payload becomes authoritative.

## Data flow

### Command

`Telegram webhook -> secret/rate/schema/private-chat checks -> inbox claim -> expert
binding -> application query -> PostgreSQL ownership/consent query -> Telegram view
render -> inbox complete`

If processing or transport fails, the inbox claim is failed so Telegram retry can
reprocess it. Unknown transport outcome follows the existing reconciliation
contract and is not treated as successful delivery.

### Client callback

`callback -> secret/rate/schema checks -> inbox claim -> callback authentication ->
atomic consume + ownership/status/version recheck + audit -> minimal view -> Telegram
render -> inbox complete`

The client-view callback is separate from `confirm` and `cancel`; it cannot mutate
reservation state.

## Error behavior

- Invalid webhook secret: `401`, or `429` after the unauthenticated limit.
- Invalid identity/private-chat shape: sanitized `403` before inbox claim.
- Disabled capability: update accepted without a query and a bounded unavailable
  response when the provider capability is explicitly composed; production
  composition remains default-off.
- Invalid, expired, consumed, foreign, stale, or inactive client callback: the same
  generic unavailable response.
- Repository/data-integrity fault: fail closed, fail the inbox claim, emit redacted
  structured telemetry, and return `5xx` for retry.
- Telegram `429` or transport ambiguity: preserve existing retry/reconciliation
  semantics; never duplicate an authoritative mutation because these commands are
  read-only.

## Verification design

All executable tests run on Claw (`1 CPU`, `1 GiB`) with one focused RED and one
focused GREEN per behavior group. No `repeat x20`; repeat is unnecessary for this
read-only increment unless concurrency logic changes, and then the maximum is 3.

Required evidence:

- application tests for ownership, consent, stats window, safe integer checks, and
  callback separation;
- PostgreSQL integration tests for cross-expert denial, revoked consent, stale
  version, single-use callback, exact aggregate boundaries, and immutable audit;
- webhook tests for private-chat identity, commands, deduplication, rate limits,
  feature isolation, malformed/oversized input, and sanitized failures;
- adapter tests for bounded rendering, inline keyboard size, absence of forbidden
  fields, logging suppression, and Telegram failure semantics;
- recursive production-isolation guard showing no query capability when the flag is
  disabled;
- targeted build/typecheck/lint/format and independent Critical/Important review.

## Acceptance criteria

The increment is accepted as code-complete when EXP-BOT-001 through EXP-BOT-008
map to committed tests and implementation, focused Claw RED/GREEN evidence is
recorded, the independent review has no unresolved Critical/Important findings,
README/handoff/traceability are current, and a Draft PR is pushed. Live Telegram
activation, real bot credentials, provider staging smoke, merge, and production
deployment remain separate human approval gates.

