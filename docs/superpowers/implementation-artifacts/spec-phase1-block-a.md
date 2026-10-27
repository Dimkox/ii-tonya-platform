---
title: Private applicant promo registration and verification handoff
status: in-progress
context:
  - docs/superpowers/implementation-artifacts/spec-phase1-through-phase2-execution.md
  - packages/db/src/schema/expert-onboarding.ts
  - packages/application/src/test-expert-telegram-service.ts
---

## Contract

Implement P1.A1–A4 using existing PostgreSQL identity/consent authority and existing
campaign quotes, without financial credit from registrations. First authenticated
private `/start [promo_CODE]` allocates one reusable promo namespace code and binds
attribution once. Bot/update replay is durable; same Telegram identity counts once
across bots, self-attribution and rebinding are denied. Qualification at two creates
one pending guide delivery/content slot and one frozen100-point indication per
inviter, included within existing1000RUB qualified reward, never available credit.
A guide absent owner PDF remains `waiting_content`; pdf_sent changes only on actual
confirmed delivery. Expose applicant quote1/3-month via existing quote repository,
then owner-bound pending application using unexpired immutable quote. Manager
outbox contains IDs/masked facts only. Default runtime disabled; injected local
fixtures remain possible. Protect erasure and immutable ownership.

## Files and tasks

- Add hand-authored0052 SQL/journal and supported metadata/state evidence with new
  promo code, attribution, guide work and indication relations; add Drizzle schema
  and exports. Retain historical gaps and exact guard registrations.
- Add PostgreSQL applicant promo repository with transaction-safe commands and
  narrowly typed trusted identity inputs; reuse campaign quotes/application table.
- Add application service/Telegram ingress using private authenticated existing
  bot/update authority; include1/3-month selection and application handoff.
- Add focused tests before behavior; verify identity/replay/concurrency, no false
  PDF confirmation/no financial credit, immutable quote and ownership rejection.
- Run focused checks, independent adversarial/edge/verification review, fix findings,
  record evidence and local commit before Block B.

## Acceptance

Given two unique attributed active Telegram identities, when registration replays
or races, then exactly one pending guide and one100-point indication exist.
Given an absent PDF, when work is inspected, then no delivered flag exists.
Given any rebinding/self-attribution/wrong user/expired quote, when requested, then
no unauthorized mutation or disclosure occurs. Given an authenticated applicant
selects a supported existing quote, when handed to manager, then one owner-bound
pending application and masked queue fact exist. Registrations never alter any
financial ledger or coupon balance.

## Verification checkpoint

Source and independent reviews accepted; no release or block-complete claim.
New focusedPGfile used all3 invocations, final14/15. Expiredquote fixture had an
untyped JSON parameter42P18; explicit `::text` correction is source-reviewed but
unrun. Exactly one additional invocation requires explicit owner authorization.
Do not start Block B until this critical predecessor verification gate closes.

## Local verification checkpoint

Owner-authorized coordinator invocation5 passed15/15 on fresh ownedPG17.5.
All invocations consumed; do not rerun6. Localblockgate closed, externalrelease
acceptance remains open. See docs/test-evidence/phase1-block-a-2026-10-23.md.
