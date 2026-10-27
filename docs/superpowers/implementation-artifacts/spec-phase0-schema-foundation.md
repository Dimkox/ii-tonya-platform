---
title: Phase 0 applicant database foundation
type: feature
created: 2026-10-23
status: in-review
baseline_commit: d32da25dcdaf54ceb2039049ab348b3b54e9e2d4
review_loop_iteration: 0
context:
  - AGENTS.md
  - docs/agents/expert-residency-team.md
---

<frozen-after-approval reason="owner approved Phase 0 and existing model plus application table">

## Intent

P0.2 needs durable applicant verification/onboarding state without duplicating the
existing user identity, integer-money quotes, payment operations or referral ledger.
The owner explicitly chose the existing model plus a separate application table.
Build the additive, inactive schema foundation; later Phase 1 supplies workflows.

## Boundaries & Constraints

Always: hand-authored SQL and matching contiguous journal entry; preserve existing
ledger-derived bonus authority and immutable integer-kopek quotes. Support applicants
before expert creation. Keep personal content out of the queue foundation.
Never: drizzle-kit generate, mutable bonus/money balance, plaintext referral codes,
new payment/identity tables, schema deployment, provider calls, changing other tasks'
owned files, tests above the repository limits. No push.

## I/O & Edge-Case Matrix

| Scenario            | Input / State                                  | Expected                                     | Error                               |
| ------------------- | ---------------------------------------------- | -------------------------------------------- | ----------------------------------- |
| New applicant       | Existing user                                  | Pending verification, nullable content stage | None                                |
| Duplicate applicant | Same user twice                                | One application per user                     | Unique violation                    |
| Quote owner         | Another user's campaign quote                  | Reject                                       | FK or equivalent DB ownership guard |
| Queue states        | Unknown verification or onboarding value       | Reject                                       | Constraint violation                |
| Archive metadata    | End before start or over three calendar months | Reject                                       | Constraint violation                |
| Existing authority  | Existing tariff, payment and bonus records     | Untouched                                    | None                                |

</frozen-after-approval>

## Code Map

Worktree: /home/pall/projects/ii-tonya-base/work/ii-tonya-platform/.worktrees/phase1-owner-plan-20261023.

- `packages/db/src/schema/identity.ts`: users; applicants need not yet be experts.
- `packages/db/src/schema/catalog.ts`: experts, one per user; verified is boolean.
- `packages/db/src/schema/expert-campaign-quotes.ts`: user-owned immutable quotes,
  `price_minor`, `expires_at`, 1/3-month terms. Reuse, do not duplicate amounts/TTL.
- `packages/db/src/schema/expert-residency.ts`: HMAC-only single-use admin referral
  codes; expert_referral_balances/maturities derive available/frozen credit;
  residency_ends_at on settled orders derives billing due date.
- `packages/db/migrations/meta/_journal.json`: last migration idx50, tag
  0050_expert_receipt_contact_bindings. Allocate next free number by inspecting live.
- `packages/db/src/testkit/postgres.ts`: isolated PostgreSQL17.5 testcontainers.
- `tests/repo/migration-history-integrity.test.ts`: immutable historical gap list;
  shrink no baseline or expand no grandfathered exceptions for this change.
- Existing unpublished lifecycle commit 3b7ccc5919aa53581cf26cbdbd081a518804a2c1
  is reference only. Do not cherry-pick: mixed scope, draft migration and missing deps.

## Implementation ownership clarification

Coordinator authorized additive `meta/0051_snapshot.json`, `state/0051_*` provenance,
`tests/repo/migration-history-integrity.test.ts` newest snapshot/table counts, and
`tests/repo/migration-state-baseline.test.ts` state51 registration. Additive path/relation/new-artifact hash registrations in
`tests/repo/support/payment-scope-boundary-core.ts` are owned; existing hashes
and detection remain frozen. Existing
`payer_receipt_quote_owner_unique` already provides UNIQUE(id,user_id), so reuse
that constraint without touching the quote schema or adding a duplicate.

## Review remediation: applicant erasure

Coordinator assigned `packages/db/src/repositories/privacy-repository.ts` to this
implementer. Applicant metadata must be deleted for the target user inside the
existing `startErasureAtomically` cleanup transaction after manifests exist and
before identity mappings are deleted. Add focused PostgreSQL coverage for target
removal, other-user/ledger preservation, and later-failure rollback. Retain all
financial facts. No new migration or additional implementer PG run is authorized;
the coordinator verifies these cases in the reserved third run.

## Tasks & Acceptance

Owned files: new schema `packages/db/src/schema/expert-onboarding.ts`, its export in
schema/index.ts, one new numbered migration and journal entry, new focused schema
metadata/integration tests, and `docs/spec/phase0-schema-audit.md`. If a repository
scope guard needs an explicit additive registration, change only that registration;
never weaken its detection or hash baseline.

- [x] Audit/map all P0.2 names in docs/spec/phase0-schema-audit.md. Explicitly separate
      reusable promo lead codes/attribution from single-use qualified expert codes;
      missing promo behavior belongs to A1, not hidden as implemented here.
- [x] Add expert_onboarding_applications keyed uniquely to user, optional owner-bound
      campaign quote, verification_status pending/approved/rejected, nullable
      onboarding_stage interview/card_draft/manager_review/promo_check/payment_ready,
      created/updated timestamps. Store no diploma, contact, arbitrary JSON, or money.
      Queue index should support pending ordered by creation. Approval state must not
      activate existing experts or accept payment by itself.
- [x] Add nullable archived_at/archive_until_date metadata with paired-null and finite
      chronological bounds through three calendar months. It creates no automatic paid
      entitlement or restoration. Document this boundary and billing due-date derivation.
- [x] Author migration and matching schema metadata. Ownership of quote enforced in
      PostgreSQL, not only TypeScript. No backfill of approval or activation.
- [x] Write meaningful RED tests first, then implement, then GREEN for real PG replay,
      uniqueness, ownership, invalid enums/archive bounds, existing users preserved.
- [x] Run focused checks, lint/typecheck/format/diff and report exact evidence. Do not
      commit; coordinator commits after independent review. Do not run aggregate suites.

Acceptance: Given the committed migration chain, replay creates the queue foundation
while existing financial history is unchanged. Given a new user, default verification
is pending and no expert activation follows. Given a foreign quote, database rejects
the binding. Given the mapping, every requested field is classified existing, added,
or Phase1 behavior with its authority and limitation named.

## Verification

At most one RED and one GREEN focused integration run, never more than three total.
Run tests separately by file; do not consume a multi-path Vitest invocation. Report
commands, counts and failures. Dependencies have been frozen-installed in this tree.
Existing packages may require building before import tests; use pinned pnpm scripts.
Local PG is testcontainers only. No application of migrations to shared/native DBs.

## Local result

Coordinator PostgreSQL17.5 final3: 18/18 PASS, including the review-requested
applicant erasure and rollback tests. Full catalogue equality and state guard15/15
passed. Independent review confirmed the schema and retention fix. Existing
repository scope/history drift and exact-SHA release gates remain open; this is
locally implemented and reviewed, not release accepted.
