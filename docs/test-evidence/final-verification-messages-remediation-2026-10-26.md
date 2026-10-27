# Verification/messages review corrections — local evidence

Date: 2026-10-26. Branch: `codex/residency-verification-messages-20261026`.
Source baseline: `27d4851c73aebd79b3c59040194f92f0a9d33509`; reviewed contract
amendment: `a3c91dd8ca3adc0b5ef4b3fe5fa6babdd276e4c2`. The corrective source snapshot
is the commit containing this report. Scope is accepted findings R1–R6 in
`final-verification-messages-review-2026-10-26.md` and the existing specification's
amended Design Notes. Coordinator-owned documents are excluded from this commit.

Raw evidence is retained under
`.superpowers/sdd/verification-messages-remediation-20261026/`; the coordinator owns
its durable archive. These are local synthetic checks, not release/provider evidence.

## Changes and closure witnesses

| Finding                          | Correction                                                                                                                                                                                                                                                                                                                                                                                                                                 | Executed RED → GREEN evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R1 terminal recovery             | Existing protected queue includes pending/dispatched/unknown notices on terminal decisions. Authenticated keyset navigation preserves chronological order and the 50-row ceiling; later cases remain reachable when delivery is disabled. Only audited close-without-resend accepts a genuinely owned historical noncurrent attempt, with current consent/identity and fresh manager authority. Other review commands remain current-only. | `pg-red-r123.log`: terminal application missing. `pg-green-r123.log`: terminal queue restored. `pg-queue-red.log`: continuation repeats first row; `pg-queue-green.log`: distinct next application, 1 selected/4 filtered. `pg-command-green.log`: after actual soft reapply, old dispatched notice stays discoverable and can be cancelled with no resend or delivery claim (R6 case, 1 selected/4 filtered). `browser-queue-red.log`: no next-queue control; `browser-queue-green.log`: actual built browser reload, navigate beyond 50 entries, open terminal application and audit-close, then refresh to empty queue. |
| R2 large accepted history        | Detail uses three independently advancing keyset streams. Each indexed query reads at most two records and emits one answer/request/message with an explicit next cursor. Answers retain request id, question number, full question context, request state and deadline. Existing client ceiling remains 262144 characters. First/next controls preserve access to all accepted records.                                                   | `pg-red-r123.log`: accepted 100-answer history exceeds ceiling. `pg-actual-r26.log`: R2 passes (R6 in that same run fails separately): all 100 answers traversed with revisions/context and bounded envelopes; two actual authenticated Fastify detail requests exercise continuation through normal composition. `browser-history-red.log`: next-history control missing; final `browser-queue-green.log`: built client navigates first/last history pages and back.                                                                                                                                                      |
| R3 blocked due subject           | Eligibility joins exclude blocked/mismatched identity and inactive/noncurrent subjects before batch LIMIT. Each eligible subject expires in its own transaction, revalidated with subject/identity locks. Strict identity/write guards are retained.                                                                                                                                                                                       | `pg-red-r123.log`: blocked original identity rolls back valid work. `pg-green-r123.log` and `pg-final-focused.log`: blocked oldest plus valid due request with limit 1; valid request reaches manual review, ordinary authenticated detail succeeds, and actual bounded worker composition delivers a valid notice while blocked work remains.                                                                                                                                                                                                                                                                             |
| R4 stale preview                 | Editor revision increments on action, question and tone changes. Both delayed success and error responses must match the request's editor revision and mounted page generation.                                                                                                                                                                                                                                                            | `browser-r4-red.log`: delayed old response restores confirmability. Final `browser-queue-green.log`: hold actual HTTP preview response, change action, tone and questions, release response; exact-text field remains empty and confirmation disabled. A subsequent fresh preview still confirms/retries normally.                                                                                                                                                                                                                                                                                                         |
| R5 calendar semantics            | Additive SQL introduces pure UTC calendar-month and eligibility helpers. Real event trigger uses genuine DB confirmation time; insertion/retirement/financial guards supply real DB time. No production clock override exists.                                                                                                                                                                                                             | `calendar-red.log`: missing production helper. `calendar-green-final.log`: 1 selected/4 filtered. Production helper covers Jan 31 → Feb 28, leap Jan 31 → Feb 29, Feb 29 → Mar 29; eligibility denies one microsecond early and accepts equality. A genuine freshly confirmed soft event is compared to the helper and independent UTC calendar calculation; actual trigger/guard definitions must consume these helpers. `calendar-30day-mutant-red.log` intentionally changes only the isolated test DB helper to 30 days and fails March 2 versus February 28.                                                          |
| R6 advertised applicant commands | Exercise ordinary Fastify applicant ingress and normal service/PG composition. Early reapply now returns the existing corrective response before the authoritative SQL guard, rather than leaking a wrapped guard failure as 503.                                                                                                                                                                                                          | `pg-actual-r26.log`: actual early `/reapply` returns 503 (source defect). `pg-command-green.log`: wrong `/answers_done` request stays pending, `/answer` plus correct `/answers_done` renews human review/generation, early `/reapply` creates nothing, elapsed soft-refusal fixture permits actual `/reapply` with new current attempt/revision zero and preserved base clock/old financial decision. Same case verifies R1 historical audit-close.                                                                                                                                                                       |

The browser witness uses real Chromium and shipped web assets with synthetic loopback
HTTP responses, not live providers. Its final log records 13 requests, escaped private
HTML, disabled legacy actions, exact readonly preview, editor fencing, paged history,
terminal recovery after reload, and retry of the same hash after a 503. The queue
fixture places the target behind 50 other entries. PostgreSQL witnesses separately
exercise actual repositories, compositions and routes; browser fixtures are not
claimed to be a live browser-to-PostgreSQL deployment.

The elapsed R6 fixture changes time only inside the isolated test database. The R5
confirmed event is measured without rewriting its timestamp/deadline. The mutation
environment variable is read only by the test file; no runtime configuration was
added. Timeout continues to queue human review and never rejects an applicant.

## Changed-code regression and failure accounting

- `pg-v2-regression.log`: existing v2 PG matrix 16/16, including exact hashes,
  financial approval, current consent/withdrawal, actual worker, deferred request
  view/delivery, request binding, stale previews and reapplication race.
- `pg-api-financial-regression.log`: existing actual Fastify/applicant sales and
  financial composition 4/4, including fixed fee/capture and preserved selected terms.
- `changed-regressions.log`: application service 17/17, client 13/13 and view 9/9;
  route had an optional-argument fixture mismatch (49 pass/1 fail overall).
- Final changed queue/API/client checks: `route-queue-green.log` 13/13,
  `client-queue-green.log` 14/14, `view-queue-regression.log` 9/9. These include bounded
  continuation and invalid cursor refusal. Earlier `route-regression-green.log`
  is actually a failed run (accidental argument edit); `route-green-final.log`
  passed 12/12 before the additional queue test. Filenames alone are not verdicts.
- `pg-final-focused.log` had 3 passes and 2 fixture failures resolving Fastify from
  the repository root. Correcting package-relative test import allowed actual R2/R6
  execution; the latter then exposed the real early-reapply 503 described above.
- No combined final 5/5 remediation run is claimed: each added/changed PG case has
  the focused passing witness above. Unchanged broad suites were not repeated.

## Additive migration and exact state

0063 is hand-authored with contiguous journal entry and three history/due indexes
mirrored in schema declarations. It replaces only three existing function definitions
to consume the two pure helpers. 0062 SQL, snapshot, catalogue and manifest remain
byte-for-byte unchanged. No schema generation or historical re-derivation was used.

`environment.log` passed the repository Docker preflight. `reconstruction.log` replays
the complete SQL chain on isolated PostgreSQL 17.5 and introspects into a fresh empty
directory, normalizing supported metadata against PostgreSQL catalogues. Final state:
204 tables, 129 functions, 180 non-internal triggers, 1373 constraints, 516 indexes,
2 extensions. The 0063 snapshot links to 0062. The compact complete SQL catalogue is
885750 bytes, below the unchanged 1 MiB inspection ceiling. Do not pretty-print it.
The reconstruction also preserves two v1 pending/submitted fixtures inserted before
0063; this is not a replacement claim for the original pre-0062 historical upgrade
witness retained with the initial implementation.

`0063_manifest.json` binds all 64 source migrations and these exact artifacts:

- SQL: `a68c5513b4ee341950e6e39eae2c81ff6004b02ba2f1df689a7cc9a41f4e042a`
- Snapshot: `1c6e9a6ed43c4c963ef6986ea28edaf2de0035ea6a584341505e4723be6c0aa0`
- SQL catalogue: `a4df0d0aac2b6fee356fa29f625db4ea65afabdc7d6ce7d69be7228e6ccb3909`

`inventories.log` passes 169/169 across migration history, journal/schema parity,
scope inventory, metadata and payment scope checks. Metadata checks retain 0062 and
add 0063 plus four exact negative byte probes. Tracked-file scope is checked again
after staging the new artifacts, with the reviewed browser harness hash refreshed.

Final staged scope check: `staged-scope-final.log`, 130/130. The preceding
`staged-scope.log` selected a nonexistent filename and ran no tests; it is retained.
DB/application declaration builds and the web build passed (`queue-*-build.log`).
Final tests/API/web/worker typechecks and changed TypeScript/script lint are recorded
with explicit zero exits in `static-exit-status.txt`; individual logs use
`types-*-final.log` and `lint-final.log`. Earlier queue nullability diagnostics are
retained in `types-queue-nullability-red.log` and resolved by assertions under the
existing nonempty-array guards. Formatting and cached/working whitespace checks
passed; the initial formatting log retains the one wrapping correction.

## Delivery boundary

Independent closure review and the canonical final gate remain coordinator-owned
and pending at handoff. No push, deployment, live provider request or finance mutation
outside isolated synthetic databases occurred. Default-off delivery, manual refund
content gate, unknown-send quarantine, and S2b private-job work remain unchanged.
