# Free-Client Hybrid Platform V2 Design

**Date:** 2026-08-28  
**Status:** Approved in chat for automatic implementation  
**Owner:** Dmitry  
**Base:** `afc9eebfad77a730454fe2cc783595ff01c3dec0`  
**Supersedes:** the commercial and channel-routing parts of
`2026-08-20-unified-client-expert-platform-design.md`

## 1. Objective

Finish the ии-Тоня platform around a free ordinary-client product and an
expert-funded revenue model while preserving one visible messenger dialogue. The
backend owns deterministic workflows, commercial state, schedules, and delivery.
Selarti is retained only for complex AI dialogue turns that cannot be answered by a
typed platform workflow.

The work is delivered as an ordered release train. Each increment is independently
testable, default-off where it touches a live provider, and reversible without deleting
historical financial facts.

## 2. Approved commercial model

### 2.1 Ordinary clients

- Ordinary-client access is free. A client does not buy a message package and cannot be
  blocked from safety, catalogue, booking, reminder, feedback, or account-management
  flows by a zero message balance.
- The platform may apply non-financial abuse protection: bounded request rates,
  duplicate suppression, provider backpressure, and operator review. These limits are
  not sold as packages and are not represented as client debt.
- Existing package and message-ledger rows are retained as immutable historical records.
  The V2 path stops creating paid client packages and stops debiting package units.
- An immutable `client_commercial_policy_assignments` row binds each client to either
  `legacy_package_v1` or `free_client_v2`. Existing clients retain the legacy assignment;
  new clients receive V2 only while the V2 admission control is enabled.
- Rollback stops new V2 assignments but never sends an already assigned V2 client through
  the package gate. Existing V2 clients remain free with deterministic-only fallback if
  paid AI routing is disabled.

### 2.2 Expert residency

Initial 30-day tariff versions are:

| Code    | Public name      |       Price | Included operating entitlement                                                                  |
| ------- | ---------------- | ----------: | ----------------------------------------------------------------------------------------------- |
| `START` | Старт            | `3,900 RUB` | approved profile, individual services, booking notifications, basic schedule and statistics     |
| `BASE`  | Базовый          | `5,900 RUB` | Start plus one group-event publication per paid 30-day residency period and expanded statistics |
| `PRO`   | Профессиональный | `9,990 RUB` | Base plus up to three group-event publications per paid period and priority operator support    |

- There is no separate `3,000 RUB` onboarding charge.
- Tariffs do not buy recommendation rank. Matching remains based on the client's
  declared criteria, catalogue eligibility, availability, and factual fit.
- Tariff versions are immutable after publication. A price or entitlement change creates
  a new effective-dated version; existing paid periods retain their snapshot.
- Production tariff rows are created only by the existing entitlement-admin approval and
  audited session workflow. Migrations add schema and test fixtures but do not silently
  create approved commercial offers.
- Every tariff version stores an immutable entitlement set, `commercial_policy_version`,
  and `credit_cap_bps`. A V2 order snapshots those values; legacy orders are assigned
  `credit_cap_bps = 5000`, and new V2 tariff versions require `3000`.
- Resident event commission is `10%` of authoritative settled event revenue. A
  non-resident event commission is `15%`. Commission is created only from a
  platform-settled payment or an operator-approved reconciled revenue statement; an
  unverified expert declaration cannot create a charge. V2 introduces no separate
  event-card fee.
- An event consumes one publication entitlement from the residency order active when the
  event is published. That order's period, entitlement limit, and resident commission
  rate are snapshotted onto the event. An event spanning a renewal stays attached to the
  original period; renewal or downgrade changes only later publications. Non-resident
  publication snapshots `15%`; resident publication snapshots `10%`. Refund adjustments
  use the event's snapshotted rate.

### 2.3 Expert referrals

- The invited expert's first settled residency creates an immutable referral-maturity
  record with status `pending`, `matures_at = settled_at + 30 days`, and no spendable
  credit. A bounded worker locks due rows and grants the inviter `1,000 RUB` only if the
  payment and residency remain eligible and non-reversed.
- A refund or chargeback before maturity changes the record to `cancelled` and produces no
  grant. A concurrent refund and maturity worker serialize on the same settlement and
  maturity rows. A later reversal uses the existing append-only reversal/debt path.
- Credit expires 365 days after grant and can cover at most `30%` of one residency order.
- Existing append-only grant, reservation, spend, release, reversal, expiry, and debt
  facts remain authoritative. The current `50%` order ceiling is migrated forward to
  `30%`; historical settled orders are not rewritten.

### 2.4 Client coupons and referrals

- Client coupons remain a separate append-only product from expert referral credit.
- An inviter and invitee each receive `500` coupons only after the invitee completes a
  first eligible paid expert booking whose cash payment is authoritatively settled through
  the platform. Registration and direct-to-expert payment assertions create no reward.
- Coupons expire after 90 days, can cover at most `1,000 RUB` of one eligible service,
  cannot be converted to cash, and reverse when the qualifying booking or payment is
  authoritatively reversed.
- Every campaign has an operator-approved budget and effective period. Coupon issuance
  atomically reserves the full `500/500` face value before either grant becomes spendable;
  insufficient capacity fails the entire issuance. Redemption converts the matching
  reservation amount to realized campaign spend without reserving it again. Expiry or
  pre-spend reversal releases capacity; post-spend reversal retains realized spend and
  records recoverable debt until repaid. This single reserve/realize/release lifecycle
  bounds issuance and redemption under concurrency.
- V2 coupons are an expert-funded opt-in discount: the participating expert accepts the
  lower client cash amount, and the platform does not reimburse or pay out coupon face
  value. The campaign budget caps accepted discount face value rather than promising a
  cash reserve.
- At checkout, coupon-balance reservation and binding of the existing issuance-time
  campaign reservation to the order occur in one transaction under a stable idempotency
  key; checkout never decreases campaign capacity a second time. Settlement converts the
  bound reserved amount to realized spend. Timeout is reconciled before retry. Refund or
  chargeback reverses the coupon grant/spend chain, restores campaign capacity when policy
  permits, and records debt when already consumed value cannot be restored.
- Client coupon issuance and redemption remain default-off until an approved client-service
  payment capability, provider reconciliation, expert opt-in terms, and legal gate are
  present. Prompt text, booking completion alone, and a single party's assertion cannot
  settle a reward.
- Legacy `2x` package-purchase coupon rules remain historical and are not active in V2,
  because free clients have no package-payment funding event.

## 3. One-dialog hybrid architecture

The backend is the single ingress and egress coordinator for each enabled messenger
channel. A channel cannot simultaneously deliver the same inbound webhook to Selarti and
the platform.

```text
client/expert
    |
messenger webhook
    |
platform inbox -> identity + consent -> typed router
    |                                  |
    | deterministic workflow           | complex AI turn
    v                                  v
application services              Selarti adapter
    |                                  |
    +-------------- result ------------+
                       |
                transactional outbox
                       |
                messenger delivery
```

The client sees one bot account and one chat. All outbound traffic, including a Selarti
answer, reminders, check-ups, feedback requests, booking changes, and payment messages,
passes through one outbox with stable idempotency keys, per-dialogue ordering, bounded
retry, and delivery reconciliation.

Each dialogue has an authoritative sequence allocator. Outbox rows snapshot
`dialogue_id` and monotonically increasing `dialogue_sequence`; the worker may claim only
the lowest unfinished sequence for a dialogue. Parallel `SKIP LOCKED` workers can process
different dialogues but cannot overtake an earlier row in the same dialogue.

### 3.1 Router policy

Deterministic platform handling has priority for:

- commands, buttons, consent, privacy, safety, balances, referrals, tariffs, checkout,
  booking, rescheduling, cancellation, waitlist, reminders, feedback, and check-ups;
- exact FAQ and catalogue queries that can be answered from approved structured data;
- duplicate, stale, replayed, rate-limited, and unsupported inputs.

Selarti receives only an allowlisted complex-dialogue request containing the minimum
consented context. It cannot set a price, balance, coupon, referral owner, booking state,
provider fact, delivery status, or next scheduled job. Its response is validated and
returned to the same outbox as every platform message.

The provider-neutral Selarti port consumes a versioned request containing
`requestId`, `dialogueId`, `userId`, `correlationId`, bounded text, locale, consented
context references, prompt version, and deadline. It returns either a bounded text
proposal plus provider usage metadata, a typed rejection, or `unknown_outcome`. The
adapter sends one stable provider idempotency key, rejects control characters, arbitrary
URLs, tool instructions, and authority-bearing fields, and never emits directly to a
messenger. Timeout after send is reconciled by `requestId`; it is not blindly retried.
Live activation requires a captured official Selarti request/response fixture and an
authenticated webhook/reconciliation contract matching this port.

### 3.2 Cost controls

- Route reason, model/prompt version, billable unit count, latency, and outcome are stored
  without raw sensitive dialogue text in cost telemetry.
- Per-user and global Selarti budgets have warning, soft-stop, and hard-stop thresholds.
- The monthly hard budget is the smaller of an operator-approved RUB cap and `10%` of
  trailing-30-day settled expert residency revenue. The cost estimator applies the
  provider's configured USD/RUB rate, including the Selarti `10%` exchange uplift,
  billable-unit overage, and token allowance before accepting a request.
- Before send, a serializable transaction reserves the request's worst-case estimated RUB
  cost under its stable `requestId` and rejects admission when actual plus reserved cost
  would exceed the hard budget. Reconciliation replaces the reservation with actual cost
  or releases the difference. An `unknown_outcome` retains the reservation until provider
  reconciliation or bounded operator resolution, so concurrent requests cannot overspend
  the cap.
- Hard-stop falls back to deterministic assistance or an operator handoff; it never
  silently sends an unbounded paid request.
- The target planning assumption is at least `75%` deterministic offload. This is a
  monitored target, not a claim embedded in product behaviour.

## 4. Backend ownership

PostgreSQL remains authoritative for identities, consent, profiles, catalogue,
commercial terms, residency orders, payment attempts, coupon and referral ledgers,
bookings, waitlists, scheduled jobs, inboxes, outboxes, and audit facts.

- External webhooks enter through authenticated, idempotent inboxes.
- External effects leave through transactional outboxes and bounded workers.
- Planerka supplies scheduling observations; it is not the booking ledger.
- YooKassa supplies payment observations; it is not the residency or coupon ledger.
- Selarti supplies proposed natural-language output; it is not an application command
  authority.
- Telegram, Make, Google Sheets, prompts, and browser clients cannot provide trusted
  prices, credits, balances, ownership, settlement, or provider status.

## 5. Vertical release train

### Release A — Commercial core V2

- Add immutable client policy assignments and versioned V2 feature controls.
- Add approved-admin support for the three expert tariff versions and entitlement
  snapshots; do not seed production rows from a migration.
- Enforce the `30%` expert-credit ceiling for new orders.
- Remove the V2 onboarding fee and retain historical records.
- Add 30-day expert-referral maturity records and worker processing.
- Make ordinary-client service access free without deleting legacy package history.
- Update quote, checkout, admin, API, and Telegram views to use authoritative V2 terms.

### Release B — Hybrid message gateway

- Add authenticated channel inboxes and a typed deterministic/AI routing decision.
- Add the live-disabled Selarti request adapter, response validation, cost telemetry, and
  budget circuit breakers.
- Deliver every response through the existing worker outbox with per-dialogue ordering.
- Cut over one test Telegram bot first; other channels remain disabled until separately
  evidenced.

### Release C — Scheduler and lifecycle messaging

- Schedule booking reminders at two days, one day, and one hour.
- Schedule coupon-expiry notices at 14 and 7 days.
- Add consented weekly check-ups and post-visit feedback with frequency caps,
  cancellation, deduplication, and timezone-aware execution.

### Release D — Booking, waitlist, and Planerka

- Finish slot observations, configurable 72-hour holds, confirm/cancel/reschedule,
  waitlist promotion, and automatic expiry.
- Add Planerka reconciliation with bounded retry, unknown-outcome handling, freshness,
  and operator-visible drift.
- Add the default-off client-service payment eligibility boundary, expert campaign opt-in,
  atomic coupon/campaign reservations, `500/500` maturity, redemption, reversal, debt,
  and reconciliation.
- Add effective-dated event entitlements, residency-period usage, event snapshots,
  `10%`/`15%` commission statements, refund adjustments, and operator/provider
  reconciliation.

### Release E — Expert and client channel completion

- Complete expert Telegram registration, schedule, client-safe view, booking callbacks,
  residency checkout, referral statistics, and notifications.
- Complete client catalogue, booking, referral, coupon, privacy, check-up, and feedback
  flows in the same visible dialogue.

### Release F — Public content and release closure

- Publish the free-client and V2 expert terms on the landing, privacy policy, and offer.
- Preserve Yandex Metrika and every existing approved static script during rebuilds.
- Update operator runbooks, observability, backup/recovery, migration, rollback, and
  exact-SHA release evidence.
- Keep every live-provider capability disabled until its own staging evidence and human
  release authorization exist.

## 6. Compatibility and migration

- Migrations are additive first. Existing ledgers, package grants, paid periods, orders,
  provider events, and audit records are never mass-updated or deleted.
- V2 eligibility is selected by an effective-dated commercial-policy version and
  environment ceiling. Legacy and V2 cohorts can coexist during rollout.
- New expert orders snapshot tariff name, amount, duration, entitlements, credit ceiling,
  and policy version.
- The order constraint becomes `credit_minor * 10000 <= price_minor * credit_cap_bps`.
  Existing orders are backfilled with `5000`; only V2 tariffs and orders require `3000`.
- Existing unpaid orders retain their original quote until expiry; a new checkout uses
  current terms. Settled orders are immutable.
- Legacy client package charging can be disabled independently from historical balance
  reads and export/erasure obligations.
- A rollback disables new V2 assignments and issuance, drains outboxes, and preserves the
  assigned policy of every existing client. It never package-blocks V2 clients or removes
  already settled financial facts.

## 7. Security, privacy, and failure behaviour

- Safety and privacy actions bypass commercial limits and AI budget stops.
- Every money-like mutation is transactional, idempotent, auditable, and reconciled to
  the provider observation that caused it.
- Same idempotency key with a different canonical payload is a conflict.
- Timeout after an external send is an unknown outcome and is reconciled before retry.
- Channel identities are tenant- and provider-bound. Callback payloads remain opaque,
  signed, short-lived, single-use, and version-bound.
- Selarti receives no secrets, payment details, private keys, raw provider payloads, or
  unrelated profile facts.
- Raw inbound text and encrypted Selarti request context are retained for at most 30 days;
  provider request metadata and cost facts exclude raw text. Erasure propagates to every
  supported provider. Live Selarti activation is blocked until its contractual retention,
  deletion, and data-location terms are recorded and compatible with the privacy policy.
- PII, conversation text, tokens, payment URLs, and credentials are excluded from logs.
- V2 commercial flags cannot be enabled until matching landing, offer, privacy, expert
  opt-in, refund, coupon, and referral terms pass a separate product/legal approval gate.

## 8. Acceptance criteria

The V2 release train is complete when:

1. A new ordinary client can use safety, catalogue, booking, reminders, feedback, and
   account/privacy flows without buying or consuming a message package.
2. Active experts can discover, quote, and buy only effective `3,900`, `5,900`, or
   `9,990 RUB` 30-day tariff versions; no onboarding fee is added.
3. New expert orders reserve at most `30%` referral credit and preserve exact cash plus
   credit equals price accounting.
4. Expert referral credit remains unspendable for 30 days, cancels on a pre-maturity
   refund, serializes maturity against refund, and reverses or creates debt after grant.
5. Client `500/500` coupons settle only after a completed first platform-settled booking and never
   exceed the approved campaign budget or `1,000 RUB` service cap; coupon face value is
   an expert-funded opt-in discount and creates no platform payout.
6. One test client sees deterministic and Selarti-assisted responses in the same bot
   dialogue, with no duplicate webhook processing or out-of-order delivery.
7. Parallel workers cannot deliver sequence `N+1` before unfinished sequence `N` for the
   same dialogue, while different dialogues remain concurrently deliverable.
8. Selarti admission rejects work above the lower of the operator cap and `10%` of
   trailing settled expert revenue, using the configured uplifted FX and usage estimate.
9. Reminder, check-up, feedback, booking, waitlist, expiry, and reconciliation jobs are
   idempotent and observable under retries.
10. Planerka, Selarti, Telegram, and YooKassa remain fail-closed when configuration or
    capability evidence is absent.
11. Event publication atomically consumes the residency-period quota; renewals and
    downgrades do not move existing events, and commission/refund statements use the
    event's snapshotted `10%` or `15%` rate without trusting expert-supplied totals.
12. The landing and legal pages state free client access and the V2 expert terms without
    unsupported outcome, advertising, or medical claims.
13. Focused tests, typechecks, lint, migration tests, PostgreSQL concurrency tests,
    independent reviews, exact-SHA CI, and Database Gate evidence are green for every
    release increment.

## 9. Success metrics

- listed expert ARPE and realized ARPE after discounts;
- expert activation, 30/60/90-day retention, and observed monthly churn;
- CAC by channel, referral liability, coupon grant/redemption/expiry, and contribution
  margin;
- Selarti share of turns, units and RUB cost per active expert, deterministic offload,
  fallback rate, and hard-stop count;
- booking conversion, provider drift, duplicate suppression, delivery failure, reminder
  delivery, and reconciliation age;
- support cases, privacy requests, safety handoffs, and failed-closed provider attempts.

## 10. Explicit non-goals

- No own general-purpose LLM engine or model training.
- No paid client package in V2.
- No recommendation rank purchased by an expert tariff.
- No direct Make or Google Sheets authority over application state.
- No simultaneous webhook ownership by Selarti and the platform.
- No live credential entry, provider activation, production deployment, destructive
  migration, or historical ledger rewrite as part of implementation PRs.
