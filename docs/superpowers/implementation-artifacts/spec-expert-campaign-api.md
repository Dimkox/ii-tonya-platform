---
title: Authenticated saved-quote expert API
type: feature
created: 2026-10-12
status: in-progress
baseline_commit: 690797db64fd80aa1aeccea8003543de470d8c16
context:
  - "{project-root}/AGENTS.md"
  - "{project-root}/docs/agents/expert-residency-team.md"
  - "{project-root}/docs/superpowers/plans/2026-10-12-expert-campaign-api.md"
---

## Intent

Connect existing immutable campaign quotes and orders to the ordinary authenticated
expert HTTP entrypoint. The owner delegated technical choices for completing the
commercial product. This is an implementation increment, not human acceptance or
release completion. Current routes still accept tariffVersionId at checkout;
ordinary server construction supplies no expertApi. Eliminate those two gaps.

## Boundaries & Constraints

PostgreSQL remains the sole financial authority. Reuse existing campaign quote
and order repositories unchanged. Never recalculate price at checkout, accept
caller identity/money/time, promote client tokens, rewrite old orders or change
tariffs. Saved price is not the cash component: preserve referral credit.
No written consent/signature entrance gate. No catalogue insertion, provider
request, production operation, commit/push or nested agent. Preserve dirty work.

This increment does not enable payment providers. An unavailable provider must
produce explicit unavailable status, never a fabricated payment URL or successful
payment. The complete product still needs browser controls, quote-bound Telegram,
verified receipt contact capture and actual YooKassa composition/reconciliation.
Do not mark any of those satisfied by this API increment.

## Interface and I/O

Create createExpertCampaignService with server-derived ExpertPrincipal and ports
for active-owner lookup, tariff listing, immutable quote creation, quote-bound
order creation, and optional existing ResidencyCheckoutProvider. It exposes
listActiveTariffs(principal), quote(principal, ExpertCampaignQuoteRequest), and
checkout(principal, ExpertCampaignCheckoutRequest). Add a literal discriminator
for the campaign variant so existing legacy service consumers stay type-safe.
Return full saved quote facts including id, term, price breakdown and expiry.
Tariff prices must be explicitly identified as base prices, not a final offer.

The existing /v1/expert/residency/quotes route consumes exactly the committed
expertCampaignQuoteRequestSchema: tariffVersionId, termMonths and idempotencyKey.
The /checkouts route consumes exactly expertCampaignCheckoutRequestSchema:
quoteId and idempotencyKey. New ordinary composition selects campaign semantics;
do not infer a quote from a legacy tariff-only checkout body. Keep legacy injected
service compatibility where required, without using it in the default factory.

Checkout with no provider capability returns503 payment_unavailable BEFORE
creating a new order or reservation. With a trusted supplied provider, use only
the returned order.id/cashMinor/currency and its same command idempotency key;
do not call the provider for settled/failed/expired/refunded/charged_back orders.
Expose actual persisted order status, never relabel replay as payment_pending.
Provider exceptions are content-free unavailable outcomes; a persisted pending
order remains retryable by its original key. No fake automatic settlement.

## Tasks & Acceptance

- [ ] Given no bearer, client bearer, revoked session, duplicate authorization,
      wrong owner or inactive/unverified expert, every command denies without
      quote/order/provider side effects. Use existing expert session resolver.
- [ ] Given authenticated active owner, quote stores original server anchor,
      returns saved id/expiry/term and replays unchanged under the same key.
- [ ] Given forged price, identity, timestamp, unknown fields, malformed money
      or legacy tariff-only checkout, return400 and perform zero commands.
- [ ] Given valid saved quote and available trusted provider, order creation
      receives only trusted user/expert plus quoteId/key. Provider receives only
      saved cash, id and currency. Same key preserves order and provider identity.
- [ ] Given unavailable provider, return503 before reservation. Given terminal
      order replay, return its real status without another provider call.
- [ ] Given campaign domain conflicts, return bounded409/403/503 public errors,
      not SQL/provider details. Add no-store and bounded request/rate limits;
      duplicate header and oversized request rejection precedes business effects.
- [ ] Given ordinary createDefaultLifecycle().dependencies with enabled session
      and expert billing flags, construct real expertApi using actual DB quote,
      order, referral and ownership dependencies. Missing session capability fails
      startup. Keep existing app startup guards and provider activation ceilings.
- [ ] Verify the ordinary lifecycle with real synthetic PG and signed Telegram
      session, not only a hand-injected principal. Prove quote persistence and
      unavailable-provider zero-order behavior through HTTP. Separately prove
      provider-port amount/status mapping with a local recording double.

## Code Map and Ownership

One implementer owns this coupled service/transport/composition change:
new packages/application/src/expert-campaign-service.ts and its barrel export;
apps/api/src/routes/expert-referral.ts; new apps/api/src/expert-campaign-composition.ts;
targeted apps/api/src/server.ts and app.ts changes only as required; new thin
DB read adapter if existing queries cannot provide active ownership, tariff list
and referral summary, plus its barrel export. Existing real referral repository
and createExpertReferralService must be reused, not replaced with always-deny
dummies. API-facing service type may be narrowed so no fake reconciliation port
is needed. Preserve legacy application service and other callers.

New tests only: packages/application/src/expert-campaign-service.test.ts and
tests/integration/expert-campaign-api.test.ts. Evidence:
docs/test-evidence/expert-campaign-api-2026-10-12.md. No edits to financial fix
repositories, auth implementation, migrations, old exhausted tests or web files.
If a required authority change exceeds this boundary, report exact dependency
before expanding; never bypass it. Main owns AGENT-STATUS and shared runbooks.

## Verification

Run RequireDocker environment preflight before implementation. Use retained
synthetic PG17.5 only. Each new file has3 total runs: author RED1 and GREEN2,
coordinator reserves3 after review. Record collection/setup failures as runs.
No full/multi-path suite, copied financial regressions, hidden retries, real
provider calls or cap reset. Existing campaign87 cases and auth PG/browser remain
unrun after fixes; this new API evidence cannot close those gates.
Build/typecheck affected packages and tests; scoped lint/format/diff checks.
Independent review required. No new dependency or migration is expected.
