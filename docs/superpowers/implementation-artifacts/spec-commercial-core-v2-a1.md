---
title: "Commercial Core V2 A1"
type: "feature"
created: "2026-08-28"
status: "approved"
baseline_commit: "afc9eebfad77a730454fe2cc783595ff01c3dec0"
review_loop_iteration: 0
context:
  - "docs/superpowers/specs/2026-08-28-free-client-hybrid-platform-v2-design.md"
  - "README.md#unit-economics-planning-calculation"
  - "docs/security/threat-model-and-go-live-gates.md"
---

<frozen-after-approval reason="owner approved free-client hybrid V2 in chat on 2026-08-28">

## Intent

**Problem:** The current conversation path package-blocks ordinary clients and expert
residency orders hard-code a 50% referral-credit ceiling. The approved V2 model requires
free client access and effective-dated 3,900/5,900/9,990 RUB tariffs whose new orders cap
credit at 30%, without rewriting legacy financial facts.

**Approach:** Add immutable client commercial-policy assignments, an audited admission
control, tariff/order policy and entitlement snapshots, and a policy-aware conversation
billing path. Preserve every legacy default and keep all live integrations and V2
admission disabled until later release gates.

## Boundaries & Constraints

**Always:** Existing clients default to `legacy_package_v1`; a V2 assignment is immutable;
already assigned V2 clients remain free when admission closes; message events still append
zero-delta `free` ledger facts; legacy tariff/order rows retain a 5000-bps snapshot; V2
tariffs require 3000 bps and exact server-owned entitlements; admin approval and session
facts create or change commercial controls and tariff versions. `group_event_limit` is a
publication quota within the paid residency order's 30-day period, not a count of
concurrently active events.

**Ask First:** Live feature activation, production tariff publication, provider call,
credential use, destructive migration, historical ledger rewrite, merge, staging, or
production deployment.

**Never:** Trust prompt, Telegram, browser, Make, Sheets, or client payload for policy,
price, entitlement, credit cap, balance, approval, or settlement. Never package-block an
assigned V2 client. Never alter a settled order snapshot.

## I/O & Edge-Case Matrix

| Scenario             | Input / state                                                          | Expected behavior                                                                    | Closed failure                                       |
| -------------------- | ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------ | ---------------------------------------------------- |
| Legacy client        | no assignment; V2 admission disabled                                   | immutable legacy assignment; existing package gate and debit semantics               | repository failure returns dependency unavailable    |
| New V2 client        | no assignment; approved free admission and environment ceiling enabled | immutable `free_client_v2`; ordinary inbound/outbound records zero-delta `free` fact | conflicting control/version aborts transaction       |
| Existing V2 rollback | V2 assignment; admission later disabled                                | client stays free; no package lookup controls access                                 | no fallback to legacy package gate                   |
| Duplicate message    | replayed provider IDs                                                  | one message event and one zero/negative ledger fact according to assigned policy     | different canonical payload is conflict              |
| Legacy tariff        | existing row/order                                                     | 5000-bps cap and existing snapshots remain valid                                     | malformed legacy row fails closed                    |
| V2 tariff            | approved V2 admin command                                              | exact policy, 3000-bps cap and entitlements stored and exposed                       | any other price/cap/duration/entitlement rejected    |
| V2 checkout          | available credit exceeds 30%                                           | quote/order reserves floor(price × 3000 / 10000) at most                             | cash + credit mismatch rejected in DB                |
| Disabled runtime     | every new flag false                                                   | existing behavior unchanged; no V2 admission or provider activity                    | enabled composition without capability fails startup |

## Code Map

- `packages/domain/src/expert-referral.ts` — configurable basis-point residency quote.
- `packages/db/migrations/0032_commercial_core_v2_a1.sql` — additive policy, tariff, and
  order snapshots plus compatibility constraints.
- `packages/db/src/schema/commercial-policy.ts` — commercial admission and immutable
  client assignment schema.
- `packages/db/src/repositories/client-commercial-policy-repository.ts` — serializable
  resolve-or-assign operation.
- `packages/db/src/schema/expert-residency.ts` and
  `packages/db/src/repositories/expert-residency-repository.ts` — V2 tariff snapshots and
  quote/order cap ownership.
- `packages/application/src/ports.ts` and `conversation-service.ts` — policy-aware free or
  package billing orchestration.
- `packages/config/src/env.ts` — default-off V2 admission ceiling.
- `apps/api/src/routes/expert-referral-admin.ts` — exact approved V2 tariff/control admin
  commands.
- Focused unit tests beside each module and PostgreSQL coverage under `tests/integration/`.

## Tasks & Acceptance

- [ ] Add configurable quote cap with legacy 5000-bps compatibility and V2 3000-bps tests.
- [ ] Add additive migration/schema for commercial controls, immutable client assignments,
      tariff entitlements/policy/cap, and order snapshots.
- [ ] Add audited admin commands for V2 admission and V2 tariff creation.
- [ ] Add serializable client policy resolution and policy-aware free conversation billing.
- [ ] Expose authoritative V2 tariff facts through existing HTTP/Telegram discovery and
      checkout boundaries.
- [ ] Run focused unit/PostgreSQL checks, independent review, and exact-SHA CI/Database
      Gate without provider activation.

## Acceptance Criteria

- Given V2 admission is closed, a client without an assignment receives an immutable
  legacy assignment and existing package behavior.
- Given approved V2 admission is open, concurrent first messages create exactly one V2
  assignment and every completed ordinary message writes exactly one zero-delta free fact.
- Given V2 admission later closes, an already assigned V2 client remains free.
- Given a V2 tariff price, cap, and entitlement payload, only 390000/590000/999000 minor
  units, 3000 bps, 2592000 seconds, and the exact approved entitlement combinations pass.
- Given V2 checkout credit exceeds the cap, quote and stored order use at most floor(30%
  of price), and DB constraints prove cash plus credit equals price.
- Given legacy rows and fixtures, migration, quote, checkout, refund, and reconciliation
  behavior remains compatible at the 5000-bps snapshot.
- Given every V2 and provider flag is false, startup and all existing focused tests retain
  current behavior with no external call.

</frozen-after-approval>

## Verification

- Domain RED/GREEN and property tests for 0, 3000, 5000, and 10000 bps.
- Config, application, repository, admin-route, HTTP, and Telegram focused Vitest.
- Real PostgreSQL migration compatibility, concurrent assignment, free-message dedupe,
  V2 checkout, legacy checkout, and constraint tests; at most three focused repeats.
- Package typechecks, ESLint, Prettier, `git diff --check`, independent adversarial review,
  exact-SHA CI, and Database Gate.

## Release Boundary

A1 is code and evidence only. V2 admission, tariff publication, expert referral maturity,
client coupons, live payment, Selarti, Telegram, Planerka, staging, and production remain
disabled. A2 expert-referral maturity must land before any V2 residency activation.
