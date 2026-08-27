# ER-TG-004 Expert Residency Tariff Discovery Design

**Status:** approved for implementation
**Date:** 2026-08-14
**Owner:** Dmitry
**Base:** `3340fc7e706c64ad0a2de185cd9088f2152ebf44`

## Objective

Let an authenticated active expert discover the currently effective residency tariff
versions before requesting an authoritative quote. The HTTP API exposes a read-only
tariff list and private Telegram `/residency` renders the same bounded server facts.
Existing `/residency <tariffVersionId>` quote and checkout behavior remains unchanged.

## Selected approach

Add one bounded query to the residency repository and expose it through
`ExpertResidencyService`. The service reauthorizes the expert-to-user ownership for each
request before querying. HTTP and Telegram consume that service result; neither computes
prices, invents tariff identifiers, or calls checkout/payment providers.

No Telegram callback is added. The list displays each server-issued UUID so the expert
can use the existing `/residency <UUID>` command. This avoids widening `xr1`, `cv1`, or
`ct2` and keeps discovery read-only.

## Stable requirements

- **ER-TG-004-R1 — Authoritative list.** PostgreSQL returns only tariff versions whose
  `active_from <= now < active_to`, ordered by `active_from`, then immutable UUID, with a
  hard server limit of 20.
- **ER-TG-004-R2 — Fresh authorization.** Every discovery call rechecks an authenticated
  principal, the expert-to-user ownership binding, and active/eligible expert state.
  Foreign, inactive, suspended, or missing experts receive a bounded forbidden result.
- **ER-TG-004-R3 — Minimal facts.** A tariff item contains only `tariffVersionId`,
  `displayName`, `priceMinor`, literal `RUB`, and `durationSeconds`. Telegram and HTTP do
  not accept client price, credit, cash, provider, payment, or checkout fields.
- **ER-TG-004-R4 — Deterministic read surfaces.** `GET
  /v1/expert/residency/tariffs` and private `/residency` return the same ordered list.
  Telegram renders a bounded message within 4,096 characters and does not mutate state.
- **ER-TG-004-R5 — Compatibility.** `/residency <UUID>`, referral views, checkout
  readiness, and callback namespaces retain their existing behavior and idempotency.
- **ER-TG-004-R6 — Fail closed.** Existing expert residency and Telegram financial-view
  feature flags remain default-off. Enabled composition without the complete residency
  query/view capability fails closed; no live bot, provider, credential, or production
  activation is introduced.

## Data flow

1. HTTP bearer resolution or Telegram webhook resolution supplies a fresh principal.
2. `ExpertResidencyService.listActiveTariffs(principal)` verifies ownership.
3. The repository checks current database time, expert eligibility, feature control, and
   active tariff bounds in one read transaction.
4. HTTP returns the bounded list, or Telegram passes it to
   `sendResidencyTariffs` for deterministic rendering.
5. An expert may then use the existing `/residency <UUID>` quote command.

## Error and recovery behavior

- Missing authentication returns HTTP 401 or Telegram unavailable before query access.
- Foreign/inactive expert returns forbidden/unavailable without rendering tariff facts.
- Disabled residency returns the existing disabled result and does not query tariffs.
- Invalid database money, currency, duration, timestamp, or oversized text fails closed.
- An empty active set is a successful empty list with explicit Telegram copy.
- Discovery has no external side effect, so retry repeats only a bounded authoritative
  read and never creates a checkout or provider operation.

## Verification and release boundary

TDD covers application authorization, HTTP authentication/result mapping, Telegram
command routing/rendering, repository filtering/order/limit, and compatibility with the
UUID quote path. One final focused Claw gate is allowed after local GREEN; no repeats,
GitHub Actions, image build/prune, production operation, live Telegram, or payment call.
Independent review must clear all Critical and Important findings before push or merge.
