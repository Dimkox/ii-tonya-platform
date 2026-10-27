# Residency core stabilization implementation — 2026-10-26

Contract: `docs/superpowers/implementation-artifacts/spec-residency-core-stabilization.md`.
Assigned worktree is `.worktrees/phase1-owner-plan-20261023`, branch
`codex/residency-foundation-20261026`, canonical Dimkox/ii-tonya-platform origin.
Source started at5715c7a7cac2a57de885fb8823aeb57c05aab1f5 after coordinator checkpoints;
the approved spec retains its original567e71b4dea4bd2720da452c8049916f9d2b437c baseline.
The implementation commit containing this evidence is the source review candidate;
the coordinator records its complete SHA and subsequent exact-source gate separately.

## Delivered source

- Bot-independent `createResidentWorkspaceService().activateResidentWorkspace(userId)`
  accepts internal UUIDs only. Shared `activateResidentWorkspaceInTransaction` runs inside
  canonical verified settlement, after proof validation/fact persistence and before commit.
  Stored paid3000 onboarding, active owner, original current consent and available application
  own interview admission. Ordinary unpaid approval and missing manager exception deny.
  ACCESS_ACTIVATED is unique per application, and the read-only access view is informational.
  No main entitlement, order or public publication follows from interview admission.
- Existing durable interview_ready work now has a configured promo notification consumer in
  the actual worker cycle. It rechecks original promo channel ownership/consent, persists one
  attempt as unknown before sending, and uses the same owner-bound work-bot handoff helper as
  explicit handoff requests. Receipt bot/chat/message bindings are verified. Ambiguous work
  stays unknown and is never blindly resent; missing identity cancels pending work durably
  rather than starving the batch. Worker shutdown stops claims and aborts current delivery.
- The real work-bot document path saves its private original first. Optional bounded trusted
  byte reader plus SafeDocumentParser extract local PDF/DOCX into private untrusted proposal.
  Failure/unavailable capability keeps durable INTERVIEW and the exact supplied Russian
  fallback message. Owner, consent, document request, editable status, draft revision and
  erasure are rechecked on completion. First completion owns its revision; conflicting replay
  cannot replace successful extraction with fallback. Request abort and API pre-close feed the
  parser signal. Text/parse results never populate the approved public four-field JSON.
- The explicitly shipped Python3.12 helper/uv lock use PyMuPDF1.26.7 and python-docx1.2.0.
  Node bounds copied input5MiB, one active child,5s default/10s maximum wall time,400000wire
  bytes,64000text bytes and90000serialized proposal bytes. The last limit prevents escaping
  amplification from exceeding the database JSON bound. Helper bounds40PDF pages,256ZIP
  members,20MiB expansion/10MiB member/200x ratio,3CPU seconds,384MiB address space and32FDs;
  file-size growth/core dumps are disabled. This is not a filesystem sandbox: empty-file
  creation and other filesystem mutations remain possible, as demonstrated by subprocess
  acceptance in the review remediation record. DOCX entities/external relationships are rejected.
  Cancellation kills/reaps before releasing the slot. Warnings carry one fixed reason only.
- One canonical hashtags_db contains all164 owner entries/7categories, deterministic UUIDs,
  preserved labels/synonyms/source provenance and weight5. Idempotent SQL never installs mocks.
  hashtags_taxonomy provides the old four-column shape. Private paginated InlineButtons save
  at most20 active IDs to owned editable drafts with revision/scoped replay/erasure. The
  private tags_array projection contains selected labels. Six historical mock rows exist only
  under tests/fixtures. No semantic recommendations/custom tags/qualification claims are added.
- Hand-authored0058 SQL/journal/schema, fresh full-chain normalized snapshot and additive SQL
  catalogue are registered by exact hashes. Existing-table checks and the new audit index are
  retained precisely. Scope guards add individual relations/flags/artifacts, with adjacent-name
  and byte-mutation negative probes; the historical snapshot-gap baseline is unchanged.

## Executed evidence

Logs are retained losslessly as gzip under `residency-core-stabilization-2026-10-26/logs/` with SHA256SUMS and original-byte hashes in raw-log-manifest.json. Compression preserves terminal whitespace without weakening the repository whitespace gate.
The original commands used Vitest min/max workers1 and serialized the existing task-owned
PostgreSQL17.5 cluster from protected0600 configuration. No credential/config/URL was printed.

| Check                                                                                                                                      | Result                                                                        |
| ------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------- |
| Environment preflight with RequireDocker                                                                                                   | Node24.22.1/pnpm11.9.0, PASS                                                  |
| Locked Python real PDF/DOCX/scan/encryption/pages/ZIP/entities/short text                                                                  | 5/5                                                                           |
| Node adapter final acceptance, including actual locked helper PDF/DOCX and timeout/crash/flood/abort/fixed-warning sentinel/JSON expansion | 3/3, real helper case executed                                                |
| Workspace application service UUID/default-off authority                                                                                   | 1/1                                                                           |
| Existing card service regression                                                                                                           | 44/44                                                                         |
| Six-mock private tag UI and abuse/default-off checks                                                                                       | 2/2                                                                           |
| Real fixed-origin promo transport receipts/ambiguity/output bounds                                                                         | 2/2                                                                           |
| New worker notification composition/cycle/shutdown                                                                                         | 3/3                                                                           |
| Existing worker materials lifecycle regression                                                                                             | 4/4                                                                           |
| Independent tag/notification default-off configuration                                                                                     | 2/2                                                                           |
| Existing card configuration regression                                                                                                     | 28/28                                                                         |
| Full focused stabilization PostgreSQL/Fastify acceptance                                                                                   | 10/10, no skipped cases, including actual PDF/DOCX through the work-bot route |
| Narrow post-audit notification-report remediation                                                                                          | Behavioral RED1 failed; GREEN2 passed,8 unrelated cases filtered              |
| Narrow import-completion replay remediation                                                                                                | Behavioral RED1 failed; GREEN1 passed,9 unrelated cases filtered              |
| Existing canonical verification/settlement regression                                                                                      | 23/23 PostgreSQL                                                              |
| Full SQL replay and fresh empty-directory introspection                                                                                    | 59migrations,176tables;2new functions/1trigger/2views/13constraints/4indexes  |
| Exact core catalogue/provenance/artifact/negative probes                                                                                   | 9/9                                                                           |
| Existing scope/inventory/history/hybrid parity/DB schema parity                                                                            | 130/130;10/10;9/9;3/3;12/12                                                   |
| Affected config/integrations/application/db/API/worker builds and types                                                                    | PASS                                                                          |
| Full test TypeScript                                                                                                                       | PASS                                                                          |
| Changed TypeScript ESLint, formatting and whitespace                                                                                       | PASS                                                                          |

Initial parser/workspace RED commands failed module collection because the new module did not
exist; these are not claimed as executed behavioral rejections. Later unknown-outcome/import
replay and JSON-escaping-bound regressions executed failing assertions before their fixes.
Retained diagnostic failures also include unsupported test identity status corrected to the
actual blocked state, closed-worker test expecting success corrected to a rejection, initial
source guard inventory before registration, an alias-based negative probe corrected to direct
process.env syntax already supported by that guard, a configuration-shape regression fixed by
omitting the optional false setting, one test-only lint expression and test fixture type errors.
No assertion, engine, financial rule, lockfile or feature ceiling was relaxed to fit the host.
The task's existing owner run-count override was used only for new narrow behavioral defects;
no unchanged broad-suite replay or full pnpm verify was run.

## Matrix coverage and limits

Activation/denial/recovery are executed in stabilization and canonical settlement PG cases.
Success/fallback/cancellation/stale completion/erasure use real helper Node/Python tests plus
real Fastify/PG import cases. Tags and tag-abuse cover actual InlineButtons, pagination,
save/reload,20-limit,unknown/inactive IDs,request conflict,stale/group/wrong-bot/missing-chat
and erasure; catalogue wording is compared against the complete owner archive.

All new provider/UI capabilities default off. A real Telegram file-fetch adapter is not
activated here; missing byte reader/parser uses honest durable manual fallback. The packaged
helper is not execution evidence for Node-only images or the existing256MiB native worker.
Its384MiB process bound requires a separately reviewed isolation/cgroup/runtime/release design
before production execution. No global Python package installation is assumed.

Manager prepayment-exception production, full three-mode onboarding, structured LLM extraction,
semantic recommendations/custom-tag moderation, provider/staging/production activation and
release evidence remain explicitly outside this frozen core increment. The newer owner sales
priority is tracked by the coordinator's separate master-plan addendum, not silently folded
into the frozen stabilization contract. Independent review, final exact-source branch gate,
root documentation checkpoint and draft STABILIZATION PR remain coordinator-owned and pending.
