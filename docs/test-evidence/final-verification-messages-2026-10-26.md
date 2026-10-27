# Final verification and messages — implementation evidence

Date: 2026-10-26. Branch: `codex/residency-verification-messages-20261026`.
Contract baseline: `53df4d2fbbe09038bde2298e4642cee4247fbe2b`.
The implementation snapshot is the commit containing this report. Root-owned
specification, coordinator and next-block preparation documents are excluded.
Independent review and the canonical final gate belong to the coordinator and are
pending at this handoff. This is local synthetic acceptance, not release evidence.

## Delivered behavior

New v2 forms collect the final six-role union and typed role fields, optional expert
education/project licence, no-status tax and bounded private DOCX/video references.
Stored v1 policies and frozen submissions remain intact. Callback wire values fit
64 bytes at the largest PostgreSQL revision. The existing manager queue/detail
shows submitted facts, selected terms, request questions, numbered answers and
message state. Legacy Telegram decisions cannot bypass the v2 protected editor.

Fresh manager authority, exact attempt/revision/generation and an exact preview hash
bind immutable review decisions. BASIC/EXCLUSIVE approval reuses the existing fixed
3000 onboarding invoice. Actual capture remains the authority for paid locks and
interview readiness. Information requests have numbered questions and actual DB
confirmation time + 48 hours; completion/timeout renews human review without replacing
original facts. Existing authenticated manager reads process overdue requests even
with delivery disabled. Soft reapplication uses one calendar month and a fresh
current attempt; old sales clocks/decisions/paid history remain intact.

All five source template slots are seeded. Neutral greeting, bounded questions and
three tone choices are available. Questions and tone are editable; unrestricted
prose editing is deliberately unavailable and the UI says so. Protected facts and
exact UTF-8 bytes are confirmed before a durable notice is created. The information
notice says 48 hours from request creation and points to `/verification`; that real
owner view supplies the DB absolute deadline and remaining window. Expired or
superseded requests cannot disclose a current notice. Waitlist retention is omitted
without authority. Refund sending stays unavailable with `refund_policy_pending` /
`TODO: Wait for Refund Policy`; no refund/legal executor or terms change was added.

Delivery is composed into the normal bounded worker, default off through
`RESIDENT_REVIEW_NOTIFICATIONS_ENABLED`. It checks original bot/chat, current owner,
attempt, current consent and lifecycle again at first disclosure. Dispatch is durable
before the provider call; uncertain outcomes are not blindly retried. The protected
editor can audit-close uncertainty without resending. Deletion removes private
payloads; immutable audit retains only minimal source facts and the final hash.

## Executed matrix

Logs remain in `.superpowers/sdd/verification-messages-20261026/`. The coordinator
owns their archival/hashes. Counts below are individual executed runs, not an
inflated sum of repeated cases. Filtered runs explicitly report excluded cases.

| Matrix / boundary                                                       | Executed witness and evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ----------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Six roles and mixed-role union                                          | `resident-verification-v2.test.ts` domain 8/8 in `domain-green.log` and `units.log`; final PG `validates complete six-role union and bounded media in SQL as in the domain` passes in `pg-media-privacy-timeout.log` (that run also contains an independently explained timeout failure). Every role and the combined union satisfies both domain and SQL validation.                                                                                                                                                                                                                                                                  |
| V1 continuation and frozen source                                       | PG `resident v2 durable identity` cases in `pg-worker.log`; actual historical upgrade described below; domain legacy form 13/13 in `units.log`. Unsupported-version compatibility fixture now uses version 3, retaining refusal rather than treating supported v2 as invalid.                                                                                                                                                                                                                                                                                                                                                          |
| Typed media and callbacks                                               | Actual Fastify applicant route 16/16 and v2 service 3/3 in `media-callbacks.log`: DOCX/MP4 at 20 MiB, unsupported MIME/oversize refusal and private references only. Domain/SQL witnesses reject unknown video MIME/size, >20 MiB and unbounded DOCX. Largest-revision callbacks cover tax, all roles/primary roles, categories, amenities, documents and added fields. `licence-callback-final.log` adds optional licence skip (1 selected, 3 filtered; the other three cases passed in the preceding run); `legacy-back-green.log` checks both legacy optional-document and forged-required-back behavior (2 selected, 15 filtered). |
| Actual approval, duplicate confirmation, selected price and fee capture | `pg-worker.log`, 12/12: parallel exact confirmation yields one event/3000 invoice, EXCLUSIVE persists and no unpaid lock appears. `api-composition-fixed.log`, actual Fastify + normal compositions + PG, 4/4: sales-first v2 intake, legacy bypass denied, exact preview/confirm, manager detail, genuine held-provider capture, selected quarter lock, main-invoice and renewal boundaries.                                                                                                                                                                                                                                          |
| Information identity, incomplete/complete answers, stale manager state  | `pg-worker.log` covers genuine prior request + renewal before insufficient-proof rejection and stale preview denial. `detail-question-binding-green.log` covers distinct manager/session and foreign attempt rejection, two-question partial completion denied, completed renewal, exact request/question-number mapping in protected detail and obsolete message cancellation (1 selected, 14 filtered).                                                                                                                                                                                                                              |
| 48-hour timeout and delayed disclosure                                  | `pg-final-targets.log`, 2 selected/13 filtered: expired notice cancelled, authenticated existing detail renews review with delivery off, late answers denied, financial verification remains pending. `deferred-bot-view.log`, 1 selected/15 filtered: actual bot service/repository over a 47-hour elapsed test fixture shows real UTC deadline and 60 remaining minutes; delivered bytes equal the original preview. Production decisions are never backdated.                                                                                                                                                                       |
| Calendar month / exact eligibility / hard and paid cases                | `pg-worker.log` includes PostgreSQL Jan 31 → Feb 28 / leap Feb 29 arithmetic and equality boundary; a separate actual reapply race advances the test fixture to eligibility, admits exactly one current attempt and preserves base clock/old financial decision. Hard rejection never reopens; early reapply is denied. Historical upgrade test denies paid reapply. Arithmetic and lifecycle tests are complementary; no production clock override was introduced.                                                                                                                                                                    |
| Five templates and protected facts                                      | Domain message 3/3 in `units.log`: five slots, neutral greeting, omitted waitlist promise, refund refusal, forged protected text rejected, numbered bounded questions. Actual PG previews bind hashes, source revision/generation and fresh MFA; revoking MFA after preview denies confirmation.                                                                                                                                                                                                                                                                                                                                       |
| Actual browser refusal / retry / escaping                               | `browser-final.log`: real Chromium loads built web app with synthetic loopback responses, renders real submitted questionnaire, escapes injected HTML, disables legacy actions, displays readonly exact preview, survives a 503 and retries the same preview/hash with no `/decision` call. Client 13/13 in `client-fetch-units.log`; existing view 9/9 in `units.log`.                                                                                                                                                                                                                                                                |
| Delivery identity / duplicate work / unknown / recovery                 | `pg-worker.log`: duplicate workers send once with exact preview UTF-8 hash; blocked original identity prevents disclosure; ambiguous dispatch stays quarantined and audit-close does not resend. Normal bounded worker composition sends exact stored text, is off by default and stops accepting work. `transport.log`, 3/3: actual transport with injected fetch validates fixed endpoint/plain text/private receipt, denies wrong custody/oversize before sending and never retries bad receipts. No real Telegram request was made.                                                                                                |
| Withdrawal / erase / late work                                          | `pg-worker.log` deletes private preview/message data and prevents late-confirm resurrection while retaining audit hash. `pg-media-privacy-timeout.log` has passing actual `PostgresPrivacyRepository.withdrawConsentAtomically` during a held first disclosure: final payloads disappear and subsequent delivery cannot resurrect them. Legacy privacy/erasure/capture races also pass in `pg-legacy.log`, 32/32.                                                                                                                                                                                                                      |
| Genuine historical upgrade                                              | `upgrade-historical-capture.log`, 1/1: replay through 0061, create real pending/submitted/approved/paid v1 fixtures and synthetic verified payment, then apply 0062. Frozen form fields and nine financial tables compare unchanged; old approved invoice captures after upgrade; paid attempt cannot reapply. Earlier fixture failures are retained (duplicate existing check-work and need for the existing second authoritative GET).                                                                                                                                                                                               |

The final PG v2 file contains 16 cases. The original 12 passed together in
`pg-worker.log`; added/changed cases were run with focused filters as listed above.
There is no claim of an additional unchanged 16-case batch. The 11-file unit batch
had 106 passes and two obsolete expectations; `compatibility-units.log` subsequently
passes that affected file 17/17 using a genuinely unsupported version and decoded
canonical tax assertions. Unchanged files were not broadly repeated.

## Migration and static verification

0062 is hand-authored with contiguous journal entry and matching schema declarations.
No historical migration was changed and no `drizzle-kit generate` was run. Final SQL
replayed on the existing task-owned PostgreSQL 17.5 cluster, using a fresh empty
introspection directory; supported metadata was normalized against exact PostgreSQL
constraints/indexes. `reconstruction-final.log` reports 204 tables, 127 functions,
180 non-internal triggers, 1373 constraints, 513 indexes and 2 extensions. Its
pre-upgrade pending/submitted fixture preserves both originals. Generated snapshot,
SQL-only catalogue and every source migration are hash-bound in `0062_manifest.json`.
The complete catalogue uses compact JSON (883,961 bytes) to remain below the existing
1 MiB inspection ceiling; no objects or checks were removed and the ceiling stayed
unchanged. Do not reformat this machine catalogue to exceed that ceiling.

`repo-inventories-final.log` passes migration integrity 9/9, exact scope inventory
13/13 and initial metadata probes 8/8; its tracked scan found the catalogue size and
unregistered browser harness. `repo-boundary-green.log` subsequently passes boundary
130/130 and metadata/negative probes 9/9. Exact-hash browser registration uses the
existing DOM-harness mechanism; mutated bytes and route lookalikes still fail.
Journal parity 3/3 passed in `repo-inventories.log`. Failed inventory runs remain
retained. Formatting of human-authored changes, changed-file lint, relevant builds,
API/web/worker/test types and whitespace checks are recorded in final logs.
`tests-types-complete.log` is empty because TypeScript exited 0 without diagnostics;
`lint-complete.log` likewise records an exit-0 lint run. Browser final verification
passed after the final web build.

## Failure interpretation and remaining gates

Behavioral failures were retained: initial domain 6/8 RED, missing versioned PG
contract, SQL null-video-MIME acceptance, missing numbered question context in real
manager detail, and optional-licence Back refusal. Each has a corresponding focused
GREEN witness. Initial Chromium queue timeout was a real native-fetch receiver bug:
`browser-diagnostic.log` showed zero API requests. The default browser fetch now
calls `globalThis.fetch` through a closure; final browser passes. Other retained
failures were fixture/configuration or inventory issues, including stale package
builds before the new timeout composition, duplicate test variable, metadata pins,
and test-only typing. The licence skip source fix initially exposed a fixture expecting explicit null while the existing repository clears an omitted cursor; the final focused witness passes. The source fixes were followed by rebuilt consumers.

Category criteria remain `TODO: Wait for Content Spec`. Refund policy remains the
explicit manual/unavailable gate. S2b file custody/extraction/OCR/social checks are
not implemented and are shown as unknown; there are no fabricated download links.
For S2b, consume the immutable `submitted_draft`/`submitted_revision` and explicit
`resident_check_generations(application_id,generation)` with request identity and
supplement revision. Do not rewrite those facts or treat a generation as a passed
external check. This block neither enables providers nor deploys anything.

The coordinator must independently review this exact source snapshot and run the
canonical final gate before acceptance/PR delivery. Hosted CI is absent by repository
policy; no hosted or live-release success is claimed here.
