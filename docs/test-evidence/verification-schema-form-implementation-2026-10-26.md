# Resident verification Schema+Form Logic implementation — 2026-10-26

Contract: `docs/superpowers/implementation-artifacts/spec-verification-schema-form.md`.
Branch: codex/verification-schema-form-20261026 in the assigned isolated worktree.
Implementation baseline890880f; parent product baseline1a006fff. Source acceptance
only: independent final review, branch gate and draft PR are coordinator-owned.
No deploy, provider enablement, document/URL fetch, OCR, social scraping, S3 upload,
price/invoice creation or resident activation occurred.

## Delivered behavior

A separate private Telegram intake runs before pricing when the new default-off
flag is enabled. Role selection is multi-select, primary role is explicit,
requirements are unioned, and tax/city/social/motivation apply to every role.
Center amenities support multi-select/None; edit menus persist their question
cursor, and text/media drafts resume durably. Server-versioned education rules
are persisted, with unknown/manual-review as the honest default. Declared media
limits are enforced; missing optional Telegram metadata is preserved as null.
Documents remain private, pending-upload references.

Submission freezes the complete revision, derives AUTO_CHECK, and queues pending
checks with no fabricated result. Bounded supplemental text enters the update
history without altering the submitted snapshot. Stale/forged/permanent input
conflicts are acknowledged200 without applying mutations, rather than retried503.
Original consent and the locked canonical channel/user own every operation.

The durable cohort survives UI disablement and PII removal; repositories and SQL
fence new prices/anchors/quotes. Existing issued authoritative offers/settled users
stay on the legacy path. SQL refuses all manager decisions in this increment, so
neither an applicant status nor a stage string grants price/access authority.
Actual privacy erasure and consent withdrawal remove drafts, private refs, updates
and pending work; request results/digests are tombstoned. The user stage resets
NONE. Physical mapping and exact guard scope are documented in
`docs/spec/verification-schema-form-guard-registration.md`.

## Executed evidence

- RequireDocker preflight: Node24.22.1/pnpm11.9.0; Docker/Compose pass. No.env used.
- Domain initial missing-module RED retained in `/tmp/verification-form-domain-red.log`;
  first GREEN10/10 in `/tmp/verification-form-domain-green.log`.
- Service missing-module RED retained; route behavior RED10pass/1fail then
  GREEN11/11. Latest ingress suite13/13 includes unknown media metadata and real
  stale-control200/no-mutation coverage.
- Final focused unit command `/tmp/verification-form-focused-units.log`: five
  suites75/75 pass; service had one stale test expectation after the permanent
  conflict behavior correction. Corrected service suite4/4 passes in
  `/tmp/verification-form-service-final.log`. No aggregate rerun was needed.
- PostgreSQL17.5 final `/tmp/verification-form-pg-green7.log`:15/15 pass. Includes
  all six real-service role flows, server-required education, owner/consent,
  revisions/replay, SQL invalid submissions, concurrent submit, actual erasure,
  user-stage lifecycle, revoked consent, flag-off pricing bypass, legacy issued
  clock conservation and concurrent first-quote/intake classification.
- PG failed diagnostics green1/3/4/5/6 remain retained: PL/pgSQL CASE parentheses;
  an authoring replacement accidentally affecting an ALTER; PostgreSQL's255 regex
  quantifier limit; reused synthetic update IDs across owners; complete privacy
  manifest fixture requirements; and raw timestamp-string assertion formatting.
  These were corrected without weakening existing authority/validation contracts.
  Task-wide owner opt-out of routine focused-run count questions applies.
- `/tmp/verification-form-metadata4.log`: full58 hand-authored migrations replayed
  on the task-owned PostgreSQL17.5 cluster. Fresh empty-directory introspection,
  normalized using migration-state.ts. Snapshot57 has174tables. Additive exact
  catalogue:8functions,5triggers,42constraints and11indexes. Disposable databases
  removed; no extra cluster or production credential was used.
- Focused guard tests: boundary/provenance5/5, tracked source scope130/130,
  literal inventory10/10, migration history9/9. History initially caught a
  reconstruction regex omitting an existing v2-named function; restored the exact
  historical inventory, without changing historical SQL or allowing new gaps.
- Relevant domain/config/application/db/API builds pass. API first exposed an
  undeclared direct domain type import; it now uses the existing application
  barrel. No package/dependency/lockfile change.
- Five relevant package typechecks and full tests typecheck pass. Changed-file
  lint passes after two test-only lint corrections. Final whitespace/format checks
  are recorded with the source checkpoint before coordinator handoff.

## Deliberate limits and rulings

Unknown education/category policy stays unknown/manual/content-pending. No legal
or eligibility promise is inferred. Optional reference metadata is not proof of
valid bytes. Required education rules require a separate trusted versioned policy.
All intake cohorts stay price-fenced until a later reviewed manager-provenance
increment; approval vocabulary is reserved and cannot be written now.

Implementation tasks1–3 are consolidated into one reviewable source commit because
the pure form, transactional storage, schema projections and ingress boundaries
form one atomic increment. This trades per-task commit granularity for a single
coherent source checkpoint; it does not change the frozen scope or review gate.

The hosted workflows directory is intentionally empty by repository policy.
Local acceptance is not exact-SHA hosted CI, staging acceptance, provider ingestion
or production readiness. Coordinator owns independent review, final branch gate,
clean source SHA and the authorized draft PR against codex/phase1-owner-plan-20261023.
