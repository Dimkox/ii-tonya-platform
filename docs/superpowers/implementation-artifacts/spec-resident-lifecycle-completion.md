---
title: Resident lifecycle completion and accountable manager follow-up
type: feature
created: 2026-10-27
status: in-review
baseline_commit: 117af4a74b104bb0f0967868a8d7e46894b05c7b
review_loop_iteration: 0
context: []
---

<frozen-after-approval reason="Existing owner authorization; route 35ab697bf43e, AC001–AC014">

## Intent

**Problem:** Approved card decisions and first actual publication lack durable WORK
notifications. Fee-only residents fall outside the paid renewal scan; managers need
actionable acquisition and booking-quality cases with reliable source evidence.

**Approach:** Add source-bound private notifications and a protected follow-up queue
to the existing residency, staff panel and worker. Preserve financial authority,
existing paid-period behavior and native scheduling. Finish with a composed journey.

## Boundaries & Constraints

**Always:** Original WORK identity and consent, immutable review/payment sources,
fresh manager MFA after waits, database clock, durable attempts before network I/O,
strict thresholds, physical erasure, default-off execution and delivery capabilities.
Observe existing publications without fabricating a historical activation or receipt.

**Ask First:** Production activation, deployment or provider changes require a
separate explicit release instruction. Local implementation and bounded verification
are already authorized; coordinator owns independent review and push.

**Never:** Rewrite historical SQL/owner prompts, run schema-derived generation,
invent delivery or payment facts, automatically punish/refund residents, reset a
deadline by replacing a payment link, or resend an ambiguous transport attempt.

## I/O & Edge-Case Matrix

| Scenario         | Input / State                                    | Expected Output / Behavior                    | Error Handling                                                                    |
| ---------------- | ------------------------------------------------ | --------------------------------------------- | --------------------------------------------------------------------------------- |
| Card decision    | Immutable current approve/return                 | One original WORK notice; exact return reason | Suppress superseded source                                                        |
| First activation | First successful paid public projection          | One welcome with supported commands           | Defer while paused/ineligible; no baseline flood                                  |
| Delivery         | Current original consent/identity                | Validated matching receipt                    | 429 defers; ambiguous attempt stays unknown; recover known receipt without resend |
| Acquisition      | First approved card, missing materials >7d       | Internal materials case                       | Actual usable delivery starts resident grace                                      |
| Main payment     | First verified usable invoice >3d                | Payment case with stable source deadline      | Unknown/unissued links require reconciliation                                     |
| Quality          | Real client cohort over rolling 30d              | Daily case only above 20% human refusals      | Zero/exact 20% no action; missing provenance counted                              |
| Staff            | Fresh authorized session and expected revision   | List/detail/idempotent close                  | Stale MFA denied; stale async UI cleared                                          |
| Current tariff   | Paid permanent terms, eligible pending main link | Permanent price and verified link             | No invoice creation on read, no expired discount timer                            |

</frozen-after-approval>

## Code Map

- `packages/db/src/repositories/expert-card-repository.ts` — immutable review producer.
- `packages/db/src/repositories/expert-residency-main-projection.ts` — shared actual
  publication/return producer; settlement alone is insufficient.
- `packages/db/src/repositories/resident-lifecycle-completion-repository.ts` —
  original delivery authority, acquisition/quality evaluation and manager operations.
- `apps/worker/src/resident-lifecycle-completion-composition.ts` and `runtime.ts` —
  ordinary worker invocation and shutdown; existing Telegram transport contract.
- `apps/api/src/routes/resident-lifecycle.ts`, `apps/web/src/resident-lifecycle-view.ts`
  — protected queue integrated into the existing staff panel.
- `packages/db/migrations/0075_resident_lifecycle_completion.sql` — private lifecycle
  state; the complete 0000–0074 history remains immutable.
- `packages/application/src/expert-prompt-context.ts` and personal-offer repositories
  — verified payment-link projection, permanent-price context and display.

## Tasks & Acceptance

**Execution:**

- [x] Contracts, SQL/schema, transactional producers and privacy cleanup.
- [x] Durable WORK sender, source checks, bounded acquisition and quality scans.
- [x] Protected manager API, existing UI and actual worker composition.
- [x] Current tariff projection and current runtime/demo/WORK prompt alignment.
- [x] Focused PG and composed journey; populated 74→75 Drizzle SQL migration and state.
- [x] Browser, types, lint and guard inventories.
- [ ] Independent exact-source coordinator review and final integration gates.

**Acceptance Criteria:**

- Given a valid old publication, when its draft changes or the migration runs, then
  the old eligible publication remains usable and no fictional welcome is delivered.
- Given a paid but paused resident, when eligibility returns, then shared restoration
  creates one first-activation notice without extending the paid calendar.
- Given a real waitlist join/promoted request, when its human expert refuses, then
  its immutable lineage contributes exactly once to the real-client cohort.
- Given separate source uncertainties, when staff closes a case, then only case
  review changes; payment, publication and provider facts remain untouched.
- Given approved synthetic external fixtures, when the normal journey executes,
  then consent/form/review/3000/main/booking/logistics/renewal/pause/return remain linked.
- Given absent production content, when materials are requested, then the truthful
  placeholder persists without a fabricated file or delivered status.

## Spec Change Log

- 2026-10-27: Coordinator clarified first usable verified main link as the resident
  deadline source; mere order creation is operational evidence. Preserve stable
  first issuance across replacement and do not invent legacy issuance dates.

## Design Notes

Five private tables separate subject/activation/checkpoint identity, notification
intent, actual attempts/receipts, WORK-bot throttling, and human review cases. They
do not own billing, consent decisions or card content. The subject also retains
the immutable first usable main invoice source. Existing publications receive an
explicit observation marker with observation time and no activation timestamp.

## Verification

Use bounded focused files (maximum three PG invocations each), required PostgreSQL
17.5, fresh-directory database introspection, relevant builds/types/lint/browser
checks and `git diff --check`. Keep every failed run and command ledger in the
coordinator package. The previous native factory diagnostic remains failed; its
successful pre-push checks are historical evidence, not new S4b qualification.

### Executed evidence and remaining review

New lifecycle PG invocation3 passed11/11; invocations1(2/4) and2(10/11) remain
failed diagnostics. The composed normal journey and real original WORK delivery
were executed. Populated74→75 direct Drizzle SQL migration witness3 passed; first two harness
failures are retained. This did not execute repository `migrateDb` exact-prefix
preflight; no fresh proof of that wrapper is claimed. Real Chromium shipped-panel proof passed separately from
PostgreSQL API authorization. New state reconstructs232tables/180functions/
219triggers and keeps the original historical SQL chain unchanged.

No fourth invocation of either focused lifecycle PostgreSQL file is permitted.
The distinct authority file adds superseded review/changed recipient, a genuinely
observed PostgreSQL wait between durable claim and wire dispatch with identity
revocation, expiry and actual replacement-order deadline continuity, and current
promo-gate/consent suppression without read-side invoices. An unfinished rich
draft explicitly retains its last valid immutable approval. Expiry is simulated
by a short future deadline in the isolated fixture followed by a bounded actual
wait; the exact named snapshot trigger is restored and checked before the tested
read/replacement, and all other order fields and time ordering are preserved.
No live provider or production delivery is evidenced.
