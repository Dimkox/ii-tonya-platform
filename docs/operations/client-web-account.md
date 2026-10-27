# Client web account deployment

This is the browser account slice in `spec-client-web-account.md`, not approval
to enable the parent consent factory, free text, AI, expert disclosure, or erasure.

## Runtime configuration

- `CLIENT_SESSION_ENABLED=true` enables the existing strict bearer API and the
  production Telegram verifier. Without a valid server-only `TELEGRAM_BOT_TOKEN`,
  default lifecycle preflight fails before serving requests.
- `CLIENT_PRIVACY_ENABLED=true` composes consent, withdrawal, and subject export.
- `CLIENT_WEB_ORIGIN` must be one exact HTTPS origin without a trailing slash,
  path, query, credentials, or fragment. Browser and API must share that origin.
- `CLIENT_TELEGRAM_LOGIN_BOT_USERNAME` identifies the confirmed client bot.
  Confirm it matches the token's bot before activation. Expert credentials stay
  separate. No username is hardcoded.
- `CLIENT_TELEGRAM_WIDGET_LOGIN_ENABLED=false` is the default. Keep it false until
  the owner configures the domain through BotFather and verifies the widget. A
  valid `getMe` response does not prove widget/domain readiness.
- `TELEGRAM_ENABLED=false` and all unrelated integration flags remain unchanged.

Serve `/account`, `/consent`, and `/my-data` through the web SPA and proxy only
the intended API paths to the API listener. Preserve HTTPS, Origin, Cookie,
Set-Cookie and X-CSRF-Token. Never cache `/v1/browser/*`. Avoid access-log query
strings/headers/body capture on authentication paths. Keep CSP compatible with
the optional Telegram widget only when that feature is approved and enabled.

The primary login path is the confirmed client bot's Mini App menu pointing at
`https://<configured-host>/account`. Setting that menu is a main-agent external
operation. Normal browsers link to that bot and explain the menu path. No claim
of direct browser login is made when the widget is off. Cross-browser polling
login is not implemented.

## Protocol and limits

GET `/v1/browser/session` returns availability, authentication state, public bot
username, and a CSRF token. It never returns the session bearer or internal user
ID. The CSRF nonce and session use host-only Secure HttpOnly SameSite=Strict
cookies. State-changing requests require the exact configured Origin and the
session-bound `X-CSRF-Token`. Login rotates both cookies; logout revokes the
persisted session and expires both cookies.

Private `/v1/browser/privacy/*` GET/HEAD reads also require the caller's known
session-bound `X-CSRF-Token`. The BFF authenticates first (anonymous remains 401),
then rejects a missing/mismatched binding with 403 before forwarding private data.
This prevents another tab's replacement cookie from silently selecting another
account's snapshot or export. GET `/v1/browser/session` remains public and does
not require that header. After a bulk-withdraw interruption, private controls and
cached presentations are cleared; confirmed original receipts remain visible,
but only an explicit «Обновить состояние» action reloads the UI. No automatic
bulk continuation or post-interruption UI refresh occurs.

An existing session cookie prevents redundant login issuance (409): complete
logout before using a new proof. A session probe clears a denied/expired session
cookie. Logout revokes the exact stored token even if its owner was deactivated;
reactivation cannot restore that token. Duplicate authentication cookies fail
closed, while duplicate unrelated cookies do not disable the cabinet. Unexpected
bridge failures are sanitized 503 responses, not validation errors or raw details.

Session issuance/revocation/cleanup and consent presentation/redemption/withdrawal
use a 2-second PostgreSQL statement timeout and 1-second lock timeout. Identity
resolution retains its existing 1.5-second statement/1-second lock limits and
fail-closed table lock. These are per-statement bounds, not a promised overall
response deadline. Presentation expiry is checked against `clock_timestamp()`
after the consent lock wait, not transaction-start time. Browser fetch/body reads
time out after 10 seconds; a timeout does not prove a mutation failed.

POST `/v1/browser/session` accepts exactly `{ "identityProof": "mini:<initData>" }`
or, only when enabled, `widget:<URLSearchParams from widget callback>`. Mini App
launch data is read from the fragment into memory and the fragment is removed;
the Telegram SDK is not loaded because it persists init parameters in
sessionStorage. Widget JavaScript is loaded only after an explicit click.

Proof freshness and session expiry are bounded to five minutes from Telegram's
`auth_date`, with at most 30 seconds of future clock skew. Expired/replayed proof
requires reopening the Mini App. The shared existing session repository owns
digest-only session persistence and transactional replay receipts. No names,
photos, contacts, or content consents are created by login. Ambiguous, duplicate,
blocked, and inactive identity mappings fail closed. Identity creation uses a
short table lock because other identity writers do not share an advisory-lock
namespace; timeout is unavailable, never a fallback identity.

Browser login is limited to 10 attempts/minute per transport IP and 60/minute
per process. With a reverse proxy, the transport IP may be shared; configure
edge rate limiting and assess this limit before scaling. CSRF signing state and
rate limits are process-local: use one API instance (or session affinity) for
this increment. Restarting requires a fresh session probe for CSRF.

The finite bridge exposes `privacy/consents`, `privacy/presentations`,
`privacy/decisions`, `privacy/consents/withdraw`, and `privacy/export` under
`/v1/browser/`. No arbitrary targets or caller headers are forwarded. The strict
`/v1/client/*` bearer contract is preserved. Erasure is explicitly unavailable
on both default production ingress and the browser bridge.

## Documents and rights

No legal documents are seeded. Empty `consent_document_versions` means document
unavailable and no decision controls. Presentation returns the exact persisted
title/body/version/hash; the UI renders the body as text and offers a copy.
Opening does not grant. The server owns policy versions: `profile-vN`,
`client-messaging-vN`, `note-vN`, `handoff-vN`, `follow-up-vN`, `selarti-ai-vN`,
where N is the immutable approved document version. Future-effective documents
are excluded. A newly approved effective version invalidates older presentations
at redemption. Publication and redemption are serialized by a document table
lock. Existing runtime policy gates must match the deliberately approved version
before any separately authorized provider activation.

The existing messaging consumers compare `CLIENT_MESSAGING_CONSENT_POLICY_VERSION`
exactly. Cabinet composition binds that configured value to the approved document:
only `client-messaging-vN` or the existing legacy alias `messaging-vN` for that same
N is accepted. `SELARTI_AI_CONSENT_POLICY_VERSION` likewise must equal `selarti-ai-vN`.
Arbitrary configured labels or a document/version mismatch make presentation
unavailable; they never become caller-chosen consent authority. Update the approved
document and the relevant configured gate coherently before activating a new policy.

Active grants require the withdrawal endpoint; a denial cannot replace them.
An active old-version grant does not prevent a separate explicit grant after
reading a newer document. Withdraw-all reads authoritative state both before and
after its bounded per-purpose requests, reports confirmed receipts separately from
uncertain/failed outcomes, and identifies grants still active at the final snapshot.
Concurrent updates mean it does not promise that no future grants can appear.

Initial refresh and actions are serialized. After 403 the client probes session,
CSRF, and current state without replaying a mutation. Failed or uncertain decisions
remove their controls and require a fresh document. Confirmed receipts survive a
subsequent refresh failure; the UI explains that the snapshot is unavailable and
restores keyboard focus. Export downloads only the subject's
existing supported export projection; it does not certify coverage of every
storage class in the full factory scope.

Erasure remains unavailable because dialogue/proposal/outbox/consent-authority
coverage and actual processor/backup deletion evidence are incomplete. Elapsed
backup retention alone is not proof of deletion. No erasure HMAC key or deletion
worker activation is introduced here.

## Verification and release

The spec records focused red/green results. Main owns the full suite, independent
security review, real-browser HTTPS sequence, exact-SHA release gates, signing,
deployment, and activation. Production's empty user/document/catalog state must
remain honest; never replace missing approved data with demo records.

Telegram algorithms were checked against the official
[Mini App validation](https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app)
and [legacy widget validation](https://core.telegram.org/widgets/login/) documents.

### Maintained cabinet regressions

`tests/integration/client-web-review.test.ts` uses the normal default lifecycle,
synthetic real Telegram HMAC, real PostgreSQL, and the real browser-to-bearer POST
bridge. It requires the standard migration/test-database setup; set
`II_TONYA_TEST_POSTGRES_ADMIN_URL` to an isolated PostgreSQL 17.5 admin fixture.
Never target production. The exhausted `client-web-consent.test.ts` was not rerun
for review remediation.

`scripts/verify-client-web-account-browser.mjs` starts a loopback-only static
server for the built web assets and drives real Chrome/Window.fetch with synthetic
API responses. Set `PLAYWRIGHT_MODULE_PATH` to an existing Playwright package
directory and, if needed, `CHROME_EXECUTABLE` to an existing browser. It installs
nothing and uses no real credentials or external service. Run after
`pnpm --filter @ii-tonya/web build`. It covers literal HTML-looking document text
and exact downloads, no grant on opening, new-version grant controls, initial
serialization, 409/403 recovery without replay, truthful partial/confirmed results
when refresh fails, focus, export and logout. This maintained DOM regression is
distinct from main's real HTTPS + HMAC + PostgreSQL compound browser sequence.

### Main-verified edge and dependency evidence

Main owns the nginx/dependency changes and reported these checks independently:

- Scoped `/v1/browser/` edge body limit is 8 KiB, request body buffer 16 KiB;
  request buffering, response buffering and caching are off.
- Both vhosts log only method/status/latency, without URLs, IPs, referrers,
  headers or bodies. Raw nginx error logging is disabled; `/account` sends
  `Referrer-Policy: no-referrer`. Plan content-free operational monitoring before
  relying on raw error logs for diagnosis.
- `node --test tests/container/client-web-edge-privacy.test.mjs` requires native
  nginx (`/usr/sbin/nginx` by default, or `NGINX_BIN`). Main verified RED then
  GREEN on nginx 1.24, including 413 and backend-failure 502 with no sensitive
  parameters in logs. Do not send a production body probe for this evidence.
- Main reported `pnpm audit --prod --audit-level high` GREEN, no known
  vulnerabilities after upgrading Fastify to 5.12.5 and the related dependencies.

The earlier full suite (307 files / 2374 tests) was run by main before this review
patch. It was not rerun by the cabinet writer. Exact-SHA factory CI remains
**BLOCKED by policy**, not green. Focused local checks and main's edge/audit
results are not a substitute for release authorization or final independent review.
