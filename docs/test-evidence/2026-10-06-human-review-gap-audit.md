# Human-review publication gap audit — 2026-10-06

## Published evidence export RC — 2026-10-09

Exact source `b658b5c15c6992b7596569ab2311ed4a9971d2a6` is pushed to
`rc/client-consent-factory` and installed as both native and web on ii-tonya.ru.
Normal pre-push gate passed syntax, formatting, whitespace, evidence integrity,
outgoing-file lint and tests/repo. No bypass or force push. Factory/Trust CI
remains excluded and is not claimed.

Native build used a fresh shared clone pinned to the source commit; web used a
fresh git archive. Both installed dependencies offline with the frozen lockfile.
Builds, packaged API/worker imports under --jitless, manifest checksums and Cosign
signatures passed. Syft warned about deriving directory artifact names; it exited0.
Manifest SHA256 values:

- Native: `ff24315d2face2c781df9541484778789f4596bb831c49e3201900b502e64cc9`.
- Web: `892d9bfb8b0e31a75820095127f68e321cfbeb6c6767f8d313d4657d21276771`.

Kuhn reviewed rollout/recovery. Missing curl deadlines, short-circuiting rollback
and working-tree web build inputs were corrected; second static review closed
those findings. Deployment holds the release lock, verifies prior source markers,
checks transferred manifests and identical migrations/systemd definitions, backs
up runtime, and preserves all flags while updating only the approval SHA.
No nginx configuration changes or migration execution were needed. Rollout
exited0. Three connection-refused retries occurred during restart; this was not
a zero-downtime rollout.

Post-release readback confirms both source markers, individual API/worker/nginx
services active, readiness checks all true and fresh worker heartbeat. Runtime
flags preserved at2026-10-09T01:00:30.574Z. Chrome checked `/`, `/catalog`,
`/account`, `/account/`, `/consent`, `/my-data`, `/privacy`, `/oferta` with real
TLS verification. All rendered; ready200, anonymous export401 and consents401,
JS errors0, unexpected external requests0, mobile overflow false. Coordinator
inspected the mobile-account screenshot. No real-user login or authenticated
live export was manufactured. This check did not repeat the old no-JavaScript
suite or prove every complete user journey.

Recovery: compatible previous native/web48009f9 remains installed; restore both
symlinks under the same lock, restore root-only runtime backup
`configuration-backups/runtime-before-ac016-b658b5c15c6992b7596569ab2311ed4a9971d2a6.env`
to `/etc/ii-tonya/runtime.env` with root:ii_tonya0640, restart API/worker, and
verify readiness, individual services, fresh worker heartbeat and served source
marker. Database and systemd definitions are unchanged. No live rollback drill
was performed. Never roll back to older grant-incompatible releases.

Owned incoming directory was removed only after post-release identity/checksum
verification. Its contents remain recoverable from signed local release
artifacts. Full product gaps (erasure, approved documents/retention and genuine
user acceptance) stay open. Reviewer access is the public site, not a local URL.

## Final code review and date correction — 2026-10-09

Three independent BMad layers completed (Parfit, Kant, Sagan). Coordinator triage:

- Patch: non-finite presentation timestamps could abort the entire export.
  `projectConsentPresentation` now returns null for that whole presentation when
  either required creation or non-null consumption cannot be represented as a
  finite Date. Valid ISO output and absent consumption are unchanged. Unit
  RED11/14 then GREEN14/14; coordinator repeated this focused unit file once,
  GREEN14/14. This is not PostgreSQL and does not repeat the exhausted scenario.
  Euler independently reviewed the actual mapping hookup and found no blocking
  issue. Build/type/lint results and initial build/type overlap failure are
  recorded in `/tmp/ac016-date-fix-checks-captured.log`; those records are
  explicitly transcribed tool output, not original stdout. Source hashes match.
- Reject sparse-array disclosure: production input is parsed PostgreSQL JSONB;
  array holes cannot survive that boundary and null elements are rejected.
- Reject required predecessor purpose/sequence filtering, link-status additions
  and document-integrity verdicts for this increment: approved export preserves
  owner-scoped historical facts, not a new authority verifier. Null linked
  evidence is intentionally not a claim of complete consent proof. SQL already
  prevents new self-references. No new permission follows from exported data.
- Historical same-time ordering, withdrawal predecessor population, shared-type
  deduplication and broader transfer audit are pre-existing follow-up concerns,
  not evidence that the owner-bound additive projection leaks foreign data.
- The duplicated types currently agree under API/application/DB typechecks;
  stricter discriminated types are a non-blocking improvement. Scope redaction
  is expressly owner-approved and does not claim full audit completeness.
- Sagan's PG16 default observation is accurate for the general testkit, but the
  approved scenario and repository contract require explicit ComposePG17.5.
  Actual9/9 evidence used that path. No claim of a default-command/full-suite pass.
- Suggested extra token-digest and HTTP serialization tests are verification
  improvements. Existing query projects safe fields explicitly; inspected API
  forwards the export object directly without a filtering response schema.

The remaining production limitation is genuine-user authentication/export
acceptance, not synthetic proof. Existing PG ledger stays3/3 exhausted. No
factory/Trust CI work or hosted CI attestation. Release steps follow this code
review; this section alone does not claim deployment.

## AC-016 owner-approved scope correction — 2026-10-09

The updated frozen spec resolves the scope ambiguity described in the historical
checkpoint below. `consent-scope-export.ts` now projects only SQL/JSON null,
an empty object, or an exact `fields` object containing up to two distinct
`display_name`/`timezone` values in original order. Matching DB/application
contracts expose `scopeStatus`: `absent`, `complete`, or `redacted`. Every other
JSON shape exports null plus `redacted`, with no arbitrary keys/values copied
into export diagnostics. Stored JSON remains unchanged; redaction explicitly
means incomplete audit evidence. Owner/purpose/document joins and original
historical decision/document projection remain intact.

Focused verification, against the uncommitted patch on base
`9c705b475936bb944ebb0035acf2fd1f45980cbb`:

- `pwsh -File scripts/check-development-environment.ps1 -RequireDocker`: passed,
  Node24.21.0, pnpm11.9.0, Docker29.8.2 and Compose5.6.0, no failures/warnings.
- `pnpm exec vitest run packages/db/src/repositories/consent-scope-export.test.ts`:
  RED25/25 against the extracted pre-correction verbatim projection, then
  GREEN25/25 after implementation. Covers null/empty distinction, every valid
  field combination/order, malformed/scalar/extra/nested/duplicate scope, and
  preservation of the input without retaining mutable references.
- Existing `tests/integration/consent-evidence-export.test.ts`, same fixture and
  Compose project `ii-tonya-ac016-evidence-20261009`: final invocation GREEN9/9,
  `server_version_num=170005` asserted, duration3.08s. The added scope case checks
  JSON null, valid/invalid shapes, nested credentials/recipient/reservation
  exclusion from serialized output, and unchanged database originals. Earlier
  eight cases retain historical evidence and malicious-link coverage, with
  exact original-document and distinct decision hash/channel assertions.
- PG command: `II_TONYA_TEST_POSTGRES_ADMIN_URL=<isolated Compose admin URL>
pnpm exec vitest run tests/integration/consent-evidence-export.test.ts`.
  Local final output: `/tmp/ac016-pg-final.log`.
- Builds passed: `pnpm --filter @ii-tonya/db --filter @ii-tonya/application
--workspace-concurrency=1 -r --sort run build`, then
  `pnpm --filter @ii-tonya/api run build`.
- Types passed: `pnpm --filter @ii-tonya/db --filter @ii-tonya/application
--filter @ii-tonya/api --workspace-concurrency=1 -r --sort run typecheck`
  and `pnpm exec tsc --noEmit -p tsconfig.tests.json`.
- Scoped ESLint and Prettier checks passed for the five implementation/test
  files listed below; `git diff --check` passed. No broader suite is claimed.

Changed implementation/test files:

- `packages/db/src/repositories/consent-scope-export.ts`
- `packages/db/src/repositories/consent-scope-export.test.ts`
- `packages/db/src/repositories/privacy-repository.ts`
- `packages/application/src/privacy-service.ts`
- `tests/integration/consent-evidence-export.test.ts`

Tracking updates: this audit, `AGENT-STATUS.md`, and
`docs/superpowers/implementation-artifacts/spec-ac016-consent-evidence-export.md`.
The approved frozen spec text was preserved. Coordinator diff refreshed at
`/tmp/ac016-coordinator.diff`, including all five implementation/test files.

PG invocation ledger is now **3/3 exhausted**: (1) missing contracts build,
(2) expected RED8/8, (3) GREEN9/9. No repeated/renamed exhausted file, full suite
or multi-path Vitest run. The original-copy file remains separately exhausted.

The earlier independent review's P1 disclosure finding is addressed by this
owner-approved allowlist and unit/PG evidence; P3 historical-source assertions
also passed. This is implementer evidence, not independent approval of the fix.
No reviewers were launched in this correction: the coordinator performs review.
Spec is `in-review`. No commit, push, deployment, runtime capability activation,
hosted/Trust CI or authentic live-user acceptance is claimed. Broader transfer
auditing, approved document publication and erasure remain outside this increment.
After verification, the owned Compose container, volume and network were removed.
Only disposable synthetic fixtures were deleted; they are reproducible from the
test, but the exhausted invocation budget must still be respected. No task process
remains running.

## AC-016 evidence export implementation checkpoint — 2026-10-09

Spec: `docs/superpowers/implementation-artifacts/spec-ac016-consent-evidence-export.md`.
Base: `9c705b475936bb944ebb0035acf2fd1f45980cbb`, canonical repository,
branch `codex/fin-001-client-access-policy`. Existing audit/status changes and
unrelated untracked files were preserved. This checkpoint is incomplete, uncommitted
local work, not a release or acceptance certificate.

The DB/application contracts now include decision ID, exact decimal sequence,
original channel/scope/hash/basis, owner-checked prior decision ID, and presentation
ID/timestamps guarded by matching owner, purpose and document. Original document
and transport fields remain present. No migration, runtime activation or deployment.

New focused file `tests/integration/consent-evidence-export.test.ts`, using an
isolated Compose project `ii-tonya-ac016-evidence-20261009` and PostgreSQL
`17.5-bookworm`, asserts `server_version_num=170005` and uses a disposable database.
Invocation ledger (maximum three, including setup failures):

1. Failed during collection: missing built `@ii-tonya/contracts`; no tests ran.
   Built the DB/application dependency packages; no source/dependency constraints
   were weakened.
2. RED: all eight tests reached their expected assertions and failed because
   `evidence` was absent. Historical metadata, nullable legacy and exact bigint,
   five invalid/missing presentation bindings with foreign priors, and null
   consumption/dangling prior were exercised.
3. **Not run.** One invocation remains. GREEN is not established.

DB/application/API builds and typechecks, tests typecheck, scoped ESLint,
Prettier and whitespace checks passed for the initial implementation. API
typecheck initially failed on missing built `config`/`observability`; after those
packages were built it passed. The subsequent strengthened historical assertions
have not yet run in PostgreSQL. The exhausted original-copy file was never run;
no full or multi-path suite ran.

One independent, read-only Codex review completed without running tests. The
first reviewer launch failed because explicit model `gpt-6` was unsupported by
the CLI account; retry used its configured `gpt-6.1-sol` model. Findings:

- **P1, unresolved:** verbatim `scope_fields` introduces a new arbitrary-JSON
  export surface. `recordDecision` accepts unrestricted scope objects, including
  nested credential/session/recipient/reservation values. Owner-checked joins
  do not protect that surface. Spec requires both original scope preservation
  and exclusion of those values, but specifies no permitted scope schema or
  redaction/omission representation. Coordinator must resolve this contract;
  inventing an allowlist would silently discard historical evidence.
- **P3, addressed in test source, pending execution:** assert the exact original
  document and seed distinct decision/presentation channel and document/decision
  hash values so substitution cannot pass unnoticed.

Reviewer otherwise found no blocking defect in linked-record ownership, nulls,
sequence serialization, timestamp normalization or transport compatibility.
After the coordinator's instruction, no further independent or multilevel BMad
review was launched. Handoff artifacts in this workspace:
`/tmp/ac016-coordinator.diff` and `/tmp/ac016-independent-review.txt`.

Remaining: agree the safe historical scope projection, implement and cover it,
use the last focused PG invocation, refresh relevant static checks and coordinator
review. Authentic live login/export, approved documents, broader scoped-transfer
audit and release evidence remain separate limitations. No hosted CI, Trust CI,
factory, production verification or erasure completion is claimed.
The owned Compose container, volume and network were removed; only disposable
synthetic fixtures were deleted and can be recreated by the test. No live state
was touched. Reviewer/build/test processes are terminal.

This is an incomplete acceptance audit, not a release certificate. Source:
`client-consent.factory.json`, all 21 acceptance-case scenario/expected pairs,
with the owner's subsequent ordinary-route correction and publication scope.
The original bundle's implementation statuses are not current evidence.

## Observed baseline

This section and the table below describe the initial audit, not the latest
deployment. Latest recorded publication is native/web RC
`48009f9ce4de9f8258eede8d59b950899eafd0a8`; see
[publication evidence](production/2026-10-07-original-consent-export.md).
Navigation corrections and original-document export are published, not merely
local. Their historical descriptions below are retained as evidence chronology.
AC-007 now has published structured booking code; AC-016 has original-copy
implementation and focused local evidence, but neither establishes the remaining
authenticated live acceptance. AC-020 public/browser checks passed at publication,
not every consent/refusal journey. Full acceptance remains incomplete.

Continuation availability check: two fresh TLS-verified curl requests to
`https://ii-tonya.ru/SOURCE_SHA` each exited28 at the SSL connection timeout
(10-second connection limit, 20-second total limit). No HTTP response or current
SHA was obtained. This does not prove a server outage, nor revalidate availability;
network/host diagnosis is needed before a new live-health claim. No production
mutation or test-suite execution accompanied these probes.

Follow-up isolated the failing path: `HTTPS_PROXY` is set in this execution
environment. With only proxy use disabled (`curl --noproxy '*'`), verified HTTPS
returned200 from157.22.187.237 and SOURCE_SHA matched48009f9; HTTP returned301.
Pinned-key SSH then ran the read-only `live-state.mjs` checks successfully:
native/web exact SHA, API/worker/nginx active, fresh worker heartbeat, expected
capability flags and no owned staging leftovers. The earlier proxy-path timeout
is not evidence of a production outage. No proxy configuration, application or
production state was changed; authenticated-user scenarios remain unverified.

- Local revision: `62b31d9b260b7f4fcedb55434c26556c0e92521f`.
- Public `https://ii-tonya.ru/SOURCE_SHA`, freshly fetched with TLS verification:
  `425e647a6e8a577095df2d9a89f28660d5a781ef`.
- Development environment check passed: Node24.21.0, pnpm11.9.0.
- No test suite or production mutation in this audit. Earlier focused evidence
  remains attributable to its original revision and scope only.

## Acceptance disposition

"Unverified" below means acceptance is not established; it does not mean that
all underlying code is absent. Each unresolved row needs code/test/live evidence
appropriate to that scenario before a completion claim.

| Case   | Required boundary                                           | Current audit disposition                                                             |
| ------ | ----------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| AC-001 | Start/payment/document opening cannot grant consent         | Unverified in this audit; inspect navigation and decision evidence                    |
| AC-002 | Ordinary document decision, replay and identity binding     | Unverified in live; approved document availability must be checked                    |
| AC-003 | Refusal preserves public/ordinary selection                 | Empty catalogue accepted; refusal journey still needs verification                    |
| AC-004 | Signature admission                                         | Positive signed route deferred by owner; negative admission remains required          |
| AC-005 | No pre-admission content in stores, telemetry or processors | Full sink coverage unverified; closed ingress alone is not complete sink evidence     |
| AC-006 | No old-message replay after grant                           | Existing navigation replay evidence must be mapped; do not rerun exhausted PG file    |
| AC-007 | Structured-only selection, no inferred sensitive attributes | New booking code exists locally; not in observed live revision                        |
| AC-008 | No external AI without separate authority                   | Positive detailed mode deferred; external denial still required                       |
| AC-009 | Exact recipient/meeting/snapshot authorization              | Unverified; do not enable disclosure on a generic consent boolean                     |
| AC-010 | Booking without note; restricted expert visibility          | Local booking evidence exists; live authenticated journey remains unverified          |
| AC-011 | Fresh note access denial after withdrawal/reschedule        | Unverified; closed disclosure is not evidence of the positive scoped flow             |
| AC-012 | Withdrawal fencing and no revival after regrant             | Prior async release evidence exists; map exact scenarios before closing               |
| AC-013 | Late response and old outbound denial                       | Prior async release evidence exists; map exact scenarios before closing               |
| AC-014 | Expiry/refusal/selective and all withdrawal across surfaces | Browser controls exist; complete live site/bot evidence missing                       |
| AC-015 | Erasure progress/exceptions and safe backup restoration     | Incomplete: browser erase always returns503; no end-user request is submitted         |
| AC-016 | Immutable original document and own downloadable evidence   | Unverified; subject export route is not by itself proof of every document requirement |
| AC-017 | Legacy and minor admission denial                           | Unverified in this audit; no automatic special-mode promotion permitted               |
| AC-018 | Direct API/model cannot manufacture consent                 | Unverified in this audit; preserve server evidence checks                             |
| AC-019 | Kill mode/rollback retains rights and financial rules       | New RC recovery compatibility and published rights must be verified                   |
| AC-020 | Public catalogue/help/rights without AI or payment          | Catalogue emptiness accepted; full public route/accessibility checks pending          |
| AC-021 | Uncovered third-party/categories stay closed                | Detailed free-text remains excluded; negative boundary coverage still required        |

## Concrete source findings

1. `apps/api/src/routes/browser-account.ts`: session responses advertise
   `erasureAvailable: false`; authenticated `privacy/erase` returns503 before
   forwarding. A runtime flag change cannot complete this route.
2. `apps/api/src/routes/client-privacy.ts`: erase supports an optional
   `eraseSubject` dependency and202 response, otherwise503. This existing backend
   interface alone does not establish browser support or complete erasure.
3. `apps/web/src/consent-view.ts`: explicitly tells users deletion is unavailable
   and no request was sent. Keep that truthful until a real request/status flow
   exists; do not replace it with a success message or unsupported completion.
4. The same view initializes booking only at exact `/account`, excluding the
   trailing-slash route. `booking-view.ts` disposes on pagehide without a matching
   pageshow reconstruction. Both previously reviewed defects remain present.

## Remaining publication work

Finish source-to-acceptance mapping, close ordinary-route gaps, verify focused
changes within existing run budgets, independently review, prepare RC and recovery,
publish native/web on the separate host, and verify the actual published account.
Record authentic-login limitations explicitly; synthetic proofs are not a real
Telegram login. No fabricated experts, services, documents or provider facts.

Factory/Trust CI integration is excluded. Its absence is an external-acceptance
limitation, not permission to call local tests external CI. Human acceptance is
still required after publication. The full goal remains active.

## Navigation correction — local, not deployed

The two source findings above were reproduced by the new
`apps/web/src/account-navigation.test.ts`: initial focused run failed2/2, then
passed2/2 after the correction. This is a new navigation file, not a renamed or
re-executed exhausted account concurrency suite; two invocations have been used.

`consent-view.ts` now uses the same trailing-slash normalization as `main.ts`.
On persisted pageshow it reloads the document via GET, abandoning cached
controllers and obtaining fresh session state without automatically replaying
mutations. The Chrome fixture uses real views/controllers and synthetic HTTP
responses and lifecycle events; it does not prove a real browser bfcache eviction
policy, Telegram authentication or live production behavior.

Verification: web typecheck/build, ESLint for both changed TypeScript files and
`git diff --check` passed. No PostgreSQL, full suite or old exhausted file was run.
Disposable Chrome profile directories and Vite servers were cleaned up by the
fixture. Independent Curie review found no Critical/Important issue in the bounded
patch. One Minor verification gap remains: the fixture does not inspect request
methods or exercise a changed authority with a pending mutation, so it cannot
prove write non-replay. Actual bfcache eligibility/freeze ordering and pending
privacy callbacks during delayed/failed reload also remain unverified. The reload
implementation contains no new write call; that inspection is not broader test
evidence. No new release is claimed.

Erasure follow-up inspection: `server.ts` intentionally supplies a pseudonymizer
that throws, and `app.ts` does not compose `eraseSubject`. The repository requires
verified processor manifests before deletion and revokes sessions/deactivates the
subject in its transaction. Therefore completing AC-015 needs a designed durable
request/status path and verified deletion composition, including access to status
after session revocation; forwarding the existing browser route alone is unsafe
and insufficient. Preserve current denial until that path is implemented.

## Post-activation privacy audit — 2026-10-06 23:31 UTC

Pinned SSH/read-only transaction on live
`d0a34370b72e57bf56bf0a9806d31432d5931fa0` returned approved_documents0,
deletion_jobs0, deletion_manifests0, retention_items0 and booking_grants0.
These are point-in-time aggregate observations, not deletion proof or a claim that
the whole database contains no personal data. No mutation or synthetic login ran.
Reproduction helper: `/tmp/ii-tonya-booking-activation.BmIJgf/privacy-inventory.mjs`.

Existing `docs/legal/owner-update-legal-review.md` concerns public policy/offer,
not approval of six separate purpose documents. The source bundle is a requirements
draft, not a ready approved document registry. Owner was asked asynchronously for
the location of final documents/retention matrix or permission to prepare drafts.
No signing prerequisite is being reinstated.

AC-016 has a confirmed implementation gap independent of legal approval:
`PostgresPrivacyRepository.exportOwnedSubject` selects purpose, decision,
policyVersion and createdAt from consents only. It does not return the linked
immutable document body/title/version/hash or evidence binding, despite0039
storing document_version_id and text_sha256. The browser's document-download action
uses a new current presentation, not necessarily the version originally accepted.
Therefore later document publication can leave the subject without their original
copy through the existing export/download flow.

Next independently implementable correction: extend the owner-scoped export with
the original linked immutable document/evidence (including revoked/older versions),
preserve legacy decisions without inventing documents, and exclude foreign-user
decisions/documents. Cover original-vs-current version, cross-owner denial and legacy
absence with focused tests. This is not permission to publish unapproved texts or
claim AC-015 complete. Existing test budgets remain unchanged.

### AC-016 original-copy implementation evidence

The original-document export correction is now implemented locally in the DB
repository and application interface. Each owner's decision includes its linked
immutable document (id/key/version/title/body/SHA256), or explicit null for a legacy
or otherwise unbound decision. The query uses the original document ID, not latest
version/status, so replacement and withdrawal retain the original accepted copy.
The existing browser JSON download carries the new field without HTML rendering.

Focused new PostgreSQL17.5 file `consent-original-export.test.ts`: run1 RED2;
run2 1/2 because the test used nonexistent withdrawn instead of revoked; run3
GREEN2 after correction and stronger isolation assertions. Budget3/3 consumed.
Version170005 is asserted in the fixture. Tests cover original copy after newer
publication and withdrawal, exclusion of foreign decisions, and legacy null.
Application service9/9 and relevant builds/typechecks/lint/format/diff passed.
Parfit found no Critical/Important issue; the Minor exact-isolation assertion was
added before the final successful run. This is not live document publication,
legal approval, complete audit-evidence export, or full AC-016 acceptance proof.

### AC-016 residual evidence scope

Direct inspection of `client-consent.factory.json.acceptance_cases[15]` confirms
the requirement includes original scope and evidence sufficient for an auditor
to reproduce consent, not only the original document copy. The current
`SubjectExport.consents` and repository SELECT expose purpose/decision/policy/time
and original document. They do not expose the decision ID, sequence, channel,
scope_fields, presentation_id, prior_decision_id, recipient_id, reservation_id,
decision text_sha256 or basis stored by `schema/identity.ts`.

This establishes a limitation of the downloaded export, not proof those fields
were never persisted or that every internal field should be disclosed verbatim.
Next design must specify the owner-safe evidence projection, preserve legacy nulls
and distinguish the original decision's scope from current authority. Raw
presentation credentials or foreign-recipient identifiers must not be exposed
merely to fill an export. The original-copy test is exhausted at3/3 and does not
prove this residual auditor-reproduction requirement. No implementation or
acceptance closure is claimed by this inspection.
