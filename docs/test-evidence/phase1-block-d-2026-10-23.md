# Phase1 Block D local evidence — 2026-10-23

Status: local implementation accepted; external release gates remain separate. Baseline
`35f341c0e5c5bc1507f46a0cf87250f92b186eeb`; no provider, deployment, push or live flag.
Explicit task-wide verification count override applies; all attempts remain recorded.

Canonical settled intervals own coverage. The current continuous chain extends
through adjacent prepaid intervals and stops at refund gaps. Calendar pause uses
UTC PostgreSQL dates, retains original paid time without extension, and restores
only real current coverage/approved ownership. Deferred publication consumes an
actual settled main-binding/review; no settlement, reward or history is replayed.
Refunded future-anchor billing projection reconciles on lifecycle read/worker before
bill/reminder decisions, rather than claiming immediate reverse-callback projection.

One bill per paid-end cycle and append-only attempts preserve accepted terms and
old order recovery. Fresh quote/explicit acceptance is required after expiry. Legacy
new-D bills explicitly require a real C card; existing generic legacy navigation
and checkout are preserved. Worker, commands, delivery and checkout default off
independently. Approved notice slots are inactive until owner content exists; only
real scoped receipts confirm delivery and uncertain attempts never blind-resend.

Observed non-PG evidence: storage37/37 after a meaningful fairness RED1/37; financial
12+2+3; worker25; service23/config14/actual route11/normal composition11; actual API
wiring5. Relevant contracts/DB/application/config/worker/app-worker builds/types,
full tests TypeScript, scoped lint/format/diff passed. Independent financial,
storage, notice/worker and 12-case fixture source reviews accepted concrete fixes.
Fairness advances the existing PostgreSQL examination timestamp for future-paused
rows; no new cursor table or clock framework was introduced.

Actual isolated56-migration PostgreSQL17.5 capture:155tables,67functions,109triggers,
1057constraints,418indexes,2extensions. Only old catalogue delta is the authorized
C request-operation CHECK extension.0055 SQL hash:
`ff08821bc86ffb3157fa759419251dbb5e68167629cf8e1d8114826e42be74d1`.
Scope/history exact pins are prepared; first staged guard runs follow.

New integration file has12 cases with heavy setup in bounded tracked hooks and
unchanged drain support. Time boundaries use audited schema-valid short legacy
tariff fixtures and genuine GET settlement, while real C monthly flows cover
publication/renewal/pause/refund/erasure. No settled interval or production clock is
rewritten; public tariff minimum duration is unchanged. `paidUntil` displays current
chain end or exact past paid end, while status/current coverage authorize access.

## Integrated local acceptance

First D focused invocation, lead session25529, exited0:12/12 passed on PostgreSQL17.5.
Log`/tmp/phase1-d-lifecycle-pg1.log`, started19:16:42UTC,52.14s total/46.88s cases.
It proves seven-day cycle uniqueness, explicit quote/order expiry recovery with
immutable attempts, real confirmed/unknown notice delivery, calendar pause and
returns, no expired access, concurrent payment/refund/erasure, actual refund-gap and
future-money deferral, atomic D bot/merchant wiring and C-off limited lifecycle access.
No retry or additional functional probe occurred.

Final staged guards passed first try: scope123/123 and migration history8/8. The
actual final DB and app-worker artifacts/types passed, as did API wiring5, full tests
TypeScript, scoped lint/format/whitespace and all independent source reviews. The
rationale in`docs/spec/phase1-block-d-guard-registration.md` records exact registrations.
No unchanged suite or helper rerun followed the green integrated result. D is locally
complete; Phase2 proceeds under existing authority. No release/live-provider claim.
