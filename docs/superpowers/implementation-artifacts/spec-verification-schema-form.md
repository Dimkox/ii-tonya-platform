---
title: Pre-price resident verification schema and dynamic form
type: feature
created: 2026-10-26
status: in-review
baseline_commit: 1a006fff4e2985fd83b72f3c67a66823fab87078
review_loop_iteration: 0
context:
  - AGENTS.md
  - docs/agents/expert-residency-team.md
  - docs/superpowers/plans/2026-10-26-verification-schema-form.md
---

<frozen-after-approval reason="owner supplied Schema + Form Logic first-PR scope and previously opted out of repeated implementation approvals">

## Intent

Build the first reviewable increment of the attached verification_system request:
durable intake and a real Telegram conditional form BEFORE pricing. New intake
must not call the legacy approval command that creates a3000-ruble invoice.
Preserve existing issued offers, payments, access and immutable prompt history.

## Boundaries & Constraints

**Always:** Work in the existing isolated worktree on
codex/verification-schema-form-20261026. Use existing TypeScript/PostgreSQL17.5,
Node24/pnpm11.9.0 and hand-authored SQL+journal. Default
EXPERT_VERIFICATION_FORM_ENABLED=false. Scope all actions to authenticated private
promo-bot identity, original consent and locked internal user; never trust a
submitted TG/user/application ID. Use bounded inputs, DB time, optimistic revision,
scoped idempotency and erasure. Partial drafts may contain missing required fields.

Persist primary role plus unique selected roles EXPERT/CENTER/ORGANIZER/EDU_PROJECT/
ESOTERIC/OTHER, category BASIC/EXCLUSIVE/BOTH, tax SELF_EMPLOYED/IP/LLC/INDIVIDUAL,
city, social links, motivation, specialization and conditional facts. Requirements
are the union of selected roles; primary must belong to them. CENTER requires
property evidence, positive capacity and amenities selection; EXPERT collects
education references, specialization and integer-kopeck average check. ESOTERIC/
OTHER collect path/cases without a blanket diploma requirement. Every role requires
tax, city, social links and motivation. More than15000 rubles is only a review signal.
Versioned server education rules may require documents; an absent niche policy is
explicitly unknown/manual-review, never verified or inferred law. Missing category
criteria remain a content slot, not invented admission promises.

Application statuses: PENDING_DOCS/UNDER_REVIEW/INFO_REQUESTED/APPROVED_BASIC/
APPROVED_EXCLUSIVE/REJECTED. Progress: NONE/FORM_FILLING/AUTO_CHECK/MANAGER_REVIEW/
DONE. Submission freezes a complete revision and queues pending automatic checks;
never fabricate OCR/social evidence or approval. Store bounded follow-up answers
in application_updates. Applicant inputs cannot set status, checks or manager notes.

**Ask First:** Actual staging/production changes, credentials or provider activation.
PR creation/push is authorized by the owner's explicit request for the first PR.

**Never:** Add Python/Django/Celery, execute OCR/social scraping/LLM, fetch applicant
URLs, publish documents, claim S3 ingestion/presigned access, or implement manager
decisions/48h timers in this increment. Retain typed private Telegram document refs
and explicit pending-upload/check contracts. No prices, quotes, invoices or resident
activation from form completion. BASIC/EXCLUSIVE approval and the later tariff
button/event consumer belong to the following increment. No financial-table rewrite.

## I/O & Edge-Case Matrix

| Scenario       | Input/state                                          | Expected behavior                                                           | Failure                              |
| -------------- | ---------------------------------------------------- | --------------------------------------------------------------------------- | ------------------------------------ |
| New intake     | Enrolled owner starts/resumes                        | Role/category inline controls and durable next question; tax for every role | Consent/identity denial              |
| Multiple roles | CENTER+EXPERT+ESOTERIC                               | Union requirements; no document-policy bypass                               | Invalid/duplicate roles rejected     |
| Partial/edit   | Missing fields, changed role                         | Save/resume; recompute visible requirements without losing raw answers      | Stale revision conflicts             |
| Submit         | Complete current revision                            | Pending check work; no money or verified result                             | Missing requirements remain editable |
| Media          | Photo/document and motivation text                   | Private bounded refs/raw answers survive restart                            | Wrong content/type/size rejected     |
| Authority      | Forged callback, wrong bot/owner, repeated update    | No cross-owner change; exact replay stable                                  | Conflicting digest denied            |
| Pricing bypass | New cohort calls tariff/apply/current-offer directly | No price, anchor or invoice before approval                                 | Repository/read denial               |
| Compatibility  | Previously issued authoritative offer/paid user      | Existing flows unchanged                                                    | No timestamp reset                   |
| Privacy        | Real erasure or revoked consent                      | Remove intake PII/refs/updates; cancel pending work; no new mutation        | Erased replay cannot resurrect       |

</frozen-after-approval>

## Code Map

- `apps/api/src/routes/expert-applicant-telegram.ts:25`: real private text-only ingress; extend typed callbacks/media and per-result markup without weakening auth/rate limits.
- `packages/application/src/expert-applicant-service.ts:99`: existing consent/referral entry and pre-application tariff branches; compose intake first for the new cohort.
- `apps/api/src/expert-applicant-composition.ts:28`, `apps/api/src/server.ts`: wire the real default-off capability, not only test injection.
- `packages/db/src/repositories/expert-promo-repository.ts:68,329,583`: trusted identity/consent pattern; quote and legacy application bypass boundaries.
- `packages/db/src/repositories/expert-personal-offer-repository.ts`: owned offer reads/scheduler must respect pre-price intake without breaking existing offers.
- `packages/db/src/repositories/expert-verification-repository.ts:209` and application service:185: READ-ONLY legacy invoice-producing approval; not the new intake command.
- `packages/db/src/repositories/privacy-repository.ts:970`: actual erasure before identity deletion; users remain financial tombstones.
- `packages/db/src/repositories/expert-manager-authority.ts:25`: future decision authority, no applicant writes to trusted outcomes.
- `apps/api/src/expert-card-telegram-ingress.ts:23`: strict private Telegram media decoding reuse.
- `packages/db/migrations/0056_residency_offer_corrections.sql`, snapshot56: immutable169-table baseline; next migration57. Use the established PG-derived metadata procedure.
- `docs/test-evidence/residency-offer-corrections-coordinator-2026-10-23.md`: prior compatibility/verification limits, not new release evidence.

## Tasks & Acceptance

**Execution:**

- [x] Add `packages/domain/src/resident-verification-form.ts` and tests: pure versioned fields, union validation, bounded patches and next-question logic; export without new dependencies.
- [x] Add migration0057, schema/repository `resident-verification`, updates/progress/check-work/idempotency storage; SQL ownership/submit constraints, real privacy cleanup and focused PostgreSQL tests.
- [x] Add application form service/tests; extend actual promo ingress/composition/config and test inline controls, media, resume and all matrix denials.
- [x] Guard new-cohort pricing at repository/read boundaries; preserve prior offers/paid users. No approval/payment implementation.
- [ ] Reconstruct additive metadata, register exact guards with negative probes, run builds/types/lint/focused tests and independent review; record evidence and create a draft PR based on codex/phase1-owner-plan-20261023.

**Acceptance Criteria:**

- Given every role, when completing the real private Telegram form, then required and conditional answers persist across calls with no financial side effects.
- Given new intake, when bypassing the UI, then no first offer is issued before a trusted later approval; legacy authoritative offers remain usable.
- Given submission with no OCR/social worker, then stored results remain pending/unknown and cannot be supplied by an applicant.
- Given actual privacy deletion, then new personal form/update/document data disappears and stale requests cannot recreate it.

## Spec Change Log

## Design Notes

Execution root is the existing isolated tree:
`/home/pall/projects/ii-tonya-base/work/ii-tonya-platform/.worktrees/phase1-owner-plan-20261023`.
Read its AGENT-STATUS.md first. The implementer owns source, plan/status and test
evidence; root owns `docs/test-evidence/verification-schema-form-coordinator-2026-10-26.md`
and the final gate. Execute implementation sequentially; independent reviewers
report findings without editing. The root coordinator handles final push/PR.

Use the task-owned PostgreSQL17.5 cluster on loopback55483, project
ii-tonya-verification-form-20261026. Protected configuration is
/tmp/verification-form-20261026.compose.json (0600). Parse its credentials only in
memory and set II_TONYA_TEST_POSTGRES_ADMIN_URL for child tests; never print the
file, URL or environment. Serialize PG, metadata and CPU-heavy builds. Do not use
obsolete prior-task credentials or create extra clusters. Preserve failed evidence.

## Verification

Use meaningful RED/GREEN domain/application/route tests, serialized PG17.5 cases,
relevant builds/types/lint and git diff --check. Preserve failed logs. Stage new
files before tracked-source guard checks. One final full branch gate, with supported
Vitest worker limits1; do not weaken deadlines or repeat unchanged suites. Existing
task-wide owner opt-out covers routine approvals/focused count limits. No live
staging acceptance is claimed; deliver Schema+Form Logic as a draft PR.

## Implementation Checkpoint — 2026-10-26

Source implemented and locally verified; final independent review, branch gate and draft PR remain coordinator-owned. Schema uses `residents_applications` with generated owner-schema projections and a canonical channel-identity FK; physical mapping and exact guard inventory: `docs/spec/verification-schema-form-guard-registration.md`. Focused acceptance and retained failures: `docs/test-evidence/verification-schema-form-implementation-2026-10-26.md`. No live acceptance or provider activation is claimed.

## Suggested Review Order

**Entry and conversation**

- Follow normal promo composition into the default-off, consent-bound intake.
  [expert-applicant-composition.ts:39](../../../apps/api/src/expert-applicant-composition.ts#L39)

- Inspect private Telegram decoding, permanent-input replies and form markup.
  [expert-applicant-telegram.ts:19](../../../apps/api/src/routes/expert-applicant-telegram.ts#L19)

- Trace durable questions, document corrections and immutable submission.
  [resident-verification-service.ts:269](../../../packages/application/src/resident-verification-service.ts#L269)

**Authority and privacy**

- Review additive schema, owned cohorts, projections and financial fences.
  [0057_resident_verification_form.sql:2](../../../packages/db/migrations/0057_resident_verification_form.sql#L2)

- Check original consent, replay, revisions and stored-policy conflicts.
  [resident-verification-repository.ts:41](../../../packages/db/src/repositories/resident-verification-repository.ts#L41)

- Confirm actual erasure removes private answers and document references.
  [privacy-repository.ts:1014](../../../packages/db/src/repositories/privacy-repository.ts#L1014)

**Validation and evidence**

- Understand union requirements and bounded URL, text and document validation.
  [resident-verification-form.ts:83](../../../packages/domain/src/resident-verification-form.ts#L83)

- Follow real enabled composition through authenticated updates and PostgreSQL.
  [resident-verification-composition.integration.test.ts:27](../../../apps/api/src/routes/resident-verification-composition.integration.test.ts#L27)

- Review owner, erasure, policy, legacy and concurrency acceptance.
  [resident-verification-form.test.ts:54](../../../tests/integration/resident-verification-form.test.ts#L54)

- Verify exact provenance and deny unreviewed schema lookalikes.
  [verification-form-boundary.test.ts:1](../../../tests/repo/verification-form-boundary.test.ts#L1)
