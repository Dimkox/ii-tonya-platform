# Hybrid Message Gateway B Implementation Plan

> **Execution:** use `superpowers:subagent-driven-development`; exactly one
> implementation owner writes product files and independent reviewers inspect the exact
> diff.

**Goal:** Make the platform the only Telegram webhook owner for an enabled client bot,
route deterministic work locally, send only allowlisted complex dialogue to Selarti, and
deliver every reply through the same Telegram chat without giving either provider
authority over identity, billing, booking, or financial state.

**Spec:** `docs/superpowers/specs/2026-08-28-free-client-hybrid-platform-v2-design.md`

**Architecture:** Telegram updates enter an authenticated, replay-safe inbox and resolve
through a tenant-scoped external identity binding before any message or ledger mutation.
The platform records a versioned routing decision. Local outcomes and validated Selarti
proposals converge on one transactional Telegram outbox whose per-dialogue sequence is
allocated in PostgreSQL. Selarti is an outbound AI dependency only; its live transport
and response webhook stay disabled until official authenticated fixtures and
reconciliation semantics are approved.

## Global constraints

- Telegram private text messages are the only client channel enabled by this release;
  expert commands and callbacks keep their existing isolated paths.
- No `.env` or credential reads, provider activation, production mutation, deployment,
  merge, or protected-branch push.
- `CLIENT_TELEGRAM_INGRESS_ENABLED=false`, hybrid routing, Selarti transport, and client
  Telegram dispatch all default to disabled and fail closed independently.
- A Telegram `update_id` is deduplicated before route/debit/outbox effects. Replaying the
  same identity with a different payload is a conflict, not a second attempt.
- External Telegram IDs and Selarti thread/chat IDs never substitute for internal user or
  dialogue UUIDs.
- Every durable provider request and send uses a stable idempotency key. Ambiguous send
  outcomes enter reconciliation and are never blindly duplicated.
- Route and cost telemetry use fixed-cardinality labels and never contain raw dialogue
  text, tokens, chat IDs, or user IDs.

## B1 — Authenticated Telegram ingress, identity, and route decision

**Files:** migration `0034`, Drizzle schema/repositories, application ports/service,
Telegram webhook route/composition, config, focused unit/PostgreSQL/contract/security
tests.

- [ ] RED: authenticated private text from an active bot-scoped identity binding is
      accepted once; duplicate delivery produces no second route, debit, or outbox row.
- [ ] RED: unknown, unresolved, blocked, cross-bot, group, malformed, stale, oversized,
      and control-character inputs fail closed before message/financial mutation.
- [ ] Add tenant-safe `channel_identities`, `dialogues`, immutable `dialogue_inbound`, and
      versioned `dialogue_route_decisions` with bounded states and uniqueness constraints.
- [ ] Atomically claim the Telegram update, resolve `(provider, bot_key, external_user,
      external_chat)`, record canonical inbound, and select a typed route.
- [ ] Deterministic commands/FAQ/safety/unsupported inputs never create Selarti work.
      Only `complex_dialogue` creates a minimal `selarti.request.v1` outbox envelope with
      internal IDs, bounded text, locale, prompt version, deadline, and correlation ID.
- [ ] Preserve the ordinary-client free-access policy; no package debit is introduced by
      Release B.

## B2 — Selarti proposal convergence and ordered same-chat delivery

**Files:** Selarti provider-neutral port/codec, response ingress, Telegram delivery
outbox/repository, worker dispatch/reconciliation, tests.

- [ ] RED: Selarti response resolves by stable request ID and tenant binding; arbitrary
      authority fields, instructions, credentials, control characters, unapproved URLs,
      overlong text, mismatched thread, duplicate response, and late response are rejected.
- [ ] Store the accepted response as a proposal, never execute it as an application
      command, and enqueue `telegram.send_text.v1` for the original dialogue.
- [ ] Allocate a monotonic `dialogue_sequence` transactionally for local and Selarti
      replies. Workers may parallelize across dialogues but may claim only the lowest
      unfinished sequence in each dialogue.
- [ ] Telegram delivery records `applied`, retryable `not_applied`, or
      `unknown_outcome`; timeout-after-send retains the sequence barrier until bounded
      reconciliation/operator resolution.
- [ ] Prove deterministic and Selarti-assisted messages reach one bot/chat in order and
      that no direct Selarti-to-Telegram send path exists.

## B3 — Cost admission, reconciliation, and rollout controls

**Files:** migration/schema, Selarti budget repository/service, metrics, runbooks,
rollback probes, tests.

- [ ] Add request cost reservations and immutable actual-usage reconciliation keyed by
      Selarti request ID. Unknown outcome retains its reservation.
- [ ] Atomically enforce the lower of the approved RUB cap and 10% of trailing-30-day
      settled expert-residency revenue, including Selarti's configured `+10%` USD/RUB
      uplift and worst-case billable units.
- [ ] Add per-user and global warning/soft/hard stops with deterministic fallback or
      operator handoff; no paid call occurs above the hard stop.
- [ ] Expose fixed-cardinality route, offload, latency, budget, delivery, replay, and
      reconciliation metrics plus bounded operator audit facts.
- [ ] Cut over one test bot only after authenticated Telegram evidence, captured official
      Selarti request/response fixtures, webhook authenticity or private receiver control,
      cost reconciliation, rollback probes, and exact-SHA external checks pass.

## Verification and release evidence

- [ ] For each vertical slice, run focused RED/GREEN unit and PostgreSQL tests, relevant
      typechecks/lint, and `git diff --check`.
- [ ] Before branch completion run one full `pnpm verify`, preserve the raw log, and bind
      the result to the exact HEAD SHA.
- [ ] Update README current state, connectivity graph, activation contract, traceability,
      rollback, `decisions.md`, and `mistakes.md` where applicable.
- [ ] Run independent architecture, code, test, security, and release-readiness reviews on
      the exact HEAD. External Trust CI and signed gates remain authoritative for merge.

## Deferred channels

VK, WhatsApp, Viber, Max, voice/media ingress, and live Selarti activation are separate
increments. They must reuse the canonical identity/dialogue/router/outbox contracts but
require their own authenticated provider fixtures, delivery reconciliation, privacy,
rate-limit, and rollout evidence.
