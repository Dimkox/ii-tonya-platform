---
title: Phase2 slot integrity, private client reads and inactive connectors
status: done
baseline_commit: 552b40dd3aceb7b00479ff9d7bff7ef11ee6281b
context:
  - docs/superpowers/implementation-artifacts/spec-phase1-through-phase2-execution.md
  - packages/db/src/repositories/booking-repository.ts
  - packages/application/src/client-booking-service.ts
  - packages/application/src/client-navigation-gateway.ts
  - packages/db/src/repositories/client-ingress-replay-repository.ts
  - packages/db/src/schema/client-paid-orders.ts
  - packages/db/src/repositories/client-paid-order-repository.ts
---

## Intent and boundaries

Complete P2.1–P2.3 using the existing platform. No new client web cabinet, LLM
financial authority, dashboard, provider activation or independent locking/price
engine. Current task-wide verification count override applies; checks remain
focused and justified. P0/live merchant, custody, content and release gates remain
separate from local acceptance.

## P2.1 existing slot backend

Reuse reserveProtectedChoice→reserveInTransaction, sorted advisory/row locks,
SERIALIZABLE bounded retry, capacity/overlap constraints, opaque owner handles,
receipts/audit/outbox and existing expiry work. One concrete gap is in scope:
DB time is captured before later choice/request/user and slot/service/expert locks.
A pure later row-lock wait can cross choice TTL/lead/hold boundaries without an
SSI write conflict. Re-read PostgreSQL time after the blocking locks and revalidate
all time-dependent decisions immediately before reservation effects. No stale
captured time, host clock fallback, new hold table or balance mutation.

A new focused PG regression must hold a later choice/request row without mutation,
let real TTL expire, release, and prove no reservation/receipt/ledger/outbox effect.
Retain existing concurrency, foreign-owner, duplicate and expiry behavior. Extract
only the existing owned-booking read query if needed for P2.2 transaction reuse.

## P2.2 deterministic private assistant data

Add `/coupons_balance`, `/orders` (bounded opaque pagination) and `/reservations`
(using existing owned active-booking handles/query). Compose before public navigation
or hybrid routing; recognized commands never enter an LLM or debit message units.
No account UUID, payment mode, balance or ownership is accepted from message text.
Unknown/unlinked users receive a bounded unavailable/registration response; no
account merge, registration grant or fabricated consent.

Derive one current active owner from the configured receiving assistant bot and
strict human private chat identity. Reuse original approved client_messaging consent
and subject barrier; reject ambiguous/revoked/erased/wrong-bot/forwarded/business
contexts. Use the existing numeric-bot/update receipt namespace. Receipt and
protected data projection share a DB transaction so failed reads can retry without
silently becoming a terminal navigation reply; old receipts and duplicates cannot
reprocess data. Financial/order/booking sources remain SELECT-only; receipt is the
only new write. Actual authenticated Telegram ingress must be wired, default-off
unless complete configuration/capability exists, including a non-placeholder
32–256 character receiving webhook secret; manual configurations and lifecycle
preflight use the same validation. Existing public navigation remains.

`client_coupon_grants.amount_minor` is kopecks, joined to its canonical settlement
and order owner. Message `package_balances` units and expert referral money are
separate products and must never be relabelled or summed as coupons. No coupon
spend ledger exists: report unexpired issued coupon face value, not invented cash
or redemption guarantees. Expose `coupons_balance` as a decimal string explicitly denominated in kopecks.
Preserve decimal strings/BigInt and uncapped totals even
when detail pages are bounded. Filter actual `client_paid_orders.mode` using an
explicit reviewed SERVER test/live mode, independently of a user's command.

Order history returns only bounded own order terms/state/dates and opaque handles;
no raw provider identifiers/contact details. Foreign/malformed cursors fail closed.
Reservation reads reuse existing owner-scoped backend/pagination, not duplicate
hold logic. Replies are bounded plain private text with protected content, no raw
input/error/secret logging. No new browser UI is created.

## P2.3 inactive VK/MAX modules

Pure typed ports, fixed official contract metadata, concrete pure text-send request
builders and strict response parsers, plus always-disabled adapters. Builders use
fixed origins, canonical bounded int64 strings, exact token placement and text limits;
parsers produce only untrusted contract acknowledgements, never delivery, identity
or financial authority. Synthetic tests cover malformed envelopes and precision
loss. VK single-peer integer response is supported; array variants remain typed
unsupported. MAX requires documented message/body/recipient fields while optional
recipient IDs are never fabricated.
Disabled calls reject with bounded errors before inspecting commands, tokens or
webhook bodies and perform zero I/O. No SDK/dependency install, credentials,
fetch implementation, live activation flag or unverified identity conversion.
Explicit activation requests fail closed; future enablement needs a separate design.

Official primary contracts verified2026-10-23 by the coordinator:

- MAX POST `/messages`: fixed `https://platform-api2.max.ru`, token in Authorization
  header, exactly one int64 user_id/chat_id target, JSON text≤4000, response message
  envelope; no query token or old host. Source:
  https://dev.max.ru/docs-api/methods/POST/messages
- VK community `messages.send`: fixed `https://api.vk.com/method`, API5.199,
  URL-encoded POST body access_token/v, group token, peer_id and random_id, text≤9000,
  response/error envelope. Official sources:
  https://raw.githubusercontent.com/VKCOM/vk-php-sdk/master/src/VK/Client/VKApiClient.php
  https://raw.githubusercontent.com/VKCOM/vk-php-sdk/master/src/VK/Client/VKApiRequest.php
  https://raw.githubusercontent.com/VKCOM/vk-api-schema/master/messages/methods.json
  https://raw.githubusercontent.com/VKCOM/vk-api-schema/master/README.md

Keep TLS verification on; do not install certificates or change trust stores from
provider docs. No provider endpoint is called in this task.

## Ownership and verification

- Slot owner: booking-repository.ts narrow timing/query reuse changes, new focused
  late-row-lock integration regression and relevant new non-PG helper tests only.
- Client-read owner: new contracts/client-bot-account.ts, DB client-bot-account-read
  repository, application service, API composition and trusted existing client
  webhook interception/config. Sole relevant barrels, coordinated with slot owner
  for the existing booking query helper. Lead owns app/server final wiring.
- Connector owner: separate integrations/vk-community and integrations/max-business
  ports/disabled adapters/new unit tests, official source evidence and integrations
  barrel only. No payment/financial imports.
- Lead: spec/plan/status/evidence, actual API wiring, integrated client read acceptance,
  independent review, exact necessary guard updates, final checkpoint.

TDD first. New tests prove later-lock TTL denial, current owner/consent/mode/cursor
isolation, exact uncapped coupon sum, no expert/message-unit crossover, replay and
no data mutations, actual private bot routing, disabled connector zero-input-read/
zero-I/O. Heavy fixture setup belongs in bounded hooks. No new migration/state
reconstruction is expected unless an independently reviewed concrete need appears.
Relevant builds/types/lint/format/diff and focused independent slot/owner/connector
review precede the local Phase2 checkpoint. Root may own one final pre-push gate;
no push or release acceptance is implied.

## Local acceptance

Slot regression RED2/2→GREEN2/2; first client integrated PG8/8 PASS. Focused
source checks, normal relevant builds/types, lint/format/diff and independent
slot/client/connector/wiring reviews passed. See
`docs/test-evidence/phase2-preparation-2026-10-23.md`. Coordinator final branch gate
remains separate; all external/live gates above remain unchanged.
