# Expert Residency Referral Design

**Date:** 2026-08-02
**Status:** Approved design; implementation not started
**Scope:** Expert-to-expert referrals and partial payment of expert residency
**Release posture:** Disabled by default; staging and production require separate approval

## 1. Objective

Add an expert-only referral program without sharing storage, balances, codes, or
redemption paths with client coupons.

An active, verified expert can invite a new expert with a single-use expert
promo code. When the invitee's first residency payment is authoritatively
settled, the inviter receives 1,000 RUB of internal residency credit. Credit can
pay at most 50% of a residency tariff; the remainder is paid in money. Each
reward expires 365 days after grant.

The implementation must preserve the platform's existing rules: PostgreSQL is
the source of truth, financial state is ledger-derived, provider callbacks are
untrusted until verified, and an LLM cannot mutate balances, referrals,
residencies, tariffs, or payments.

## 2. Brownfield boundary

The source document describes client `500/500` coupons, but current `main`
deliberately excludes executable coupon and referral modules through
`tests/repo/scope-boundary.test.ts`. Existing `message_packages` account for
message units, not RUB-equivalent coupons or residency credit.

This feature therefore creates a separate bounded context. It does not claim to
implement, change, or validate the client `500/500` program.

## 3. Requirements

### Referral codes

- **ERR-FR-001:** An authorized administrator can generate a batch of `N`
  cryptographically random expert referral codes for one active, verified
  inviter expert, where `1 <= N <= 1000`. Larger issuance requests require
  separate batches.
- **ERR-FR-002:** A generated plaintext code is returned once. Persistent
  storage contains only a keyed hash, a masked suffix, batch identity, owner,
  lifecycle state, and audit metadata.
- **ERR-FR-003:** Each code is single-use and has no automatic expiry. An
  administrator can revoke an unused code with an audited command.
- **ERR-FR-004:** Expert codes use a distinct table, namespace, validation path,
  and observable type from client coupon codes.

### Referral binding

- **ERR-FR-005:** A registered expert can redeem an expert code only before
  their first settled residency payment and while they have no prior expert
  referral binding. The invitee must be active and verified at redemption,
  checkout creation, and settlement.
- **ERR-FR-006:** Self-referral, inviter replacement, code reuse, and concurrent
  double redemption fail closed.
- **ERR-FR-007:** Redemption atomically consumes the code and creates one
  immutable inviter-to-invitee binding.
- **ERR-FR-008:** Inviter residency expiry does not invalidate consumed or
  unconsumed codes and does not revoke already granted credit. Only inviter
  activity and verification are required when a batch is issued.
- **ERR-FR-029:** Batch identity, requested count, issuing administrator, and
  creation timestamp are durable audit data. Partial batch creation is
  forbidden.

### Tariffs and residency orders

- **ERR-FR-009:** Residency tariffs are versioned administrative records with a
  name, positive price in kopecks, positive residency duration, activation
  interval, and immutable version identity. Activation intervals for versions
  of the same tariff must not overlap.
- **ERR-FR-010:** An order stores an immutable snapshot of tariff version,
  description, price, duration, currency, bonus quote, and cash quote.
- **ERR-FR-011:** All monetary values are integer minor units. The RUB currency
  code is explicit; floating-point amounts are forbidden.
- **ERR-FR-012:** The maximum credit for an order is
  `floor(tariff_price_minor / 2)`. Applied credit is
  `min(available_credit_minor, maximum_credit_minor)`. Cash due is the exact
  remainder.
- **ERR-FR-013:** An order can use less than 50% credit when the expert's
  available balance is lower. An order can never use more than 50% credit.
- **ERR-FR-030:** On settlement, a residency interval starts at
  `max(current_residency_end, settled_at)` and extends by the snapshotted tariff
  duration. Concurrent settlements for one expert are serialized so paid time
  cannot be lost or overlap.

### Reward, spending, and expiry

- **ERR-FR-014:** The inviter receives exactly 100,000 kopecks only when the
  invitee's first residency payment reaches authoritative `settled` state and
  the invitee is active, verified, and anti-abuse-cleared in that settlement
  transaction. A failed settlement-time eligibility decision permanently
  consumes that referral's reward opportunity; later re-verification cannot
  backfill the reward.
- **ERR-FR-015:** Registration, code redemption, checkout creation, redirect,
  ambiguous provider response, or an unverified callback cannot grant credit.
- **ERR-FR-016:** One referral binding can produce at most one reward grant, and
  one qualifying payment can qualify at most one referral.
- **ERR-FR-017:** Each reward grant expires exactly 365 days after its settlement
  grant timestamp. Credit is reserved and spent from the earliest-expiring
  eligible grants first. Every reservation, release, spend, expiry, reversal,
  and debt calculation records mandatory per-grant allocations.
- **ERR-FR-018:** Expiry, spending, release, correction, and reversal are new
  append-only facts. Existing financial facts are never updated or deleted.
- **ERR-FR-019:** Checkout reserves quoted credit atomically. Settlement commits
  the reservation; failed or expired checkout releases it exactly once.
- **ERR-FR-020:** Available balance cannot be spent below zero and excludes
  expired credit and active reservations.
- **ERR-FR-031:** A checkout using credit expires no later than the earliest
  `expires_at` among its allocated grants. At that exact database timestamp the
  order expires and its reservation is released atomically. Settlement is valid
  only while `db_now < payment_deadline`; at `db_now >= payment_deadline`,
  expiry/release wins under the same row lock and a new quote is required.
- **ERR-FR-032:** The first-settled-residency decision is a durable per-expert
  database fact with a unique constraint. Concurrent settlements are ordered
  by a database-assigned monotonic settlement sequence, not provider event time
  or arrival order.

### Refund and debt

- **ERR-FR-021:** A full refund or chargeback that authoritatively terminates
  the qualifying residency appends exactly one reward reversal for the original
  100,000-kopek grant. A partial cash refund that leaves residency active does
  not reverse the reward.
- **ERR-FR-022:** If the reversed reward was already spent, completed historical
  residency orders remain unchanged and the inviter receives referral debt.
- **ERR-FR-023:** Available referral credit is zero while debt is outstanding.
  Future reward grants reduce debt before creating spendable credit.
- **ERR-FR-024:** Refund and chargeback effects on the invitee's residency are
  owned by the residency/payment state machine. The referral module consumes
  that authoritative outcome and does not invent residency policy.
- **ERR-FR-033:** Refunding an order paid partly with referral credit never
  restores or converts the spent credit. Only the refundable cash portion may
  be returned. Partial refunds cannot exceed the cash actually captured minus
  prior cash refunds.
- **ERR-FR-034:** Reward reversal is allocation-derived: unspent unexpired
  credit from the grant is removed, expired unspent credit remains expired,
  active reservations allocated to the grant are cancelled and removed, and
  the amount historically spent from the grant becomes debt. Replaying the
  reversal produces no additional removal, cancellation, or debt.

### Interfaces and prompt boundary

- **ERR-FR-025:** The expert Telegram boundary supports redeeming a code,
  viewing balance/expiry/debt, quoting a tariff, and starting an authorized
  checkout.
- **ERR-FR-026:** Admin API commands support batch generation, unused-code
  revocation, tariff version creation/retirement, masked inventory, and safe
  replay of settlement/refund processing.
- **ERR-FR-027:** Expert prompt context contains only a read-only, server-derived
  referral summary and tariff quote. It excludes code hashes, provider secrets,
  raw ledger internals, and cross-expert data.
- **ERR-FR-028:** Model output is an untrusted typed proposal. Deterministic
  application services reauthorize every mutation and calculate every amount.
- **ERR-FR-035:** Settlement and refund processing use durable provider-event
  inbox and payment-attempt identities. Authentication result, payload digest,
  processing status, and idempotent outcome are recorded without retaining
  secrets or unsafe raw payloads.
- **ERR-FR-036:** If the invitee is inactive or unverified at settlement, the
  payment event is reconciled through the residency/payment state machine but
  cannot create the referral reward. The first-settlement marker records the
  permanently failed reward eligibility decision so it is durable, auditable,
  and cannot be retried after later re-verification.
- **ERR-FR-037:** Repository scope guards may be widened only for the named
  expert-referral and provider-neutral billing contracts. Live payment-provider
  composition remains forbidden until a separately reviewed provider contract
  and explicit activation approval exist.
- **ERR-FR-038:** One inviter may have at most 1000 codes in `issued` state plus
  redeemed referrals without a qualifying settled payment, and may receive at
  most 1000 newly issued codes in any rolling 30-day window. Issuance locks the
  inviter quota and fails atomically when either limit would be exceeded.
- **ERR-FR-039:** Exceeding an issuance limit requires two distinct authorized
  administrators, an explicit bounded override, reason, expiry, and immutable
  audit record. An administrator cannot approve their own override twice.
- **ERR-FR-040:** Redemption and settlement require the platform's ordinary
  unique expert-profile verification. Duplicate identity signals or an open
  abuse flag prevent reward qualification pending human review; review cannot
  retroactively award a referral whose first settlement failed eligibility.
- **ERR-FR-041:** An audited kill switch can stop new code issuance, redemption,
  checkout creation, and reward grants immediately. It must not block verified
  settlement/refund callbacks, reconciliation, reservation release, expiry, or
  debt/reversal processing for existing financial state.
- **ERR-FR-042:** When a pre-existing qualifying order settles while reward
  grants are disabled, its first-settlement marker records
  `pending_feature_hold` rather than ineligible. No balance effect occurs while
  disabled. After audited re-enable, an idempotent controlled replay rechecks
  the captured settlement-time expert/anti-abuse eligibility and locks and
  verifies that the qualifying payment and residency have not been refunded,
  charged back, or terminated. It then either grants or debt-repays exactly
  once, or records permanent ineligibility. A terminating refund or chargeback
  atomically changes a held marker to `cancelled_by_refund`; that terminal state
  can never create a reward. The timing of an operational toggle cannot silently
  destroy or duplicate entitlement.

## 4. Data model

### `expert_referral_code_batches`

Stores batch ID, inviter expert ID, requested count, issuing administrator,
approval/audit binding, creation timestamp, and batch status.

### `expert_referral_codes`

Stores code ID, batch ID, inviter expert ID, keyed code hash, masked suffix,
status (`issued`, `redeemed`, `revoked`), issuance timestamp, redemption
timestamp, and revocation audit binding. The keyed hash and expert-code
namespace prevent cross-use with client codes. Codes contain at least 128 bits
of cryptographic entropy. Lookup uses HMAC-SHA-256 with a stored non-secret key
version; rotation retains validation keys for existing active codes until they
are redeemed or revoked.

### `expert_referrals`

Stores immutable code ID, inviter expert ID, invitee expert ID, and binding
timestamp. Unique constraints cover code ID and invitee expert ID; a check or
transactional guard rejects identical inviter/invitee IDs.

### `expert_residency_tariff_versions`

Stores immutable tariff/version identity, display name, `price_minor`, currency,
duration, activation interval, and administrative audit binding. New prices
create new versions rather than rewriting historical values. A database
exclusion constraint prevents overlapping activation intervals for versions of
the same tariff.

### `expert_residency_orders`

Stores expert ID, idempotency key, immutable tariff snapshot, quoted bonus and
cash amounts, provider-neutral payment identity, status, timestamps, and the
resulting residency interval after settlement.

Order states are `quoted`, `payment_pending`, `settled`, `failed`, `expired`,
`refunded`, and `charged_back`. Invalid transitions fail closed.

### `expert_residency_payment_attempts`

Stores an immutable attempt identity, order identity, provider-neutral request
identity, expected amount/currency, state, and timestamps. Ambiguous attempts
are reconciled under the same identity rather than recreated blindly.

### `expert_residency_provider_event_inbox`

Stores provider/event identity, authenticated payload digest, event kind,
received time, processing status, and the idempotent processing result. Unique
provider/event identity prevents duplicate financial effects.

### `expert_first_residency_settlements`

Stores one durable first-settlement marker per expert, the database-assigned
settlement sequence, qualifying order, and reward-eligibility result/reason. A
unique expert key selects one winner during concurrent settlements, including a
permanent ineligible result. The marker is not a financial fact: immutable
identity, order, referral, settlement, and captured-eligibility columns never
change, while a database trigger permits only the monotonic
`pending_feature_hold -> eligible | permanently_ineligible | cancelled_by_refund`
resolution required by ERR-FR-042. Terminal states reject every update and all
marker deletes are forbidden.

### `expert_referral_issuance_overrides`

Stores inviter, bounded additional quota, reason, validity interval, requester,
two distinct approvers, consumption, and immutable audit timestamps. Quota
checks count issued codes, redeemed-but-unsettled referrals, and rolling 30-day
issuance under the inviter row lock.

### `expert_referral_reward_grants`

Stores inviter, referral, qualifying settled order/payment, amount 100,000
kopecks, grant timestamp, and `expires_at = granted_at + 365 days`. Unique
constraints enforce one grant per referral and qualifying payment.

### `expert_referral_ledger_entries`

Stores account expert, entry kind, signed amount, source identity,
idempotency key, mandatory reward-grant allocation where credit is affected,
original entry reference,
and timestamp. Entry kinds cover reward grant, reservation, release, spend,
expiry, reversal, debt repayment, and administrative correction. Database
checks bind allowed sign and references to each kind.

### Derived projections

Views derive spendable balance, reserved balance, nearest expiry, lifetime
grants/spend/expiry, and debt. Mutable balance columns are forbidden.

## 5. Transaction flows

### Generate batch

1. Authenticate and authorize the administrator.
2. Verify that the inviter is active and verified.
3. Lock and enforce the inviter's outstanding and rolling 30-day quotas; apply
   only a valid dual-approved bounded override.
4. Generate independent random codes and compute versioned keyed hashes.
5. Insert the complete batch/codes and audit event atomically.
6. Return plaintext codes once; never persist or log them.

### Redeem code

1. Normalize the expert-code namespace and compute the lookup hash.
2. Lock code and invitee eligibility rows.
3. Reject unknown, redeemed, revoked, self-referral, prior binding, or prior
   settled residency, and reject an inactive or unverified invitee.
4. Atomically mark the code redeemed and insert the immutable referral.

### Quote and checkout

1. Lock the one active, non-overlapping tariff version and verify that the
   expert is active and verified.
2. Derive available credit at the database clock.
3. Calculate the 50% cap and allocate FIFO by earliest expiry.
4. Set the payment deadline no later than the earliest allocated grant expiry;
   store the immutable quote and append per-grant reservation facts in one
   transaction.
5. Create provider checkout only after the transaction commits. Ambiguous
   provider outcomes enter reconciliation rather than retrying blindly.

### Settlement

1. Authenticate and deduplicate the provider event.
2. Lock the order, expert eligibility, residency, reservation, referral, and
   first-settlement/reward uniqueness keys.
3. Validate exact cash amount/currency and a legal state transition.
4. Under the order row lock, allow settlement only when
   `db_now < payment_deadline`; otherwise expire and release the reservation.
   Reject referral reward creation for an inactive, unverified, duplicate, or
   abuse-flagged invitee and persist that permanent eligibility result in the
   first-settlement marker.
5. Commit reserved credit and activate residency from
   `max(current_residency_end, settled_at)` atomically.
6. If this wins the invitee's first-settlement marker and its eligibility result
   is `eligible`, append the inviter reward or debt-repayment facts exactly once.
   An ineligible marker appends neither. If reward grants are disabled, record
   `pending_feature_hold` for controlled replay and append no balance fact.
7. Write audit/outbox records in the same transaction.

### Failure, refund, and chargeback

Failed or expired checkout releases all per-grant reservations exactly once.
When an allocated grant reaches expiry, its pending order expires and releases
the reservation atomically before any new quote can reuse the funds.

Only captured cash is refundable; spent referral credit is never restored or
converted to cash. A partial cash refund that leaves residency active does not
reverse the inviter reward. A full refund or chargeback that authoritatively
terminates the qualifying residency reverses the reward exactly once. The
reversal removes unused active credit, cancels active reservations, leaves
already expired value expired, and converts the grant's historically spent
allocation into debt. Completed historical orders are never rewritten.

If the qualifying first-settlement marker is still `pending_feature_hold`, the
same terminating refund/chargeback transaction locks it and changes it to
`cancelled_by_refund` instead of attempting reversal. Controlled replay locks
the marker, payment, order, and residency and refuses every refunded,
charged-back, terminated, or `cancelled_by_refund` case.

## 6. Error handling and security

- Provider events require confirmed authenticity, bounded payloads, replay
  protection, event-time validation, and exact amount/currency matching. Delay
  alone never discards a legitimate authenticated event: late or uncertain
  events enter reconciliation and remain idempotently processable.
- Codes, hashes, referral identities, and payment identifiers are redacted from
  logs and metrics.
- Code lookup is rate-limited and returns non-enumerable public errors.
- Financial mutations use database transactions, row locks, unique
  idempotency constraints, append-only triggers, and database time.
- Unknown states, duplicate facts with conflicting content, unavailable
  authorization, and reconciliation mismatches fail closed.
- Administrative corrections require an authenticated approval and append a
  compensating fact; direct balance edits are impossible.

## 7. Feature flags and rollout

- `EXPERT_REFERRAL_ENABLED=false` controls code redemption and reward effects.
- `EXPERT_RESIDENCY_BILLING_ENABLED=false` controls checkout and residency
  activation.
- Disabling either flag blocks new user/admin commands in its scope. It does not
  block authenticated callbacks, settlement/refund reconciliation, reservation
  release, expiry, reversal, or debt processing for pre-existing state.
- A qualifying first settlement observed while reward creation is disabled is
  held as `pending_feature_hold` and resolved only by audited idempotent replay
  after re-enable; it is neither granted immediately nor marked ineligible due
  solely to the operational toggle. A terminating refund or chargeback wins
  under the same database locks and permanently cancels the held entitlement.
- Schema migrations create empty structures. They do not seed tariffs, codes,
  rewards, balances, or live bindings.
- Payment-provider composition remains disabled until its authenticated sandbox
  contract, settlement semantics, and reconciliation evidence are approved.
- Scope-guard changes land before any provider adapter and permit only the named
  provider-neutral attempts, inbox, and referral contracts. A live provider
  adapter requires a separate specification, review, and activation approval.
- Staging activation requires fresh authorization for this financial behavior,
  successful sandbox settlement/refund/replay evidence, migration approval, and
  a named human spot-check.
- Production requires a separate explicit authorization and approved rollback
  evidence. Existing staging permission does not authorize this new behavior.

## 8. Observability and reconciliation

Metrics cover batch/code lifecycle, redemption conversion, first-payment
qualification, reward grant/spend/expiry, debt, bonus share, duplicate events,
and reconciliation mismatches. Labels must be bounded and contain no codes,
names, payment IDs, or provider payloads.

Reconciliation compares orders, provider settlements/refunds, reservations,
reward grants, ledger-derived balances, debt, and residency activation. A
mismatch creates an immutable incident and blocks automatic correction.

## 9. Verification contract

- Domain property tests prove the 50% cap, exact cash remainder, FIFO allocation,
  365-day boundaries, debt offset, and non-negative spendable balance.
- PostgreSQL tests cover concurrent redemption, checkout reservations,
  settlement, deterministic first-payment uniqueness, non-overlapping tariff
  versions, renewal serialization, expiry at an active reservation boundary,
  the exact `db_now == payment_deadline` settlement/expiry race, partial/full
  refund, chargeback, allocation-derived reversal, replay, and the sequence
  `pending_feature_hold -> terminating refund/chargeback -> re-enable replay`,
  which must produce no reward.
- Contract tests cover authenticated provider events, amount/currency mismatch,
  timeouts, ambiguous sends, replay, and malformed payloads.
- Security tests cover hash-only persistence, plaintext/log leakage, code
  enumeration, key rotation, self-referral, cross-expert access, client-code
  isolation, issuance quota races, dual-approval separation, duplicate expert
  identity, abuse holds, and kill-switch behavior.
- Prompt regression tests prove that model output cannot set prices, balances,
  codes, inviter identity, settlement, or ledger facts.
- Repository guards explicitly allow only the reviewed new relations, commands,
  routes, flags, and migrations; unrelated live payment capability remains
  forbidden.
- CI runs schema parity, migration replay, repeat concurrency gates, full
  regression, secret scan, image smoke, vulnerability scans, and signed release
  provenance.
- AI behavior additionally requires incident regression cases, diff checks
  against the prior prompt/version, and a named human spot-check before staging.

## 10. Non-goals

- Implementing or changing client `500/500` coupons.
- Converting client coupons, message units, or expert credit between ledgers.
- Granting rewards from registration, redirects, unverified callbacks, or
  manually edited provider state.
- Allowing an LLM, Make, Google Sheets, Telegram, or a payment provider to become
  the financial source of truth.
- Selecting a payment provider or enabling live money movement in this design.
- Restoring or cashing out spent referral credit after an order refund.
- Defining residency termination policy beyond consuming the authoritative
  payment/residency outcome.

## 11. Acceptance and ownership gates

- Product owner approves reward amount, 365-day lifetime, 50% cap, tariffs, and
  refund/debt behavior through this design.
- Engineering owns deterministic calculations, schema invariants, idempotency,
  reconciliation, telemetry, and rollback evidence.
- Security reviewer owns code secrecy, provider authenticity, authorization,
  and financial abuse review.
- Release operator records the named migration reviewer, AI spot-check approver,
  staging authorization, and production authorization in release evidence.
- The feature is complete only when each `ERR-FR-*` requirement maps to code,
  tests, mandatory CI evidence, release artifacts, telemetry, and rollback or
  recovery steps.
