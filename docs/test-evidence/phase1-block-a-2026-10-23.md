# Phase1 Block A local implementation evidence

Status: corrected expired-quote fixture awaiting explicit extra-run authority. Baseline:
`8b41802cd0156f8596fbf0e1ba67890f2ed969f2`.

Reviewable source WIP commit: `2ceedcf92052f1d51e502a08cc5e8520022f6e93`.
Corrected fixture: `tests/integration/phase1-promo.test.ts:335`, explicit
`${randomUUID()}::text`. Independent source reviewer accepts the cast and finds
no remaining untyped interpolations; no runtime probe was performed. Post-correction
fixture scoped lint/format, tests TypeScript and whitespace passed. All child file
owners and reviewers have ended; only the explicit extra-run answer is pending.

## Scope and behavior

P1.A1–A4 add a separate default-off private promo bot capability. First-time users
receive a current approved PostgreSQL consent document and an explicit bound-token
choice before registration. Missing or oversized approved content remains inactive
`TODO: Wait for Content Spec`; it never creates a consent grant. Pending enrollment
retains the first deep-link candidate, including while content is unavailable.
Fresh requests can renew an expired pending presentation without reviving blocked,
denied, ambiguous or erased identities. No silent account merge occurs.

Reusable128bit `promo_` codes are separate from coupons and qualified single-use
expert codes. Unique Telegram identity/owner binding and numeric receiving-bot/update
receipts are PostgreSQL authority. Changed command, owner or digest conflicts fail
closed. Erasure removes direct identity/candidate/queued work and leaves minimal
transport tombstones so accepted old updates cannot resurrect an erased account.

Two unique eligible registrations enqueue one waiting-content guide and one100-point
frozen indication. No registration creates available referral credit, cash, coupons,
residency or qualified settlement. The indication is superseded by the existing
qualified1000RUB reward, never added to it. PDF content is absent; no PDF delivery is
claimed and no sender is activated. This does not prove an operating margin.

`/tariffs` exposes server-owned version choices; `/tariff VERSION 1|3` reuses the
existing immutable campaign quote engine inside the authenticated transaction.
`/apply QUOTE` accepts only an owned unexpired quote and creates one pending
application plus masked manager work. No questionnaire content is fabricated.

## Verification ledger

- Environment preflight: Node24.22.0/pnpm11.9.0 PASS; isolated PostgreSQL17.5.
- New application file: initial RED→GREEN15, review corrections RED→GREEN17,
  enrollment RED→GREEN21, captured-input RED→GREEN23, tariff discovery
  RED→GREEN24, oversized-notice RED→GREEN25. Final25/25 PASS.
- New dedicated webhook: RED→GREEN9; real per-user limiter regression RED→GREEN10.
- New config: RED→GREEN15; shared-secret isolation regression RED→GREEN16.
- New composition: RED→GREEN8, including normal application startup fail-closed.
- New `tests/integration/phase1-promo.test.ts`: RED1 consumed; GREEN2 produced
  11pass/4fail. Failures were fixture errors: `withdrawn` versus canonical
  `revoked`, two forbidden attempts to retire immutable approved consent documents,
  and English display name instead of stored Russian tariff name. Fixtures corrected
  using isolated fresh databases/canonical immutable insertion, preserving guards.
  Final3 CONSUMED at14:32:01UTC:14pass/1fail. The expired-quote fixture failed
  PostgreSQL42P18 because `jsonb_build_object` could not infer the idempotency-key
  parameter type. Added explicit `::text` to this synthetic fixture only. Corrected
  fixture has NOT run; all3 slots consumed. Exactly one extra invocation requested
  through coordinator; no answer yet. No fourth run or equivalent SQL probe allowed.
- Scope123/123 PASS. History initial7/8 because the newest snapshot literal was51;
  corrected exact literal52 and GREEN8/8. No classifier or historical gap widening.
- Relevant DB/application/config builds, API typecheck, tests TypeScript, scoped
  ESLint, formatting and whitespace checks PASS at the recorded source checkpoint.
- Metadata replayed all53 hand-authored SQL files on a separate owned PG17.5
  database.130tables,43functions,75triggers,853constraints,354indexes,2extensions;
  all prior0051 catalogue objects unchanged. Fresh-directory introspection only;
  no `drizzle-kit generate`. See `docs/spec/phase1-block-a-guard-registration.md`.

## Independent reviews

Read-only `block_a_ingress_review` found replay namespace, quote authorization,
duplicate send and oversized-notice issues; all remediated and source accepted.
Read-only `block_a_storage_review` found input capture/error-sanitization, transaction
timeout, inviter-erasure, first-candidate, denied replay, pending expiry and erasure
replay defects; remediated and source accepted, including exact receipt owner binding.
The same reviewer independently verified literal artifact hashes, chain, journal,
relations/function/triggers and untouched guard classifiers.

Corrected expired-quote runtime evidence remains required before this block is
locally complete. A remains uncommitted; B/C/D/Phase2 have not started because the
ordered predecessor gate remains open. All other15-case-file scenarios produced
14passes in final3. No release acceptance is claimed.
No full/multi-path suite, exhausted legacy PostgreSQL/provider suite, provider call,
credential transfer, push, deployment or live flag change occurred. External merchant,
processor/backup and exact-SHA release acceptance remain separate gates.

## Owner-authorized final verification5 — 2026-10-23

The owner explicitly authorized one further focused-file invocation after the
failed infrastructure startup4. Coordinator invoked exactly
`pnpm exec vitest run tests/integration/phase1-promo.test.ts` on fresh task-owned
PostgreSQL17.5 Compose project ii-tonya-phase1-promo-owner-recovery-20261023.
Invocation5 exited0: **15/15 PASS** in19.60seconds, including corrected expired-quote
fixture and actual database expiry rejection. Log /tmp/phase1-promo-owner-extra5.log.
No source/expectation change since the reviewed ::text correction. The authority
is consumed: do not run6 or infer permission for old/full/provider suites.

BlockA local implementation gate is now closed; BlockB can proceed in the approved
sequence. Earlier failed/skipped runs remain diagnostic history. This is not
external merchant/delivery/erasure proof or exact-SHA release acceptance. No push,
deployment, real-provider request, paid operation or live flag change occurred.
