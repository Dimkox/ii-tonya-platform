---
title: 'Expert Telegram Queries'
type: 'feature'
created: '2026-08-13'
status: 'done'
baseline_commit: '5d13cd80acff220ff39c0773a3706d099e67958c'
review_loop_iteration: 0
context:
  - 'docs/spec/normalized-requirements.md'
  - 'docs/security/threat-model-and-go-live-gates.md'
  - 'docs/testing/claw-container.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The expert Telegram boundary handles booking callbacks but not the promised `/schedule`, `/client`, and `/stats` reads, so experts lack a safe operational view of their own work.

**Approach:** Add a default-off command capability backed by PostgreSQL-authorized read models. Commands are private-chat only; `/client` selects an owned active reservation through a separate opaque single-use callback; Telegram only renders server facts.

## Boundaries & Constraints

**Always:** PostgreSQL rechecks active/verified Telegram binding and ownership in every query. `/schedule` covers the next seven days; `/stats` uses the preceding 30 days plus future active count. `/client` lists at most 20 active reservations and returns only display name, appointment time, service name, and a currently consented preparation note. Client reads atomically consume the callback and append a content-free audit event. Executable tests run only on Claw at 1 CPU/1 GiB; repeat only for changed concurrency and at most 3.

**Ask First:** Schema migration, dependency addition, live provider activation, client contact exposure, arbitrary stats range, merge, staging mutation, or deployment.

**Never:** Accept client/name/internal-ID command arguments; expose contacts, financial data, conversation history, other experts' facts, or client-level stats; route `view_client` through booking transitions; log updates, claims, client text, meeting URLs, secrets, or query results; enable `TELEGRAM_ENABLED`.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|---------------|----------------------------|----------------|
| Schedule | Authorized private `/schedule` | Owned active appointments through seven days; booked-only meeting URL | Empty is valid; invalid binding is unavailable |
| Client list | Authorized private `/client` | Up to 20 non-identifying buttons; `cv1` callback <=64 UTF-8 bytes, <=10-minute expiry | Empty owned set gets bounded copy |
| Client view | Fresh actor/reservation/version-bound `cv1` | Atomic consume, recheck, audit, and minimal view exactly once | Expired/stale/replayed/foreign/revoked are indistinguishable |
| Stats | Authorized private `/stats` | Safe counts for upcoming, completed, cancelled, and no-show | Overflow/integrity failure is closed; telemetry has no client facts |
| Disabled | Query flag false | Existing confirm/cancel callbacks unchanged; no query repository call | Bounded unsupported ingress; no outbound call by default |

</frozen-after-approval>

## Code Map

- `packages/application/src/booking-service.ts:getExpertSchedule` -- reuse schedule validation and minimized projection.
- `packages/application/src/expert-telegram-query-service.ts` -- new clock-owned query orchestration and output contracts.
- `packages/db/src/repositories/booking-repository.ts:listAuthorizedExpertSchedule` -- reuse embedded binding/ownership/consent SQL pattern.
- `packages/db/src/repositories/expert-telegram-query-repository.ts` -- new selector, aggregates, and atomic client consume/read/audit.
- `packages/integrations/src/telegram/callback-token.ts` and `packages/db/src/repositories/telegram-callback-repository.ts` -- mutation-only `ct2`; never widened.
- `packages/integrations/src/telegram/client-view-callback-token.ts` -- new `cv1` MAC domain and read-only claims.
- `packages/integrations/src/telegram/telegram-adapter.ts` and `expert-command-processor.ts` -- bounded keyboard/text rendering and exact command dispatch.
- `apps/api/src/routes/telegram-webhook.ts` -- private identity validation, `cv1` dispatch, rate limit, inbox-before-consume ordering.
- `packages/config/src/env.ts`, `apps/api/src/app.ts`, `apps/api/src/server.ts` -- fail-closed flag/capability composition while live Telegram stays disabled.
- `tests/integration/expert-telegram-queries.test.ts` -- PostgreSQL ownership, consent, replay/rollback/audit, and time boundaries.

## Tasks & Acceptance

**Execution:**
- [x] Add query-service contracts/tests, then PostgreSQL selector, aggregates, and atomic sensitive read/audit.
- [x] Add isolated `cv1` token/store contracts/tests without booking mutation authority.
- [x] Add adapter keyboard/views and command processor with exact-command, minimization, and transport tests.
- [x] Wire webhook/config/app/server with private-ingress, dedupe, rate-limit, and disabled-isolation tests.
- [x] Record Claw evidence, traceability, README/handoff, independent review, and Draft PR boundary.

**Acceptance Criteria:**
- Given an eligible bound expert, when each command arrives privately, then only that expert's minimized facts are rendered once.
- Given foreign, stale, expired, replayed, revoked, malformed, oversized, or overflow state, when processed, then output is sanitized and no forbidden read or mutation occurs.
- Given the flag is false or enabled without capability, when ingress/composition occurs, then it fails closed while existing booking callbacks remain unchanged.
- Given valid client-view state, when the database operation succeeds or rolls back, then consume, authorization, minimal read, and audit commit together or not at all.

## Spec Change Log

## Design Notes

`cv1` uses a distinct prefix and MAC domain from mutation token `ct2`. Prefix dispatch is not trust: the selected verifier authenticates the claims. Existing `notifications` and `audit_events` columns support the read invariant, so no migration is planned. The query path never calls `transitionFromTelegramCallback`.

## Verification

**Commands:**
- Focused Vitest in the existing Claw `ii-tonya-test` container -- causal RED before production code, then one GREEN.
- Claw PostgreSQL run of `tests/integration/expert-telegram-queries.test.ts` -- ownership, consent, replay, rollback/audit, and boundaries pass.
- Targeted application/db/integrations/api typecheck, ESLint, Prettier, and `git diff --check` on Claw -- clean exit.
- Independent exact-range Critical/Important review -- no unresolved blockers.

## Implementation status

| Acceptance matrix row | Status | Evidence |
|---|---|---|
| Schedule | Implemented and Claw-focused green | Application boundary tests, adapter tests, and traceability `EXP-BOT-003` |
| Client list | Implemented and real-PostgreSQL green | Max-20 selector, non-identifying keyboard, and `cv1` size/TTL tests |
| Client view | Implemented and real-PostgreSQL green | Foreign/stale/revoked/replay, minimal consented view, audit, and rollback cases |
| Stats | Implemented and real-PostgreSQL green | Fixed preceding-30-day and future-active aggregate case plus safe-count unit coverage |
| Disabled | Implemented and composed-app green | Default-off webhook isolation and enabled-without-capability startup failure |

Claw evidence: `docs/test-evidence/claw/5d13cd80-expert-telegram-queries/verification.md`.
Traceability: `docs/spec/expert-telegram-queries-traceability.md`.

Execution items 1–5 are complete. Independent review approved the final implementation;
the Draft PR boundary is recorded here while live activation remains separately gated.

## Suggested Review Order

**Ingress and isolation**

- Start with private command routing, deduplication, denial equivalence, and callback acknowledgement.
  [`telegram-webhook.ts:99`](../../../apps/api/src/routes/telegram-webhook.ts#L99)

- Confirm default-off composition rejects an enabled feature without an injected capability.
  [`app.ts:62`](../../../apps/api/src/app.ts#L62)

**Authorization and sensitive reads**

- Follow server-clock windows and minimized query orchestration.
  [`expert-telegram-query-service.ts:94`](../../../packages/application/src/expert-telegram-query-service.ts#L94)

- Inspect PostgreSQL-embedded binding, ownership, active-hold, consent, and aggregate predicates.
  [`expert-telegram-query-repository.ts:91`](../../../packages/db/src/repositories/expert-telegram-query-repository.ts#L91)

- Verify CAS consumption and audit commit atomically for the sensitive client view.
  [`expert-telegram-query-repository.ts:277`](../../../packages/db/src/repositories/expert-telegram-query-repository.ts#L277)

**Token and delivery safety**

- Review the separate Telegram-identity-bound `cv1` MAC domain and clock validation.
  [`client-view-callback-token.ts:126`](../../../packages/integrations/src/telegram/client-view-callback-token.ts#L126)

- Check explicit applied, before-write, ambiguous, and fresh-token recovery outcomes.
  [`expert-command-processor.ts:96`](../../../packages/integrations/src/telegram/expert-command-processor.ts#L96)

- Confirm timezone rendering, booked-only URLs, safe whitespace, and Telegram size bounds.
  [`telegram-adapter.ts:345`](../../../packages/integrations/src/telegram/telegram-adapter.ts#L345)

**Verification and release boundary**

- Read the real-PostgreSQL concurrency proof for exactly one view and audit.
  [`expert-telegram-queries.test.ts:292`](../../../tests/integration/expert-telegram-queries.test.ts#L292)

- Finish with requirement-to-test, telemetry, recovery, and approval traceability.
  [`expert-telegram-queries-traceability.md:11`](../../spec/expert-telegram-queries-traceability.md#L11)
