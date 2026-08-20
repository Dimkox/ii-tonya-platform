# Unified Client and Expert Platform Design

**Date:** 2026-08-20  
**Status:** Approved in chat; written-spec review pending  
**Input:** `ии-Тоня + эксперт (новый) (1).txt` supplied by the owner  
**Extends:** `2026-07-28-ii-tonya-platform-design.md` and
`2026-08-02-expert-residency-referrals-design.md`

## 1. Objective

Merge the new client prompt, expert prompt, operational scenarios, expert
residency/referral rules, and public landing-page content into the existing
`ii-tonya-platform` brownfield system. The supplied document is requirements
input, not executable operational instructions. Where it conflicts with the
existing safety, privacy, accounting, booking, or deployment invariants, those
invariants win.

The deliverable is one platform and one authoritative data model. It must not
create a second Make/Google Sheets implementation beside the backend.

## 2. Actors and approval owners

- **Client:** discovers services, manages consent and profile facts, receives
  factual suggestions, buys message packages, uses coupons, and books services.
- **Expert:** maintains an approved catalogue profile, receives owner-scoped
  booking actions, manages availability, and buys residency.
- **Operator:** reviews catalogue, pricing, content, refunds, safety cases, and
  exceptional financial actions through authenticated, audited workflows.
- **LLM/Selarti:** classifies messages and proposes typed actions. It never
  directly mutates bookings, balances, coupons, referrals, or residency.
- **Backend/worker:** validates commands, owns transactions, emits outbox events,
  reconciles external effects, and produces projections.
- **Product/legal owner:** approves public claims, tariffs, personal-data policy,
  advertising treatment, offer, and first live behaviour.
- **Deployment owner:** separately authorizes staging or production activation.

## 3. Architecture spine

1. PostgreSQL is authoritative for identities, consent, catalogue, packages,
   ledgers, coupons, referrals, bookings, expert residency, approvals, inboxes,
   outboxes, and audits.
2. Every external mutation enters through an authenticated provider adapter and
   an idempotent inbox. Every external side effect leaves through a transactional
   outbox and a bounded worker.
3. Google Sheets and Make are optional outbound projections and notifications.
   They cannot accept authoritative commands or repair backend state.
4. Selarti and prompts may only request typed application actions. Application
   services re-authorize each action against current database state.
5. Planerka is a scheduling provider, not the booking ledger. Provider states are
   observations mapped onto backend reservation state with freshness and version
   checks.
6. Telegram expert callbacks are short-lived, signed/opaque, owner-bound,
   reservation-version-bound, and consumed atomically with the state transition.
7. Money-like values use append-only ledgers and versioned commercial terms.
   Mutable balance columns and silent historical tariff edits are forbidden.
8. All live provider paths start disabled and fail closed until contract evidence,
   credentials, reconciliation, observability, rollback, and human approvals exist.

## 4. Unified functional requirements

### 4.1 Client conversation and profile

- **UCP-CLIENT-01:** Preserve the `ии-Тоня` identity and factual, non-coercive
  information-assistant role in a versioned client prompt artefact.
- **UCP-CLIENT-02:** Collect profile facts progressively and only when relevant.
  Sensitive or inferred facts require purpose, provenance, confidence, consent,
  correction, export, and erasure handling. The system must not infer gender,
  wealth, health, family status, or exact location as authoritative truth.
- **UCP-CLIENT-03:** Search only approved, active, fresh catalogue entries using
  explicit client criteria. Recommendations must expose factual reasons and must
  not claim diagnosis, treatment suitability, or guaranteed outcomes.
- **UCP-CLIENT-04:** Crisis and high-risk language bypasses ordinary commercial
  flows and creates the existing safety handoff without charging a message.
- **UCP-CLIENT-05:** Check-ups, feedback, announcements, and post-visit messages
  are consented, frequency-capped, cancellable, and deduplicated.

### 4.2 Expert experience

- **UCP-EXPERT-01:** Add a versioned expert prompt that exposes only authenticated,
  owner-scoped schedule and booking views.
- **UCP-EXPERT-02:** Confirm, cancel, and reschedule actions must use current
  reservation versions and atomic callback consumption. Free-text prompt output
  cannot perform a transition.
- **UCP-EXPERT-03:** Expert catalogue onboarding and edits require approval,
  verification evidence, effective timestamps, and immutable audit facts.
- **UCP-EXPERT-04:** Expert-facing statistics must be derived from authoritative
  facts and must not disclose another client's profile or conversation content.

### 4.3 Booking and reminders

- **UCP-BOOK-01:** Reuse the existing reservation state machine and concurrency
  rules. The document's 72-hour hold becomes configurable policy, not prompt text
  or a Google Sheets timestamp.
- **UCP-BOOK-02:** Capacity, client overlap, expert overlap, freshness, ownership,
  and idempotency are checked inside the booking transaction.
- **UCP-BOOK-03:** Reminders are scheduled from backend state and emitted through
  the outbox. A provider replay cannot duplicate a notification or debit.
- **UCP-BOOK-04:** Waitlist and reschedule are separate typed workflows with
  explicit acceptance tests; neither may overwrite an existing booking in place.

### 4.4 Message packages, coupons, and client referrals

- **UCP-COMM-01:** Version package definitions and grant rules. The free
  introductory grant and paid package sizes are configuration approved by an
  operator, never hard-coded only in a prompt.
- **UCP-COMM-02:** Preserve the existing append-only message ledger and exact
  inbound/outbound charging semantics. Safety, system, error, and non-delivered
  messages remain non-chargeable.
- **UCP-COMM-03:** Model coupons as append-only grants, reservations, spends,
  expiries, reversals, and debts. `1 coupon = 1 RUB`, `2x`, `500`, and `90 days`
  are versioned commercial terms pending owner/legal approval.
- **UCP-COMM-04:** Client referral binding is immutable after the permitted
  onboarding window. Rewards settle only after authoritative first-payment
  settlement and reverse on refund/chargeback without producing a negative
  spendable balance.

### 4.5 Expert residency and referrals

- **UCP-RES-01:** Implement the already reviewed expert residency/referral design
  and its requirements as part of this unified release train.
- **UCP-RES-02:** Base, Exclusive, one-time onboarding, resident event commission,
  and non-resident event commission are versioned tariff components. Prices from
  the document are seeded only after commercial approval.
- **UCP-RES-03:** Checkout, payment settlement, reward grants, refund reversal,
  debt, quotas, revocation, and kill switches follow the existing provider-neutral
  design and reconciliation contract.
- **UCP-RES-04:** Claims such as immediate clients, fixed acquisition outcomes, or
  advertising-label exemptions are prohibited from published content unless
  legal/product approval records the exact wording and evidence.

### 4.6 Public landing page

- **UCP-WEB-01:** Add a static-first, responsive public landing application with
  client, expert, tariff, FAQ, contact, legal, and accessibility sections.
- **UCP-WEB-02:** Public prices, expert counts, availability, and links are served
  from an approved published-content snapshot; no browser request receives admin
  or provider credentials.
- **UCP-WEB-03:** Contact submission uses a narrow rate-limited API, explicit
  consent, minimal retention, spam controls, audit correlation, and no analytics
  tracker by default.
- **UCP-WEB-04:** SEO copy must remain factual. Placeholder legal details, social
  links, unsupported guarantees, and unapproved claims block publication.
- **UCP-WEB-05:** The visual direction starts from the warm neutral palette in the
  supplied brief but is implemented as design tokens with contrast, keyboard,
  reduced-motion, mobile, and performance checks.

## 5. Components and ownership

| Component               | Responsibility                                                                        | Must not do                               |
| ----------------------- | ------------------------------------------------------------------------------------- | ----------------------------------------- |
| `packages/domain`       | Pure commercial, referral, coupon, residency, waitlist, and content-publication rules | Network or database access                |
| `packages/application`  | Typed use cases, authorization, policy composition, prompt proposal validation        | Trust provider/prompt state               |
| `packages/db`           | Schema, repositories, transactions, ledgers, inbox/outbox, migrations                 | Provider calls                            |
| `packages/contracts`    | Versioned schemas for prompts, API, callbacks, and provider observations              | Business decisions                        |
| `packages/integrations` | Selarti, Planerka, Telegram, payment and projection adapters                          | Authoritative state mutation              |
| `packages/worker`       | Outbox delivery, reminders, expiry, reconciliation, retention                         | Unbounded retry                           |
| `apps/api`              | Authenticated ingress, public read/contact endpoints, health                          | Make/Sheets command ingress               |
| `apps/worker`           | Worker composition and lifecycle                                                      | Domain logic                              |
| `apps/web`              | Static-first public landing                                                           | Secrets or direct provider calls          |
| `prompts`               | Versioned client/expert policy and examples                                           | Credentials or executable financial rules |

## 6. Data flow

### Conversation and proposal

`Selarti webhook -> verified inbox -> conversation service -> prompt proposal ->
typed contract validation -> authorization/current-state check -> transaction ->
outbox -> provider delivery/reconciliation`.

### Booking

`catalogue search -> slot observation -> backend eligibility check -> reservation
transaction -> expert callback -> atomic consume/transition -> outbox -> Planerka,
Telegram, and projection delivery`.

### Commerce

`versioned quote -> idempotent checkout -> provider event inbox -> settlement
transaction -> package/coupon/residency/referral ledger facts -> outbox ->
reconciliation and projections`.

### Public content

`operator draft -> review/approval -> immutable published snapshot -> static build
or cache -> public page`. Draft or expired content never becomes public merely
because it exists in the database.

## 7. Error handling and recovery

- Reject schema, signature, identity, ownership, freshness, and replay failures
  before application mutation.
- Use stable idempotency keys and canonical payload hashes. Same key/different
  payload is a conflict, not a replay.
- Treat timeout-after-send as unknown outcome; reconcile before retrying.
- Apply bounded attempts, leases/fencing tokens, terminal dead-letter state,
  owner alerts, and manual replay approval.
- Roll back domain fact, audit, and outbox together on transaction failure.
- Keep per-capability kill switches for prompts, booking, payments, coupons,
  referrals, residency, reminders, projections, and public contact submission.

## 8. Privacy, safety, and content policy

- No credential, token, provider secret, health narrative, or full conversation is
  stored in prompts, logs, projections, fixtures, or Git.
- Optional sensitive profile fields are encrypted or separated from operational
  identifiers, purpose-bound, access-controlled, and covered by retention/erasure.
- Prompt regression fixtures include cross-client disclosure, medical/legal advice,
  manipulative sales language, unsupported guarantees, unauthorized mutations,
  crisis routing, and prompt-injection attempts.
- Esoteric catalogue categories may be displayed as user-selected service labels,
  but the assistant cannot present them as medical facts or evidence-based care.

## 9. Delivery slices

1. **Landing and checkout entry (release blocker):** deliver the public landing,
   approved tariff publication, authenticated expert entry, quote-to-checkout
   handoff, return states, and sandbox payment proof first. No payment provider
   can be considered usable until a human can reach and complete this path from
   the landing.
2. **Requirements and prompt baseline:** normalize the supplied material, add
   versioned client/expert prompts, proposal contracts, and regression fixtures.
3. **Existing expert residency/referrals:** integrate the already merged ledgers,
   APIs, Telegram/AI boundaries, sandbox provider, and YooKassa adapter into the
   landing checkout without duplicating their domain or database implementation.
4. **Client coupons/referrals:** add versioned terms and append-only lifecycle with
   settlement/refund reconciliation.
5. **Expert operations:** owner-scoped schedule, callbacks, reschedule, waitlist,
   reminders, and privacy-safe statistics.
6. **Release evidence:** prompt evals, prior-release diff checks, focused tests,
   CI container gates, security scans, staging contract tests, reconciliation,
   rollback drill, and named human sign-offs.

Each slice can merge behind disabled flags. No slice implies live activation.

## 10. Verification contract

- Unit/property tests for every pure commercial and state-transition rule.
- PostgreSQL integration tests for concurrency, idempotency, ledger conservation,
  inbox/outbox atomicity, settlement/refund, callback ownership, and migrations.
- Contract tests with sanitized fixtures for Selarti, Planerka, Telegram, payment,
  Make projection, and published-content schemas.
- Prompt regression, distribution/diff comparison against the prior prompt, and a
  named human spot-check before changing production AI behaviour.
- Landing tests for semantics, accessibility, keyboard use, reduced motion,
  responsive breakpoints, broken links, placeholder leakage, and performance.
- `pnpm verify`, one local focused concurrency run, CI-only 20x repeat gates,
  container smoke, release evidence/checksums, and cleanup verification.

## 11. Traceability and acceptance

Every `UCP-*` requirement must map in the implementation plan to changed files,
tests/evals, mandatory CI, release evidence, telemetry, rollback, owner, and human
approval point. Completion requires all of the following:

1. No authoritative Make/Sheets ingress exists.
2. All ledgers conserve value under replay, concurrency, refund, and reversal.
3. Booking actions remain owner-, version-, freshness-, and idempotency-bound.
4. Prompt actions cannot bypass application authorization.
5. Public content contains no placeholders or unapproved legal/commercial claims.
6. Required local checks and CI are green; skipped or unavailable gates are listed
   as blockers rather than treated as success.
7. Provider contracts are verified in staging with sanitized evidence.
8. Product/legal signs the commercial and public wording; a human signs the prompt
   spot-check; deployment owner separately authorizes production.
9. Rollback disables new flags and preserves ledger/audit facts; reconciliation
   reports no unexplained difference.

## 12. Explicit non-goals

- Production activation, provider credential creation, or provider-account changes.
- Treating Google Sheets or Make as a system of record.
- Guaranteed matching, diagnosis, treatment, income, client volume, or legal claims.
- Autonomous scraping or messaging of clients based on inferred sensitive traits.
- Silent migration of historical balances or bookings from unverified spreadsheets.

## 13. Test execution targets

The Windows Codex host has no Docker CLI or daemon. That does not make the
project's container gates unavailable: PostgreSQL Database Gate runs on
GitHub-hosted Docker, and the dedicated Claw Docker test service is available on
the approved remote test host. Local verification runs build, static, unit,
contract, and non-container tests; container-backed PostgreSQL, end-to-end,
sandbox checkout, and image gates run on GitHub Actions and/or Claw with retained
exit code, final summary, checksums, and cleanup evidence.
