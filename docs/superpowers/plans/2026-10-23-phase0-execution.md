# Phase 0 implementation plan

> **For agentic workers:** Use the two colocated implementation specs for bounded
> ownership and acceptance. Independent work is allowed only within Phase 0;
> review and integration remain sequential.

**Goal:** Prepare the existing residency platform for the approved Phase 1 flow.
**Architecture:** Keep existing PostgreSQL financial and privacy authority; add an
applicant queue foundation, deterministic Telegram deletion initiation, bounded
security telemetry, and verified non-settling payment notification handling.
**Tech stack:** Node24, pnpm11.9.0, TypeScript, Fastify, PostgreSQL17.5, Drizzle, Vitest.
**Specs:** `docs/superpowers/implementation-artifacts/spec-phase0-schema-foundation.md`
and `docs/superpowers/implementation-artifacts/spec-phase0-ingress-foundation.md`.

## Constraints

- Owner approval covers autonomous local execution and existing model plus application
  table; do not ask again for implementation approval.
- Work only in codex/phase1-owner-plan-20261023, based on
  031ae46065b58223a2b6cd47e002b388a41ec89c. Preserve primary checkout modifications.
- No deploy, push, provider calls, shared database migrations or live flag changes.
- Use exact pinned dependency graph; hand-author migrations; no schema generation.
- Focused tests only, bounded per AGENTS; no aggregate verification in the inner loop.

## Review focus

- Foreign quote bindings must fail in PostgreSQL, even if TypeScript is bypassed.
- Pending/capture-wait notifications cannot activate paid entitlement.
- Deletion commands must never reach conversation/promo/LLM routing when unavailable.
- Untrusted headers/error prose cannot escape through the new telemetry fields.
- Region cleanup must preserve actual operator addresses and original source evidence.

## Execution

- [x] Save owner plan as a separate local commit in the isolated tree.
- [x] Inspect the existing authority and report conflicts; record owner's schema choice.
- [x] Run environment preflight and frozen install; build required dependency packages.
- [x] P0.1: replace reviewed working-copy geography phrases, audit runtime/env/SQL/JSON
      matches without printing environment values, preserve legal/source records.
- [x] P0.2: RED migration tests, additive queue schema/SQL/journal/snapshot, GREEN real
      PostgreSQL tests, exact metadata/scope registrations and mapping report.
- [x] P0.3: RED command tests, owner-bound request adapter and both ingress routes,
      keyed security events, GREEN route/logger tests, documented manager boundary.
- [x] P0.4: RED capture-wait tests, authoritative verifier/capability, GREEN route and
      adapter tests, disabled placeholder-only local test profile.
- [x] Independent adversarial, edge-case and verification review; fix real findings.
- [x] Relevant lint/typechecks/format/diff checks; record exact local evidence and
      missing external gates. Commit implementation locally, without push.

## External gates

The owner has a test merchant and will supply its protected runtime configuration.
Local fixtures do not establish externally reachable HTTPS, a configured merchant
subscription, genuine test-payment delivery, processor erasure or verified backups.
Phase 0 cannot be called fully accepted or release-ready until those applicable
checks have evidence. Phase 1 critical dependencies must not be silently waived.
