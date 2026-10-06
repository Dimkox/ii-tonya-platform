# Human-review publication gap audit — 2026-10-06

This is an incomplete acceptance audit, not a release certificate. Source:
`client-consent.factory.json`, all 21 acceptance-case scenario/expected pairs,
with the owner's subsequent ordinary-route correction and publication scope.
The original bundle's implementation statuses are not current evidence.

## Observed baseline

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
