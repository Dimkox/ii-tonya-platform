# Client Terms and «тест эксперт» Trial — Design Amendment

**Date:** 2026-08-30
**Status:** Approved for implementation planning; implementation remains disabled in this Phase 0
**Owner:** Project owner
**Extends:** [`2026-08-28-free-client-hybrid-platform-v2-design.md`](2026-08-28-free-client-hybrid-platform-v2-design.md) and [`2026-08-30-partner-commerce-and-acquisition-economics-design.md`](2026-08-30-partner-commerce-and-acquisition-economics-design.md)

## 1. Purpose and authority

This amendment records the clarified client terms and the bounded `тест эксперт` acquisition trial. It supersedes only the exact rules named in section 2; all other V2 and Partner Commerce rules remain authoritative. It is a design and traceability document, not an activation approval for Selarti, Telegram, YooKassa, Planerka, coupons, or production tariffs.

## 2. Superseding rules

1. Newly issued paid/admin message packages expire exactly 30 calendar days after `granted_at`. Existing rows retain their stored `expires_at` and historical meaning. The intro package is exactly 100 messages and has no expiry. `free_client_v2` remains free, is not re-gated, and does not reactivate paid client-package sales or provider flows.
2. New client coupon grants, only after the deferred default-off coupon subsystem is separately activated, expire exactly 45 calendar days after grant. Existing/historical coupon rules remain facts. The current backend has no active coupon issuance; public copy must not claim that it does.
3. The dedicated `тест эксперт` campaign has an absolute cap of 100 visible dialogue messages per redemption. One accepted user message reserves 2 ledger units: one inbound unit and at most one outbound Selarti answer. Therefore the V1 maximum is 50 complete AI turns. Deterministic Telegram/backend messages consume zero units. Duplicate request keys consume zero additional units. A definite pre-send failure releases both units; an unknown outcome after provider send retains both until reconciliation. V1 forbids multi-answer and multi-provider fan-out.

## 3. Bounded architecture

PostgreSQL is authoritative for immutable campaign versions, redemptions, reservations, provider outcomes, counters, and audit facts. The invariant is `consumed_units + reserved_units <= 100`; every transition is idempotent and serialized by a redemption lock. The ledger is a separate bounded context from client coupons, expert referral credit, partner acquisition counts, and B3 Selarti cost reservations.

Redemption idempotency keys are namespace-bound as `test-expert:<campaign-version-id>:<internal-user-id>`; callers never reuse coupon, referral, partner, or B3 keys. Repository summaries are bounded informational reads only and are never admission authority; reserve and outcome transactions enforce every mutable invariant.

The deterministic Telegram/backend boundary handles `/start`, the `тест эксперт` entry phrase, identity binding, consent, warmup, qualification, participant segmentation (`EXPERT`, `CENTER`, `ORGANIZER`), tariff lookup, FAQ, limits, and all error/fallback responses. Prices come only from the existing expert/partner policy services. Selarti is invoked only for residual free-form questions and sales dialogue after a committed reservation; Selarti cannot choose a participant kind, price, tier, referral owner, entitlement, payment state, or booking state.

The existing functional expert AI source prompt is preserved as an inactive, immutable versioned asset/manifest with digest, source reference, and version metadata. No active production row or runtime selection is created until the new prompt copy and official Selarti contract are approved.

## 4. Data and outcome contract

The never-remotely-shipped additive migration is `0038_test_expert_trial.sql`. Before release, the former `0039` hardening draft was folded into `0038` and its journal entry removed; no deployed upgrade is claimed. It creates prompt-asset, campaign, bot/chat-scoped session, redemption, reservation, outcome, and append-only audit records with foreign keys, named checks, unique idempotency keys, and indexes for locked counters and global unknown scans. Counters and session state are database-owned; prompt text, Redis, and cached values are never authority.

For one provider request, the lifecycle is:

```text
available -> reserved(2) -> consumed(2)
                         -> released(2) for definite not-applied
                         -> retained(2) for unknown until reconciliation
```

The authenticated client Telegram webhook is the sole entry boundary. It binds bot, private chat, and Telegram user to exactly one internal identity, rate-limits before reservation, and creates `telegram.send_text.v1` for every deterministic response in the same dialogue. Durable session state permits prefixless follow-ups and fails closed on ambiguity. A missing/inactive campaign, missing approved prompt asset or official-contract evidence, identity mismatch, database failure, unavailable policy service, or unverifiable cap fails closed without a provider request.

Residual questions never dispatch a provider directly. The transaction reserves two units, uses B3 cost admission, and enqueues at most one durable `selarti.request.v1` with a stable provider request ID. Existing B2 response convergence atomically creates the same-dialogue Telegram delivery and changes reserved units to consumed. A definite pre-enqueue failure releases both units; enqueue/commit ambiguity retains them as unknown. A bounded age/limit scanner reconciles durable response facts, preserves unresolved rows, and releases only after the request deadline expires without a response.

## 5. Configuration, privacy, and operations

All new flags are default-off and must be independently observable: `TEST_EXPERT_PROMO_ENABLED`, `TEST_EXPERT_DETERMINISTIC_FLOW_ENABLED`, `TEST_EXPERT_SELARTI_ENABLED`, and `TEST_EXPERT_PROMPT_VERSION`. The prompt-version environment value is compatibility metadata, not activation authority. Promo plus deterministic flow may enable zero-unit responses without Selarti or a prompt. Enabling residual admission additionally requires an unambiguous active PostgreSQL campaign linked to an approved database prompt asset with official-contract evidence, operational B1/B2/B3 capabilities, and a required metrics sink.

Actual transition metrics include redemptions, deterministic messages/offload, reserved/consumed/released/unknown units, cap rejections, duplicate requests, provider outcomes, and reconciliation age. Conversion and cost are emitted only where a durable source fact exists. Logs, trial/session tables, audit facts, and replay records contain bounded identifiers, digests, provider-operation metadata, and outcome codes only; no raw message or provider response body is copied there. Raw residual text exists only in the already retention-governed `selarti.request.v1` outbox required by B1/B2 and remains an activation privacy gate; retained identifiers and digests follow the existing erasure boundary.

Rollout is additive with all flags off, then internal allowlist, bounded cohort, and only later provider admission. Rollback disables provider admission first, drains/reconciles unknown reservations, disables campaign routing, and preserves immutable history. No destructive migration, historical expiry rewrite, prompt overwrite, network/provider call, production mutation, or analytics/static-script removal is allowed.

## 6. Acceptance criteria for the later implementation

- New paid/admin grants use 30 days; intro grants remain 100/no-expiry; existing rows are unchanged.
- Future coupon grants use 45 days only when coupon issuance is activated; current deferred state and truthful copy are explicit.
- Concurrent requests cannot exceed 100 units, duplicate keys are free, and unknown outcomes are never optimistically released.
- Deterministic warmup, qualification, segmentation, and price calculation use zero trial units and authoritative backend policy services.
- One accepted residual question produces at most one Selarti request and one answer in the same dialogue.
- Functional expert AI code remains available but inactive until prompt/provider approval.
- Focused unit, API, repository, migration, concurrency, privacy, and PostgreSQL tests cover every transition and failure state.
