# Resident verification first increment coordinator record

The owner supplied the verification_system protocol and explicitly requested a
first Schema+Form Logic PR. Current work is limited to that deliverable; OCR,
social scraping, LLM extraction, private-object ingestion and manager decisions
remain subsequent work. No completed full verification system is claimed.

Identity: canonical repository, clean baseline1a006fff4e2985fd83b72f3c67a66823fab87078,
existing isolated worktree, new branch codex/verification-schema-form-20261026.
Remote base codex/phase1-owner-plan-20261023 independently matched that exact SHA.
The original main checkout and its unrelated dirty files were not modified.

RequireDocker preflight passed Node24.22.1, pnpm11.9.0, Docker29.9.2 and Compose5.6.1.
No.env or provider secrets were read. A task-owned PostgreSQL17.5-bookworm cluster
uses loopback55483,1CPU/1GiB, and protected synthetic credentials in a0600 temporary
configuration. This is disposable development evidence, not staging acceptance.

Two read-only investigations mapped current form ingress and identity/schema/
erasure. Existing applications require an owned quote, and existing manager
approval creates a3000-ruble onboarding invoice. A new pre-price intake must be
separate and cannot invoke that command. The actual promo ingress currently has
only bounded text input, so pure domain code alone would not satisfy the request.

The latest specification supersedes old sequencing for the new cohort while
preserving issued offers/payments and their original timestamps. Multi-role fields
use union requirements. Category admission text and the authoritative niche/
document policy are missing content; unknown means manual review, not verified.
No new legal/licensing criteria are inferred from untrusted user text.

The owner previously opted out of repetitive approvals and focused run-count
questions for residency work. Continue autonomously within the supplied first-PR
scope, retaining failures and avoiding unchanged repetitions or weakened checks.
Push and draft-PR creation are authorized; merge/deploy/provider activation are not.

Root owns this record, read-only coordination, final gate and PR. Fresh implementer
owns all implementation/source/schema/tests/plan/status and implementation evidence.

## Initial implementation review

Lead reports domain10/10 and initial PostgreSQL4/4, with missing-module RED and a
corrected SQL CASE parse failure retained. These are intermediate results, not
complete acceptance. The coordinator read the initial domain, service, repository
and migration source while implementation continued.

Findings sent before freeze: use the requested residents_applications table and
queryable typed projections; explicitly choose a primary role; amenities need
multi-selection/None; optional education controls must match applicability; expose
a usable field-edit menu; persist a trusted education-policy version; and bind
stored application identity to the canonical channel. Intake admission and price
creation must serialize, including the registration-to-form race. Switching the
UI flag off must never reopen pricing for an existing pending intake.

The JSON draft may remain the single raw-answer source, with typed generated
projections to avoid inconsistent duplicate state. Social platform/URL mapping,
private document references, unknown check results and reserved manager notes must
be explicit schema contracts. No future provider capability is represented as done.

Coordinator subsequently read /tmp/verification-form-pg-green7.log:15/15 pass,
including actual erasure/stage reset, real service completion by role, original
consent revocation, durable flag-off fencing, legacy time preservation and intake/
first-quote classification. This remains focused development evidence, not final
branch/staging acceptance.

Telegram's official [PhotoSize](https://core.telegram.org/bots/api#photosize) and
[Document](https://core.telegram.org/bots/api#document) contracts were read on
2026-10-26: size and document MIME metadata may be absent. References therefore
need honest unknown metadata pending actual ingestion. No document or provider
was downloaded. Stale/invalid controls also need permanent200 rejection/resume
instead of transient503 retries. Prototype field names must be rejected normally.
These findings were sent before final source verification.

## Independent review of first source checkpoint

Checkpoint8fc8e34b15065b5ff058fd6d7c739b19cdb6cd98 was reviewed against
product baseline1a006fff4e2985fd83b72f3c67a66823fab87078 by three context-free,
read-only reviewers: blind hunter, edge-case hunter and verification-gap reviewer.
All were launched before collecting/triaging their findings. Review content covered
the full branch diff, including generated metadata; authored-source companion
diffs only reduced repeated large metadata output. Reviewers made no edits or tests.

Accepted remediation groups (all within the frozen first-part intent):

| ID  | Consequence | Required patch                                                                                                             |
| --- | ----------- | -------------------------------------------------------------------------------------------------------------------------- |
| P1  | High        | Normalize text and inline role changes; preserve explicit primary deletion and old answers; real role-change regression    |
| P2  | High        | Accept files only at applicable document questions; classify unexpected media/blank follow-ups permanently                 |
| P3  | Medium      | Clear/replace attachments, skip optional education, preserve submitted text/file supplements without changing frozen facts |
| P4  | Medium      | Keep policy-conflict denial, show an honest paused-draft state, test version/requirement mismatches                        |
| P5  | Medium      | Align URL scheme/credential and text/caption control validation across domain and SQL                                      |
| P6  | Medium      | Reject cumulative draft-size overflow before SQL, retaining previous saved data                                            |
| P7  | Medium      | Index request ownership for privacy cleanup; retain existing erasure-governed lifecycle without guessing a TTL             |
| P8  | Medium      | Acknowledge durable pending-intake pricing denial while the UI flag is off; preserve consent operations                    |
| P9  | High        | Exercise actual enabled composition through Fastify plus PostgreSQL, not a replaced service                                |
| P10 | High        | Reject a form-enabled capability above a disabled environment ceiling                                                      |
| P11 | Low         | Bounded owner confirmation summary with existing edit controls, without file identifiers                                   |

No intent gap or wholesale re-derivation is required. Root re-engaged the original
implementer with one coherent patch batch. One coordinator mechanism claim in P1
was corrected: the committed repository already clones and validates patches
without discarding null markers; the earlier destructive-normalization description
came from an obsolete working-source read. Preserve that correct implementation.
The independently found text-role change and end-to-end test remain valid.

The permanent-input group also covers authentic but unsupported file metadata,
oversized form text and disabled old form controls at the decoder boundary;
structural/authentication failures remain distinct. A compatibility check found
that new-form /start had hidden the existing referral-code/guide/bonus information.
Preserve that non-price registration information while keeping tariff entry hidden.
Neither correction needs another schema/PG change.

Remediation milestones reported: PostgreSQL21/21 and one actual normal
Fastify/composition case1/1, including Russian role labels, original enrollment,
durable persisted role, exact callback replay and flag-off200 denials. Final
post-SQL metadata reconstruction reports174tables,9functions,5triggers,
43constraints and12indexes. Reviewer recheck and the final clean-source gate remain
outstanding; these intermediate results are not a complete release claim.

## Review closure before final branch gate

Reviewed implementation5e2bb8e336812197ad4105bbae9addfdd957da7f preserves the
original frozen intent. Verification-gap review passed the parent remediation
89b8ae3d with real composition and both policy mismatch cases. Edge and blind
reviewers then identified two narrow residuals: normalized Unicode URL expansion
and missing declared average check in confirmation. Both were corrected and
independently closed at5e2bb8e3; no accepted finding remains open. No new broad
review quota or unchanged PostgreSQL rerun followed those pure validation/display
fixes. The exact Cyrillic URL expands to620 characters, not the initially estimated619.

Coordinator read terminal logs for domain13/13, form16/16, applicant28/28,
decoder15/15, PostgreSQL21/21 and the separate actual composition1/1. Affected
builds/types/lint/format also passed. Source, metadata and failed RED attempts are
recorded in the implementation/remediation evidence. Final branch gate and the
authorized push/draft PR are still outstanding at this checkpoint.

The final gate will invoke the canonical pnpm verify:gate script unchanged. A
read-only observer retains the opened tests/repo log before temporary cleanup,
so failures cannot lose their details as in the previous increment. Supported
Vitest thread/fork limits1 reduce contention; no deadline or test is disabled.

## First final gate and exact parity correction

Canonical full gate atf90e3024ae586325610c6db1d75ac41118d0011b exited1.
All six static/type checks passed; tests/repo passed557 and failed one stale
expected constraint in db-schema-parity.test.ts. The new composite ownership FK
requires channel_identity_resident_owner UNIQUE(id,user_id), already present in
migration57, Drizzle, snapshot and the actual PostgreSQL catalogue. The old test
expected no named uniques on channel_identities.

Root changed only that exact expected-name array, preserving both existing partial
unique indexes and every other assertion. The implementation owner independently
reviewed SQL/schema/catalogue correspondence read-only and returned PASS. Focused
db-schema-parity tests12/12 passed; lint, format and whitespace passed. No runtime
source, migration, metadata or PostgreSQL rerun was necessary.

Failed gate log: /tmp/verification-form-final-gate-1793017264392745111.log.
Complete retained repository failure: /tmp/verification-form-final-repo-1793017264392745111.log.
Focused green: /tmp/verification-form-schema-parity-green.log. This is a diagnosed
exact-inventory correction, not an assertion bypass or unexplained timing retry.
