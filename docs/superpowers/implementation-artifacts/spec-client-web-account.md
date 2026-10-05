---
title: "Working client web account and privacy controls"
type: "feature"
created: "2026-10-04"
status: "in-review"
baseline_commit: "e364b1ea1fc611d5042b22c154ce01f1d314b438"
context:
  - AGENTS.md
  - AGENT-STATUS.md
  - client-consent.factory.json
---

## Intent and authority

Deliver the actual browser path for factory CAP-6/8: authenticate, inspect independent consents, read their exact documents before deciding, withdraw, export, and request erasure. This is an implementation slice of the approved complete factory scope, not a claim the entire factory is ready. The owner explicitly authorized implementation, RC push, and production publication; main agent owns external operations. This implementer is the sole repository source writer, does not commit/push/deploy, and must preserve unrelated untracked files. Other agents are read-only. Use existing approved artifacts rather than manufacture provider/legal evidence. If inspection establishes a better equivalent safe design, adjust implementation details and document the reason.

## Code map and known break

- `apps/api/src/server.ts`: default production lifecycle never supplies `clientSessionComposition.verifier`; enabling sessions fails preflight. Existing sessions and privacy endpoints are disabled on live (404).
- `apps/api/src/client-proof-verifier-gate.ts`, `client-session-token.ts`, `client-principal-resolver.ts`, `routes/client-sessions.ts`: bounded verifier, digest-only session persistence, strict bearer API. Preserve that API boundary.
- `packages/application/src/client-session-service.ts`: proof verifier must return exact userId/audience/scope/expiry/replayDigest. `packages/db/src/repositories/client-session-repository.ts`: replay rejection and DB-clock expiry.
- `packages/db/src/schema/identity.ts`: active users and Telegram channel identities. Bind cryptographically verified Telegram identity to exactly one active subject; fail closed for blocked, duplicate, conflicting, or ambiguous mapping. No caller-provided internal UUID.
- `packages/config/src/env.ts`, API preflight: defaults remain disabled, configured production authentication must be validated without printing secrets. Do not enable unrelated Telegram live-provider flag: buildApp rejects live integration flags.
- `apps/web/src/main.ts`, `consent-view.ts`, `styles.css`: current UI has no login, sends unauthenticated fetches, grants without showing documents, hardcodes versions, and sends denial instead of withdrawal. Replace these broken interactions, preserve landing/legal presentation.
- `packages/db/src/repositories/consent-evidence-repository.ts`: immutable approved documents and one-use presentation; extend DTO with exact title/body/version/hash read from persisted document. Do not expose unapproved or cross-user documents. Existing current-consent oracle stays authoritative.
- `apps/api/src/routes/client-privacy.ts`, `packages/application/src/privacy-service.ts`, DB privacy repository and worker erasure: existing export/withdraw; erasure route is uncomposed and must not report completion without evidence.

## Requirements and tasks

- [ ] Write behavioral failing tests before production changes. Run focused files, relevant package builds/typechecks/lint; never run full suite or multi-path tests yourself (main owns once). PostgreSQL test file max three executions. Record actual red/green commands. Missing import/dependency is not the red test.
- [ ] Implement production-capable Telegram proof verifier using existing bot credential (server-only): support validated Mini App initData and legacy login widget signed payload for normal browser access if feasible. Consult official Telegram documentation. Constant-time HMAC, strict duplicate/shape/size rejection, timestamp freshness/future checks, replay digest, expected audience/scope, bounded processing. Telegram identity authenticates an account; it never grants any processing consent or written signature. Resolve or minimally create identity transactionally with concurrency/ambiguity protection; do not copy names/photos/contacts. Missing credentials fail preflight, not silently bypass it.
- [ ] Implement browser session boundary separate from strict bearer client API. Use host-only Secure HttpOnly SameSite cookies, bounded lifetime, no token/user identity in browser storage or query URLs. Enforce exact configured Origin plus CSRF protection on all mutations including login/logout. Only a finite allowlist of privacy endpoints may be proxied internally; never arbitrary URL/header forwarding. Session probe and logout work without content consent. Ensure payload/cookie/proof is absent from logs and responses. Rate limit login.
- [ ] Add account/login UI reachable from landing and privacy pages; Telegram login is explicit user action, not automatic third-party script before a click. Mini App may use authentic initData. Handle unavailable config, denied login, expiry, loading, retry and sign-out honestly. No collection controls before authenticated session; no working claim on 200 HTML alone.
- [ ] Replace combined checkboxes with separate document-then-explicit-decision actions. Show exact server document body safely as text, title/version/hash, download copy; server owns presented version. Opening never grants; no preselected checkboxes; denial doesn't withdraw active grants. Use actual withdrawal for each current purpose and a truthful all-withdraw operation (report partial failures). Optional follow-up, expert note/handoff and AI remain independent. No fake legal text/default grants.
- [ ] Make export an actual download. Compose erasure with a dedicated environment HMAC key and existing transactional privacy repository only if safe; show request status (pending is not deleted). Do not enable production deletion of real subjects in tests. Expose capability unavailability honestly rather than a dead success button.
- [ ] Cover behavioral contracts: forged/stale/wrong-user/replayed proofs, ambiguous identity, CSRF/cross-origin/missing session, denial vs withdrawal, exact document display/no grant before decision, API failures, valid export/logout. Add deployment configuration notes without secret values; main handles release assembly and environment activation.

## Acceptance

Given no browser session, privacy pages offer login and public documents/catalog remain available; no private API response leaks data. Given authentic fresh Telegram proof, one server-bound cookie session permits own privacy actions and logout invalidates it. Forgery/replay/cross-origin writes are denied. Given a displayed approved document, explicit decision references that exact immutable version; changing purpose/subject/version or reuse is denied. Given active consent, withdrawing invokes revocation fencing, not a new denial fact masquerading as revocation. Export downloads only the subject's data. Erasure reports factual pending/completed state with no fabricated provider/backup proof. Missing special-signature/legal/provider readiness never opens free text, LLM dispatch, or expert disclosure.

## Verification record

Implementation source is ready for main-owned independent review and the HTTPS
browser sequence. No commit, push, bot mutation, production environment change,
legal seed, or deletion activation was performed by this implementer. The parent
factory remains incomplete.

### Implemented

- Default lifecycle composes the bounded Telegram verifier from server credentials.
  Mini App and optional legacy widget HMAC verification reject bad signatures,
  stale/future timestamps, duplicate/unknown fields, invalid scope/audience, and
  ambiguous subjects. Existing session receipts own replay rejection. Transactional
  identity creation stores only the Telegram identifier and an active subject.
- `/v1/browser/session` and finite privacy bridge keep session bearers in host-only
  Secure HttpOnly SameSite=Strict cookies, with exact-Origin, session-bound CSRF,
  bounded lifetime, rate limits, no-store responses, probe, and logout.
- `/account`, `/consent`, `/my-data` and landing/legal links now use explicit login,
  independent document/decision/withdraw actions, safe document text, exact version
  and hash, document download, subject JSON download, partial withdrawal reporting,
  and explicit erasure unavailability.
- Consent repository returns persisted document content, binds purpose and server
  policy version, excludes future/unapproved documents, rejects stale presentations,
  and prevents denial from replacing withdrawal. Document publication is locked
  against redemption. The existing current-consent oracle is preserved.
- Removed Telegram SDK loading because its current implementation persists launch
  parameters in sessionStorage. Mini App launch data is kept in memory and removed
  from the fragment; optional widget loading remains behind explicit user action.
- Fixed the separately requested pre-existing two-argument `toContain` assertion
  in `tests/repo/workflow-semantics.test.ts` as two independent assertions.

### Focused verification

All commands below were separate single-file runs, not a multi-path or full suite.

| Command                                                                     | Actual result                                                                                                                                                                         |
| --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pwsh -File scripts/check-development-environment.ps1` and `-RequireDocker` | PASS: Node 24.21.0, pnpm 11.9.0, Docker/Compose; no failures                                                                                                                          |
| `pnpm exec vitest run apps/api/src/telegram-client-proof.test.ts`           | RED 3 behavioral failures; GREEN 5/5                                                                                                                                                  |
| `pnpm exec vitest run tests/integration/telegram-client-identity.test.ts`   | RED 2 behavioral failures; GREEN 2/2; two PostgreSQL executions                                                                                                                       |
| `pnpm exec vitest run apps/api/src/routes/browser-account.test.ts`          | RED 2 route/response failures; GREEN 2/2                                                                                                                                              |
| `pnpm exec vitest run apps/api/src/client-web-composition.test.ts`          | RED preflight/origin failures; GREEN 2/2                                                                                                                                              |
| `pnpm exec vitest run tests/integration/client-web-consent.test.ts`         | RED 4 behavioral failures; second run exposed two fixture defects (immutable-document update and reset retaining document versions); corrected fixtures, GREEN 4/4 on third/final run |
| `pnpm exec vitest run tests/integration/consent-grant-path.test.ts`         | GREEN 6/6, one execution; adjusted old test to distinguish initial denial from subsequent grant                                                                                       |
| `pnpm exec vitest run apps/web/src/consent-view.test.ts`                    | RED missing login; GREEN 1/1                                                                                                                                                          |
| `pnpm exec vitest run apps/web/src/privacy-client.test.ts`                  | RED 3 behavior failures; GREEN 3/3; main then reproduced real Chrome `fetch` illegal receiver, added default-transport regression RED with exact TypeError, wrapper fix GREEN 4/4     |
| `pnpm exec vitest run apps/web/src/telegram-launch.test.ts`                 | RED missing fragment data; GREEN 1/1                                                                                                                                                  |
| `pnpm exec vitest run tests/repo/workflow-semantics.test.ts`                | GREEN 12/12 after requested assertion fix                                                                                                                                             |

The final consent run and the existing grant-path run used the main-owned isolated
PostgreSQL 17.5 fixture via `II_TONYA_TEST_POSTGRES_ADMIN_URL`; no real subjects were
used. Do not rerun `client-web-consent.test.ts` in this task: its three-run budget
is exhausted. Main owns the separately scheduled full suite/release verification.

Package builds passed for config, database, API, and web. Main separately reported
all-package `pnpm build` passed. After the Chrome transport fix, only
`pnpm --filter @ii-tonya/web build` was run; the resulting asset is
`index-Cv6tEl1f.js`. API/web/config/database typechecks passed. Tests typecheck
initially found the pre-existing assertion defect and one optional-property test
typing issue; both were corrected, then `pnpm exec tsc --noEmit -p tsconfig.tests.json`
passed. Changed TypeScript ESLint passed after removing one unused parameter.

### Review files and remaining limits

Authentication/composition: `apps/api/src/telegram-client-proof.ts`,
`apps/api/src/routes/browser-account.ts`, `apps/api/src/server.ts`,
`apps/api/src/app.ts`, `packages/config/src/env.ts`,
`packages/db/src/repositories/client-session-repository.ts`.

Consent authority: `packages/db/src/repositories/consent-evidence-repository.ts`,
`apps/api/src/routes/client-privacy.ts`.

UI: `apps/web/src/privacy-client.ts`, `apps/web/src/telegram-launch.ts`,
`apps/web/src/consent-view.ts`, `main.ts`, `landing-view.ts`, `legal-view.ts`,
`styles.css`, plus the corresponding focused tests listed above.

Configuration and release limits are in
[client web account operations](../../operations/client-web-account.md).
The browser fixture and security review belong to main and are pending here;
the first real-browser run exposed the now-fixed fetch receiver defect. Local
unit/route checks are not a claim of release acceptance. Runtime source is frozen
after that fix for the next independent browser run.

No approved documents exist in production per main's read-only inventory; none
are manufactured. Widget remains disabled until actual BotFather-domain readiness
is verified. Main owns the confirmed bot's Mini App menu setup. Session lifetime
is five minutes, and the process-local CSRF key requires a new probe after restart
and a single API instance/session affinity. The export is the existing supported
subject projection, not proof of complete full-factory data-class coverage.
Erasure remains unavailable: content/outbox/consent-authority deletion and actual
processor/backup proof are unresolved. No public-catalog expansion was made.

### Main-owned browser result after source freeze

Main reported the independent HTTPS Chrome sequence GREEN using
`/tmp/ii-tonya-web-e2e.4Lboxg/browser-smoke.mjs` with the isolated PostgreSQL 17.5
fixture: real signed HMAC proof through default lifecycle and PostgreSQL; Secure
HttpOnly session cookie; escaped exact document display and download; opening
without grant; one independent grant; actual withdrawal; subject JSON download;
logout; missing-CSRF 403; replay 401; no page errors. This supersedes the earlier
pending browser note. Runtime source is frozen. Main now owns the full suite and
three independent reviews; release acceptance remains pending those results.

### Review remediation — 2026-10-05

Main completed and triaged three independent BMad reviews and explicitly
re-engaged the cabinet writer for this bounded patch. The records above describe
the earlier implementation and freeze; this section supersedes their pending
review wording. Main separately owns dependency manifests/lockfile/payment pins,
nginx and edge tests, the parent spec, deployment and release authorization.

Accepted findings and implemented disposition:

| Finding                                              | Disposition / durable coverage                                                                                                                                                                                                                                    |
| ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Forged HMAC tests lost the resolvable subject     | Mini App and widget tests now corrupt only the hash, retaining valid subject 42; valid counterparts resolve before forged counterparts fail.                                                                                                                      |
| 2. Exact-Origin negative lacked valid CSRF context   | BFF test uses otherwise valid nonce/cookie/CSRF/body, rejects foreign/trailing-slash/suffix origins, then accepts the exact origin.                                                                                                                               |
| 3. Non-atomic implicit session rotation              | Stop redundant issuance: an existing session cookie returns 409 before issue/revoke, tested with a failing revoke port and exactly one total issue call. Probe clears expired/denied cookies.                                                                     |
| 4. Inactive-user logout; unbounded persistence       | Exact-token revocation no longer depends on user activity (browser and bearer routes). Issue/revoke/cleanup set 2-second statement and 1-second lock timeouts. Real PG tests cover inactive/reactivated subject and blocked issue/revoke with no orphan receipts. |
| 5. Consent wait/expiry race                          | Presentation, redemption and withdrawal have 2-second statement and 1-second lock limits. Redemption compares expiry to `clock_timestamp()` after the advisory wait; PG reproduces expiry during a held lock.                                                     |
| 6. New-version grant blocked by old grant            | UI permits explicit grant of a newly presented version while continuing to prohibit denial as withdrawal. PG and Chrome cover replacement grant.                                                                                                                  |
| 7. Stale withdraw-all / concurrency                  | Authoritative list before and after; separate confirmed, failed/uncertain, remaining-active and verification fields. No claim that concurrent/future grants are absent.                                                                                           |
| 8. 403 leaves stale CSRF/state                       | Reprobe session/CSRF and authoritative state; never automatically repeat the rejected mutation. Client and Chrome regressions.                                                                                                                                    |
| 9. Unrelated duplicate cookies disable auth          | Ignore unrelated names, fail closed on duplicate session/nonce names. BFF regression.                                                                                                                                                                             |
| 10. Unexpected exceptions appear as validation 400   | Unexpected BFF/bridge failures return content-free 503; only explicit parsing/validation returns 400. Secret-shaped exception test.                                                                                                                               |
| 11. Refresh races and missing fetch bound            | Initial refresh and UI actions share busy serialization; logout invalidates pending client response epochs. Fetch/body handling has a 10-second deadline. Client race/timeout and real-browser initial-busy tests.                                                |
| 12. Invalid presentation controls remain             | Clear old panel before presentation request; remove decision controls before attempting a decision, require reopening after failed/uncertain outcomes. Chrome 409/403 regression.                                                                                 |
| 13. Confirmed changes lost on refresh failure; focus | Preserve confirmed grant/withdraw/login/logout and partial-withdraw receipts, report unavailable snapshot separately, restore focus to a surviving action or status. Chrome compound sequence.                                                                    |
| 14. Bot username length excludes suffix              | Validate total 5..32 characters including `bot` in config and UI; boundary tests.                                                                                                                                                                                 |

Messaging policy consumers were inspected: gateway, response and test-expert
composition compare the configured `CLIENT_MESSAGING_CONSENT_POLICY_VERSION`
exactly. Consent composition now recognizes only `client-messaging-vN` and the
existing `messaging-vN` alias for the persisted approved revision N. Selarti uses
the exact canonical `selarti-ai-vN` mapping. Arbitrary labels, old configured
revisions and document mismatches fail unavailable; caller `policyVersion` never
controls authority. The PG default-lifecycle case uses `messaging-v1` and verifies
the actual stored fact through real POST forwarding.

Rejected review requests, per main's triage: do not relax multiple-identity
ambiguity and do not remove the bounded identity table lock. These are deliberate
fail-closed spec requirements because unrelated identity writers do not share an
advisory-lock namespace. No authority or provider feature was enabled to satisfy
a test. Erasure remains explicitly unavailable and legal documents were seeded
only in isolated synthetic test databases.

Actual focused verification in this patch pass (each Vitest command was one file):

| File/check                                      | Result / executions in this pass                                                                                                                     |
| ----------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/api/src/telegram-client-proof.test.ts`    | 7/7 PASS, one execution; two added forged-hash cases validate the existing verifier.                                                                 |
| `apps/api/src/routes/browser-account.test.ts`   | RED 3/6 defects, GREEN 6/6, final strengthened issue-call assertion GREEN 6/6; three executions.                                                     |
| `apps/api/src/client-web-composition.test.ts`   | RED username boundary, GREEN 3/3; two executions.                                                                                                    |
| `apps/api/src/routes/client-sessions.test.ts`   | GREEN 4/4; one execution, revocation contract now tests denied principal without invoking resolution.                                                |
| `apps/web/src/privacy-client.test.ts`           | RED five defects, GREEN 9/9; two executions.                                                                                                         |
| `tests/integration/client-web-review.test.ts`   | RED 5/6 reproduced defects, GREEN 8/8 including configured-label rejection and withdrawal lock timeout; two PostgreSQL executions.                   |
| `scripts/verify-client-web-account-browser.mjs` | Real Chrome RED on initial refresh serialization, then GREEN compound DOM sequence; final web rebuild recheck recorded below. No dependency install. |
| Environment                                     | `check-development-environment.ps1 -RequireDocker` PASS, Node 24.21.0 / pnpm 11.9.0, main's isolated PostgreSQL 17.5 at localhost:33110.             |
| Typechecks                                      | API, web, config, database and `tsconfig.tests.json` PASS.                                                                                           |
| Lint                                            | ESLint on every source/test/script changed in this patch PASS.                                                                                       |

The new normal PG test boots `createDefaultLifecycle()` without an injected
verifier, authenticates synthetic real Telegram HMAC, persists the cookie-backed
session, forwards real presentation/grant/withdraw POST bodies, and verifies logout
after deactivation. The maintained Chrome script uses actual Window.fetch and
synthetic API responses to exercise the DOM/error paths without new dependencies.
It is complementary to main's earlier HTTPS + HMAC + PostgreSQL browser harness,
not a claim that the DOM fixture is a real Telegram deployment.

No full suite, multi-path Vitest run, exhausted consent PG file, or identity PG
file was rerun. The earlier full suite PASS (307 files / 2374 tests) is main's
pre-remediation result, not a new exact-source claim. Main reported dependency
audit GREEN (no known vulnerabilities) and native nginx 1.24 edge regression
RED/GREEN including 413/502; see the operations document for their owned changes.
Exact-SHA factory CI is still **BLOCKED by policy**, not green. Final independent
review and release/activation authorization remain main-owned gates.

Final source-freeze evidence: the maintained Chrome regression passed again
against the last web build (`index-Dgn5hOV6.js`), its third/final invocation
(RED, GREEN, GREEN). Config/database/API/web package builds passed; changed-file
ESLint, Prettier, script syntax and `git diff --check` passed. The final BFF check
is 6/6, including the strengthened no-redundant-issue assertion. No PostgreSQL
test was run after the 8/8 second run. Runtime source and cabinet tests are frozen
for main's final read-only review; this is not deployment or full-factory completion.

Review delta files beyond the first freeze: BFF and its tests; Telegram proof
tests; default-lifecycle config tests; strict session revoke route and test;
`server.ts`; config username validation; session/consent/privacy repositories;
`privacy-client.ts` and tests; `consent-view.ts`; new
`tests/integration/client-web-review.test.ts` and
`scripts/verify-client-web-account-browser.mjs`; this child spec and the cabinet
operations document. Main's dependency, nginx, edge test and parent-spec changes
remain separately owned and were not modified by the cabinet writer.

### Final account-switch read binding — 2026-10-05

Final review found that the epoch-only guard did not detect another tab replacing
cookies between A's acknowledged withdrawal and its final private GET. The fix
binds every private browser GET/HEAD to the known session using the existing CSRF
header, verified by the BFF after authentication and before forwarding. Cookie B
with CSRF A returns 403; matching pairs work; anonymous private reads remain 401
and the session probe stays public. A post-hoc probe is not used as the security
boundary. Bulk interruption clears cached states/presentations and private UI
controls, retains original confirmed receipts, and requires an explicit
«Обновить состояние» action instead of `confirmed()` auto-refresh.

`browser-account-read-binding.test.ts`: RED 2/3 (cross-account consent/export
reads returned 200), then GREEN 3/3, two runs. Extended
`privacy-client-account-switch.test.ts`: GREEN 7/7 on its third/final allowed run,
including a silent cookie switch with no intervening local probe and no B write
or merged final snapshot. The earlier review reproduction is the RED evidence
for that added client case; it was not rerun before patching. Updated the existing
authenticated GET fixture with its session-bound header without rerunning that
exhausted file. No PostgreSQL, full-suite or multi-path tests were run. API/web
and tests typechecks and changed-file lint passed. This supersedes the earlier
freeze's read contract; final review is limited to this finding and its UI handling.

### Main post-remediation verification

After the first remediation source freeze (before the later account-switch and
private-read binding fixes), main restarted the default-lifecycle HTTPS fixture on a
fresh isolated PostgreSQL database and reran the Chrome HMAC/cookie/document/
grant/download/withdraw/logout/CSRF/replay sequence: PASS, no browser exceptions.
Workspace and test typechecks, changed-file ESLint, formatting, script syntax,
and whitespace checks passed. No second full suite was run.

Dependency review found no blocking issue in the Fastify 5.12.5, fast-uri
3.1.8/4.1.5, and gRPC 1.14.5 updates. Frozen install and production audit passed;
the audit reported no known vulnerabilities. The scope boundary test passed
123/123 after updating only the reviewed dependency floor and manifest hashes.

The nginx follow-up review returned no remaining finding. Its native 1.24 fixture
checks content-free method allowlisting, URL/header exclusion, 8192/8193-byte
boundaries for both authentication paths, chunk forwarding before request end,
private exports without observed temporary files, no-referrer, and 502 behavior.
Request/response buffering and caching are disabled for API traffic, including
the bearer API; upstream buffering headers cannot override those restrictions.
TLS directives and production certificate includes are unchanged. The isolated
HTTP fixture does not claim to validate production TLS files.

These browser results do not assert a rerun after the final read-binding change.
Final cabinet review and release cutover were still pending at this checkpoint.
The story is not marked done while exact-SHA factory CI is unavailable.

### Final review follow-up: account switch during bulk withdrawal

The final reviewer reproduced one important remaining defect: a 403 could refresh
credentials to another account and let later bulk withdrawals continue there.
The bounded correction stops on 401/403, authentication loss, CSRF/session change,
or logout epoch change. It preserves confirmed original receipts, separately
reports unattempted purposes, and never merges a new account's final snapshot.
The UI reports interruption and requires another explicit action.

`apps/web/src/privacy-client-account-switch.test.ts` reproduced the bug RED and
passed all six scenarios GREEN in two focused executions. Existing test files
were not rerun. Web/tests typechecks, lint, formatting, whitespace, and web build
passed; the resulting asset is `index-DSWgVAMk.js`. Final reviewer confirmation
is pending; no production cutover has happened at this checkpoint.

### Final RC source freeze — 2026-10-05

The independent cabinet reviewer rechecked the final server-bound private reads
and explicit-refresh UI correction and returned no remaining finding (`[]`).
The edge reviewer and dependency reviewer likewise reported no remaining blocker
within their owned scopes. Main's final changed-file lint, formatting and
whitespace checks passed. The final runtime web asset is `index-Dpi9PAwo.js`;
the earlier asset names above identify historical checkpoints only.

This is an RC source freeze, not an assertion that the entire consent factory is
implemented or that external exact-SHA CI passed. Final deployment, live user
authentication and approved-document publication are separate evidence items.

## Suggested Review Order

**Authentication and authority**

- Start at production composition: credentials become a verifier, never content consent.
  [server.ts:240](../../../apps/api/src/server.ts#L240)
- Keep browser cookies and CSRF separate from the existing strict bearer API.
  [browser-account.ts:44](../../../apps/api/src/routes/browser-account.ts#L44)
- Validate Telegram signatures, freshness, replay identity, and subject binding.
  [telegram-client-proof.ts:4](../../../apps/api/src/telegram-client-proof.ts#L4)
- Resolve identities conservatively under bounded database locks.
  [client-session-repository.ts:65](../../../packages/db/src/repositories/client-session-repository.ts#L65)
- Bind decisions to approved documents, database time, and configured policy versions.
  [consent-evidence-repository.ts:220](../../../packages/db/src/repositories/consent-evidence-repository.ts#L220)

**Browser experience and edge privacy**

- Render exact document text and independent actions with truthful recovery states.
  [consent-view.ts:52](../../../apps/web/src/consent-view.ts#L52)
- Bound requests, invalidate stale state, and reconcile withdrawal outcomes.
  [privacy-client.ts:33](../../../apps/web/src/privacy-client.ts#L33)
- Exclude raw request content from logs, buffers, and caches.
  [ii-tonya:2](../../../deploy/nginx/ii-tonya#L2)

**Verification and configuration**

- Exercise real default composition, signature verification, PostgreSQL, and browser-bridge mutations.
  [client-web-review.test.ts:81](../../../tests/integration/client-web-review.test.ts#L81)
- Exercise DOM failure recovery and safe document rendering in Chrome.
  [verify-client-web-account-browser.mjs:10](../../../scripts/verify-client-web-account-browser.mjs#L10)
- Exercise deployed nginx locations against an isolated native server.
  [client-web-edge-privacy.test.mjs:27](../../../tests/container/client-web-edge-privacy.test.mjs#L27)
- Require explicit origin and bot configuration, keeping unrelated capabilities disabled.
  [env.ts:83](../../../packages/config/src/env.ts#L83)
