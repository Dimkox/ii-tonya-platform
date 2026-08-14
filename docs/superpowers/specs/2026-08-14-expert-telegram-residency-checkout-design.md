# ER-TG-003 Expert Telegram Residency Checkout Design

**Status:** approved for implementation  
**Date:** 2026-08-14  
**Owner:** Dmitry  
**Base:** `651b8bf63c32a1e2f0caf295fe0b28aad830c960`

## Objective

Complete the provider-neutral `xr1` residency checkout callback without widening the
existing `ct2` or `cv1` namespaces. A quote may render an `Оплатить` button only when
Telegram referral mutations, checkout readiness, and the complete checkout capability
are all explicitly composed. Otherwise the quote remains read-only.

## Selected approach

Extend migration 0025 through an additive 0026 compatibility migration. The callback
row becomes a durable state machine: `issued -> processing -> ready | unavailable |
unknown`. The server looks up bound claims, verifies the `xr1` MAC, freshly resolves
the Telegram principal, and atomically enters `processing`. Only that winner calls
`ExpertResidencyService.checkout(principal, tariffVersionId, tokenHash)`. Terminal
replays return the bounded stored outcome and never call checkout again.

If execution stops while a row is `processing`, recovery may re-enter the application
service only with the same server-derived token hash. The existing residency command
and provider boundary own that idempotency. Telegram code never constructs or calls a
provider request. A processing recovery is therefore distinguishable from a new
checkout and must be covered by a test proving the unchanged idempotency key. If the
application service cannot safely resolve the idempotent command, the durable outcome
remains `unknown`; the Telegram layer must not invent a second payment identity.

Rejected alternatives:

- A callback acknowledgement without a checkout URL leaves the expert unable to pay.
- Inbox-only deduplication loses the mutation outcome after a crash and cannot safely
  distinguish provider mutation from message delivery.
- Embedding tariff, amount, URL, or payment ID into callback data exceeds the intended
  opaque-token boundary and would make client data authoritative.

## Stable requirements

- **ER-TG-003-R1 — Independent readiness.** Checkout remains default-off. A quote
  includes `Оплатить` only when `checkoutReadiness=true` and the full checkout
  capability is present. Enabled readiness with incomplete dependencies fails startup.
- **ER-TG-003-R2 — Authoritative issuance.** The button carries only a bounded `xr1`
  token issued for the freshly resolved expert, Telegram identity, server tariff UUID,
  action, expiry, and server idempotency key. It carries no amount, URL, or payment ID.
- **ER-TG-003-R3 — Fresh authentication.** Every callback freshly resolves user and
  expert ownership, validates the immutable Telegram binding, verifies the MAC, and
  atomically consumes or resumes the matching non-expired state. Foreign, inactive,
  expired, malformed, and mismatched callbacks reveal no stored outcome or URL.
- **ER-TG-003-R4 — Single authoritative mutation.** The mutation boundary calls only
  `ExpertResidencyService.checkout` with the authenticated principal, stored tariff
  UUID, and token hash as the idempotency key. Telegram code imports no payment
  provider and accepts no financial or provider facts from Telegram.
- **ER-TG-003-R5 — Durable replay.** Terminal callback replay never calls checkout.
  It returns only the stored bounded status and, for an authorized non-expired `ready`
  claim, the stored checkout URL. Processing recovery uses only the same token-hash
  idempotency; it cannot mint a new command or payment identity.
- **ER-TG-003-R6 — Separate delivery.** Checkout mutation completion, checkout-link
  delivery, callback acknowledgement, and webhook inbox claims use separate stable
  idempotency identities. Unknown delivery may retry the stored result but must never
  authorize another checkout mutation. Callback acknowledgement is best effort.
- **ER-TG-003-R7 — Sensitive URL handling.** A stored URL must be bounded to 2,048
  characters, use HTTPS, never enter logs or telemetry, and remain visible only to the
  currently authorized bound principal before callback expiry. Retention follows the
  callback expiry/cleanup lifecycle.
- **ER-TG-003-R8 — Isolation.** `xr1` remains separate from `ct2` and `cv1`; no YooKassa
  or other provider import, credential, activation, production deployment, or GitHub
  Actions workflow is introduced.

## Components and data flow

1. `/residency <UUID>` obtains the authoritative quote.
2. When readiness is complete, the processor issues an `xr1` token and supplies only
   that token to the Telegram quote view; the adapter renders the inline button.
3. The webhook validates the update envelope and fresh principal before claiming the
   update and delegating `xr1` to the ingress.
4. The callback capability verifies server state and MAC, atomically enters processing,
   and calls the application checkout service with token-hash idempotency.
5. It records `ready`, `unavailable`, or `unknown` before any Telegram send.
6. The route sends the stored authoritative URL with a delivery-only idempotency key,
   then acknowledges the callback separately. Delivery ambiguity releases the inbox
   claim for a replay that reads stored state rather than recreating checkout.

## Error and recovery behavior

- Disabled or incomplete readiness: no button; explicit enabled-incomplete composition
  fails closed.
- Invalid, expired, foreign, inactive, or malformed callback: generic unavailable
  acknowledgement with no URL and no checkout call.
- Checkout returns forbidden, disabled, expired, or no validated HTTPS URL: persist
  `unavailable`; do not send a link.
- Checkout throws or its outcome cannot be classified: persist `unknown` where possible;
  return a retry-safe unavailable result without exposing the fault.
- Checkout-link delivery is `not_applied` or `unknown_outcome`: fail/release the inbox
  claim and return sanitized 503. A retry reuses stored mutation state and the same
  delivery idempotency key.
- Crash after `processing`: recovery can use only the same service idempotency key. No
  client field or freshly generated key may enter that recovery.

## Verification

- Processor/adapter tests prove the button is absent by default and contains only a
  valid `xr1` token when readiness is complete.
- Factory/app/server tests prove enabled-incomplete composition fails closed.
- Callback service tests prove fresh binding, exact service arguments, terminal replay,
  processing recovery with unchanged idempotency, and bounded outcomes.
- Webhook tests prove mutation/delivery/ack separation and retry-safe unknown delivery.
- Real PostgreSQL tests prove one processing winner, terminal replay, expiry/foreign
  denial, URL constraints, and state transitions against migration 0026.
- Schema parity, scope guards, typecheck, lint, and one final focused Claw run are
  required. There are no repeats, image builds, prunes, production actions, or Actions.

## Release boundary

This increment makes a provider-neutral capability reachable only when injected and
explicitly enabled. It does not compose a live bot token, payment provider, or production
deployment. Independent review must clear every Critical and Important finding before
push or merge.
