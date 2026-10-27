# Immutable expert campaign quotes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Preserve the displayed expert campaign price as an immutable server-owned quote that checkout can consume without recalculation.

**Architecture:** PostgreSQL owns the first-calculation anchor and append-only quotes. A separate campaign-order branch will consume quote identity; legacy orders and V2 base tariffs stay unchanged. Quote persistence is the next phase, not a substitute for the required promo→order→provider→settlement journey.

**Tech Stack:** Existing Drizzle repository patterns, hand-authored SQL, PostgreSQL17.5, TypeScript and bigint calculator `calculateExpertCampaignPrice`.

**Spec:** Accepted DEC-FIN-010/011, `docs/operations/2026-10-12-expert-quote-composition-gap.md` and arithmetic contract `2026-10-12-expert-campaign-price.md` in this directory.

## Global constraints

- No live flags, provider requests, catalogue rows, written-consent gate or historical tariff/order mutations. Quotes are not payments or credit reservations.
- First-calculation anchor is per authenticated internal user and rule version. A promo lead need not yet have an expert row. Later checkout must prove expert ownership of that same user; it may not reanchor on expert creation.
- Server-owned clock only. Command accepts user ID from trusted authenticated composition, tariff ID, term and idempotency key. No caller price, discounts, anchor or current time.
- Quote lifetime engineering choice: min(15 minutes after issue, tariff active_to, next Energy stage boundary). Three-month eligibility ends at144hours; that boundary caps expiry. After216hours there is no further Energy boundary. No zero-duration quote.
- Repeated same-key command returns the exact prior immutable quote, including expired quotes, without extending validity or creating a new anchor. Different tariff/term under the same key is a conflict. Recalculation requires a new key, reuses the anchor and uses the current stage.
- Amounts are serialized decimal strings at repository boundaries. Internally use bigint. Duration and discounts follow the reviewed calculator. Never treat referral credit as another price discount.
- All DB checks remain fail-closed. This phase creates no enabled public route. Existing sender/payment controls are unaffected.
- Existing order bounds are stricter than PostgreSQL bigint: total must also be at most999999999999minor so the quote is payable by the existing order ledger. The quote does not promise a cash/credit split; checkout reserves then presents the actual split.

## Task1 — Anchor and quote persistence

**Ownership:** new `packages/db/src/repositories/expert-campaign-quote-repository.ts`, new `packages/db/src/schema/expert-campaign-quotes.ts`, DB barrels, next available migration (expected0047 after confirming journal), journal/snapshot/state artifacts, new `tests/integration/expert-campaign-quotes.test.ts`.

**Interface:** `PostgresExpertCampaignQuoteRepository(db).createQuote({userId,tariffVersionId,termMonths:1|3,idempotencyKey})` returns `ExpertCampaignQuote` with `id,userId,tariffVersionId,ruleVersion,calculationTimestamp,quotedAt,expiresAt,termMonths,durationSeconds,baseMonthlyMinor,discountedMonthlyMinor,monthlyPriceMinor,priceMinor,currency,energyDiscountBps,startDiscountBps,floorApplied` and copied display/entitlement fields: `displayName,creditCapBps,individualServicesEnabled,groupEventLimit,statisticsLevel,supportPriority`.

Use content-free typed error codes for invalid input, inactive user/tariff, idempotency conflict, unavailable term and quote expiry boundary. Do not log raw commands/SQL errors. Authenticated transport ownership checks remain mandatory in the next phase; this DB interface is not a public authorization grant.

### Schema/transaction contract

- Anchor table has `(user_id,rule_version)` primary key, internal user FK and calculation timestamp. Quotes reference that exact anchor and tariff, have unique `(user_id,idempotency_key)` and immutable snapshots. Both tables reject UPDATE/DELETE through reviewed append-only triggers; no raw contact/message data.
- Quote fields have exact currency/rule/term/time/value checks. Recompute the integer rounding/floor/term price relation in SQL numeric arithmetic without bigint intermediate overflow. Pin Energy and Start rates to elapsed quote time, not a caller-selected stage. Include a positive total bound999999999999minor.
- Copy base/display/entitlement facts from a real active V2 tariff. Add database enforcement of the source binding; a forged snapshot must not satisfy price checks merely because it is internally consistent. Do not edit0032 or weaken its V2 combinations.
- Serialize quote creation on the existing user advisory namespace. Acquire document/subject barrier before locking source user/tariff rows, in their existing order. Verify active user. Lock tariff against concurrent retirement; fresh `clock_timestamp()` after waits controls applicability and expiry. Do not use a transaction-start clock to authorize an expired tariff.
- Check idempotent replay before creating an anchor or demanding a currently active tariff, while still validating the active user. Old snapshots remain readable through a valid same-key replay after tariff retirement/quote expiry; that does not authorize checkout.
- First valid quote creates the anchor atomically. Failed tariff/term/quote transactions leave no orphan anchor. Concurrent different-key first requests share exactly one anchor. Current rule version is `expert_energy_start_v1`.
- Source timestamp precision must match calculator milliseconds. Explicitly use millisecond timestamps for anchor/issue/expiry so JS conversion cannot move a stage boundary.
- No credit ledger, order, provider or Telegram writes. Storage does not yet consume a quote.

### Tests and bounded verification

- [ ] Write compileable scaffold and literal tests before implementation. RED1/GREEN2 on the new focused file only; reserve PG3 for coordinator after independent review. No copied exhausted-suite replay.
- [ ] Real first creation/restart/replay; different idempotency content rejected; two concurrent creations keep one anchor; same-key race produces one quote.
- [ ] Real tariff snapshot and SQL tamper rejection for base, rates, term, amount, currency, timestamps and entitlements. Append-only protections and FK binding.
- [ ] Fresh post-lock timestamp: tariff/quote boundary crossed during wait rejects or uses the correct later stage, without changing an old snapshot.
- [ ] Recalculation never resets anchor; exact72/144/216-hour transitions, three-month eligibility and monthly floor agree with the calculator. Use a test-only fixture to seed historical immutable facts; no public backdating API.
- [ ] Rollback leaves no partial quote/anchor; inactive/missing user, wrong tariff policy, expired tariff and malformed inputs fail without financial side effects.
- [ ] Expired and retired-tariff same-key replay returns original snapshot and expiry. New-key command against retired tariff fails.
- [ ] Reconstruct migration state on isolated PG17.5, preserve all prior hashes, run relevant types/lint/diff checks. Independent adversarial review before coordinator PG3.

## Required next tasks, separate assignment after Task1

### Task2a — Shared transport input contract (coordinator, independent of DB files)

Create `packages/contracts/src/expert-campaign-quotes.ts` and its focused unit
test; export from the contracts barrel after review. Quote request is a strict
object with `tariffVersionId` (UUID normalized lowercase), `termMonths` (literal
number1 or3), and `idempotencyKey`. Checkout request is a strict object with
`quoteId` (UUID normalized lowercase) and `idempotencyKey`, not tariff/term/price.
Reuse the existing expert HTTP idempotency shape:
`^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$`. Do not normalize its case or whitespace.
Reject every unrecognized field, including user/expert identity, amount, credit,
timestamps and discount claims. No coercion of strings into numeric terms.

Tests: permitted inputs, canonical UUID behavior, forbidden financial/identity/
clock fields, wrong term/type, invalid/missing IDs and keys, null/array bodies.
Focused RED1/GREEN2, reserve3 for review corrections. This only establishes shared
schemas, not an authenticated or enabled API. Actual routes must use them without
silently stripping additional properties before validation.

1. Quote-bound campaign checkout: one quote per order, owner validation, expiry checked after authority locks, copied immutable amount/term/entitlements, credit conservation and exact idempotency. New constrained campaign policy branch; old v1/v2 predicates remain unchanged.
2. Authenticated API/Telegram/promo use the saved quote ID and display its term, expiry and breakdown. No client timestamp/price authority. Expert-user mapping checked server-side.
3. Existing provider and settlement consume the order's saved cash amount and duration; residency starts from payment as previously directed. Preserve replay, refund and historical settlement invariants.
4. Exact-candidate integration, UI, payment and rollback evidence before authorized deployment. A stored quote alone does not close the commercial goal.

## Source-review findings to carry into checkout design

Kant's read-only trace found no financial-snapshot immutability trigger on expert
orders through0046 (client orders have one, but are a separate product). Add
campaign protection rather than assuming existing expert snapshots are enforced
by SQL. The only current order trigger supplies a provider deadline.

Settlement explicitly dispatches v1/v2 referral policies. A new campaign order
version must not consume the first-settlement marker without the appropriate
reward maturity. Preserve accepted V2 referral treatment unless a separate owner
decision changes it; test that branch explicitly before campaign activation.

Main source lines3260/3708/4697 describe the included group allowance per month.
Do not multiply the stored0..3 monthly limit into an incompatible whole-term
number or silently grant only one month of allowance for a three-month term.
The actual group-usage period enforcement must be traced before checkout release.

No entitlement/reward change is authorized by Task1 storage. Its tariff snapshots
remain the original V2 facts; later order-policy type changes must not broaden
admin tariff creation or overwrite historical records.

This design records delegated technical choices, not legal policy approval, pricing activation or human acceptance. Unimplemented later tasks remain explicit release blockers.

## Checkout handoff design — awaiting settlement helper acceptance

Harvey completed read-only design after quote PG3 passed67/67. No checkout
implementation is assigned while McClintock owns the shared residency repository.
Use a separate campaign-order repository and new constrained order policy
`expert_campaign_v1`; never widen the tariff/admin policy or modify0032 in place.

Input is trusted userId/expertId plus quoteId/idempotencyKey. No caller price,
term, tariff, credit, clock or deadline. Validate user ownership and active/verified
expert within the transaction, including replay. Same key/quote returns the
original order; changed quote or a legacy-order key collision conflicts. A second
key for a consumed quote returns QUOTE_ALREADY_USED, even after order expiry.

Unique nullable campaign_quote_id on the order is the consumption fact. Campaign
orders require it and campaign_term_months; legacy policies prohibit both. Source
enforcement binds exact quote owner, tariff, price, duration and entitlements.
Financial immutability must prevent changes to identity, policy, term, amounts,
deadlines and copied entitlements while permitting real lifecycle transitions.

Coordinator technical decision: use quote.expiresAt as provider deadline, capped
further by allocated grant expiry for payment deadline. A checkout started near
expiry may have little time to pay; display that expiry and allow a new quote.
Never extend an accepted price silently. The500000 monthly floor applies to
price, not to cash after referral credit. Reserve credit transactionally FIFO.

Do not assume SERIALIZABLE eliminates lock-order deadlocks. Existing checkout
locks control before expert, while maturity handling can lock expert before
control. Before implementation, specify bounded contention handling on the new
branch, covering implicit FK locks and whole-transaction retry. Do not change the
shared retry helper or existing worker ordering as an incidental refactor.

Literal acceptance amounts (minor RUB; with sufficient valid credit):

| Quote | Price | Credit | Cash | Duration seconds |
| --- | ---: | ---: | ---: | ---: |
| PRO first stage,1month |599400|179820|419580|2592000|
| PRO first stage,3months |1528470|458541|1069929|7776000|
| START floor,3months |1500000|450000|1050000|7776000|
| PRO second stage,3months |1888110|566433|1321677|7776000|

With only100000 available against599400, cash is499400. Group limits remain
monthly0/1/3, not multiplied pooled allowance. Before provider activation, route
campaign settlement through accepted V2 referral maturity semantics and test
stored cash/duration, replay, reversal and first-settlement uniqueness. Storage
alone is not permission to activate the new policy.
