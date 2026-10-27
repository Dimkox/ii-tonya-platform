---
status: in-progress
baseline_commit: 690797db64fd80aa1aeccea8003543de470d8c16
context:
  - AGENTS.md
  - AGENT-STATUS.md
  - docs/operations/2026-10-12-expert-quote-composition-gap.md
  - docs/superpowers/plans/2026-10-12-expert-authenticated-entry.md
---

# Authenticated expert entry

## Intent and boundary

Give an existing verified expert a real browser/API login, resolved through the
ordinary server entrypoint. This supplies the missing identity boundary for
quote-bound billing; it does not itself finish or enable payments. The subsequent
commercial composition must join this principal and authenticated Telegram sender
to the same saved quote, order and provider operation. Keep that work in the full
release scope. Do not remove the `expertApi` startup guard to enable Telegram alone.

This is a technical design under the owner's delegated implementation authority,
not a record of human acceptance. The plan/interface self-check is recorded in
this plan's SDD ledger; implementation proceeds under delegated technical
authority. No production activation follows.

## Design choice

Use a separate revocable expert session. Do not add financial permissions to
`client_catalog:read`, infer them from a test-expert dialogue, or accept an expert
ID from a login body. Reusing the existing client token would violate its purpose;
Telegram-only entry would leave the required browser/API path missing.

An explicit expert login verifies the Telegram signature and freshness, then
looks up the existing channel identity, active user, and active verified expert.
It must not create or verify an expert. Unknown, inactive or ambiguous ownership
is denied. Recheck the same ownership on every session lookup and mutation.
Changing an expert's owner must invalidate the former owner's access immediately.
Bind issuance to the exact channel-identity row as well as user and expert.
Use the configured bot's active private-chat mapping; allow a legacy unscoped
mapping only when it is the sole unambiguous mapping for that identity. Reject
blocked, unresolved, competing-owner or ambiguous mappings. Store the selected
channel row ID, and revalidate it on issue and lookup; a remapped channel cannot
leave the former owner's session valid.
Deleting that channel mapping through existing privacy erasure must remove its
expert sessions, not fail the erasure transaction. Keep an unexpired one-time
proof receipt after session removal with its session link set to null; do not
enable proof replay by cascading away the receipt. Match this in SQL and schema,
and test channel deletion, immediate bearer denial and preserved replay rejection.

Preserve existing client proof behavior. Share cryptographic mechanics only behind
purpose-specific wrappers; a client bearer token is never an expert identity proof.
Mini-app and enabled widget input retain existing strict bounds, duplicate-field
rejection, five-minute proof age and thirty-second future tolerance. Expert proof
receipts use their own explicit namespace; no raw proof is persisted or logged.

## Contract

- New opaque token: `es1.` plus 32 random bytes encoded as canonical base64url.
  Store only `sha256:<64 lowercase hex>`; no raw token in DB, telemetry or URLs.
- Persist user, expert, token digest, creation/expiry and optional revocation.
  Persist the verified channel-identity ID, never accept it from the login body.
  Session lifetime is at most 3600 seconds from fresh database time. Sessions
  remain separate from client sessions and admin/support sessions.
- Proof consumption and session insertion are one transaction. Parallel use of
  one proof yields at most one issued session. Expired proof rejection uses time
  after authoritative lock waits. A retry never creates an additional session.
- `POST /v1/expert/sessions` accepts exactly `{identityProof}` and returns the
  opaque bearer only after successful issuance. No caller-supplied user, expert,
  scope, price or clock. Strict body/header parsing and bounded rate/deadline
  handling follow the existing client-session transport pattern.
- `DELETE /v1/expert/sessions/current` revokes the presented expert bearer.
  `GET /v1/expert/session` returns only current authenticated expert identity and
  expiry, not receipt contact, channel identity, balance or client information.
- The existing `createExpertBearerPrincipalResolver` gets a real DB lookup.
  Malformed/client/admin tokens, revoked/expired sessions, deactivated users or
  experts, unverified experts and changed ownership cannot produce a principal.
- Browser entry uses `/v1/expert/browser/session` with a separate Secure,
  HttpOnly, SameSite cookie and expert-specific CSRF binding. Mirror the current
  browser-account origin/CSRF rules, including exact duplicate-header/cookie
  rejection. Mutations are same-origin; responses and errors are `no-store`.
  The browser receives no bearer token and stores none in local/session storage.
- `/expert/account` provides explicit login, loading, denied, unavailable,
  authenticated and logout states. Old responses after logout/account change
  cannot restore identity. No written consent or signature gate is introduced.

## Code map and implementation surfaces

Existing patterns: `apps/api/src/expert-principal-resolver.ts`,
`apps/api/src/telegram-client-proof.ts`, `apps/api/src/routes/client-sessions.ts`,
`apps/api/src/routes/browser-account.ts`,
`packages/db/src/repositories/client-session-repository.ts`, and
`apps/web/src/privacy-client.ts`. Read those rather than copying hidden assumptions.

Add purpose-specific expert session application/DB/proof/routes/browser modules;
wire them in `apps/api/src/server.ts` and `app.ts`, export the required package
types, and add the expert page in `apps/web/src/main.ts`. Add a hand-authored
session/proof-receipt migration at the next free journal index (0049 at this
baseline); recheck the index before writing. Reconstruct metadata on isolated
PostgreSQL17.5, never use schema-derived migration generation. Existing client
schema and proof/session contracts remain unchanged.

Add `EXPERT_SESSION_ENABLED`, default false, and fail startup when enabled without
real Telegram verification and DB/session capability. This flag does not enable
billing, provider calls or fake financial dependencies. Document required secret
references without printing values. Session cleanup must be bounded and cannot
remove an unexpired proof receipt; use the existing expired-session cleanup pattern.
Wire that cleanup into the normal worker retention job. An unused repository
method does not satisfy retention. Cleanup failures must not be reported as success.

## Tasks and acceptance

- [ ] Given genuine signed synthetic Telegram identity and a verified owner,
      when issuing through the ordinary API composition, then a DB-backed session
      is issued and resolves to that exact owner/expert. Non-experts are denied.
- [ ] Given proof replay, concurrent login, expiry or a lock wait across expiry,
      when issuing, then at most one valid session exists and no expired proof wins.
- [ ] Given revocation, deactivation or ownership reassignment, when resolving
      or using the old session, then access is denied without disclosing other data.
- [ ] Given browser login/logout and cross-origin or duplicate credentials,
      when requesting the session endpoints, then cookie/CSRF/origin boundaries hold;
      no bearer leaks to browser storage, HTML, URLs or logs.
- [ ] Given `/expert/account`, when a real composed synthetic login succeeds,
      then the rendered page shows the authenticated state and logout revokes it.
      A mocked injected principal alone does not satisfy this acceptance criterion.
- [ ] Given the flag is off or dependencies are missing, when ordinary startup
      runs, then disabled behavior stays closed or startup fails explicitly. Existing
      client account and financial capability guards remain intact.

## Verification and handoff

Plan exact test files and budgets before implementation. Do not move any old
exhausted test into a new file. New session behavior merits its own focused PG
file; at most three runs, including RED, implementation and post-review evidence.
No full/multipath suite rerun. Require typechecks, scoped lint/formatting,
whitespace check, source review and actual composed/browser evidence. Capture
what ran and what did not. Production login, financial API composition, verified
receipt-contact capture, saved-quote callbacks and payment remain explicit
downstream gates; this increment cannot be called the completed commercial product.

## Current implementation handoff

One implementer owns Tasks1–3 as the coupled authenticated-entry slice, in their
dependency order. No nested agents. Use the existing codex branch, preserve all
unrelated dirty changes, and do not commit or push. Main owns AGENT-STATUS,
shared release/runbook documents and existing repository migration guards;
report new metadata counts/names/hashes so main can update those guards. The
implementer owns the plan's new modules, listed composition edits, migration/
metadata, three new focused test files and this increment's evidence file.

The three financial correction repositories and existing campaign/settlement/
operator tests are excluded from this handoff. Their exhausted budgets are not
reset. The new PG session file starts at0/3; execute RED1 and implementation2,
reserve3 for coordinator after source review. The two new API/browser files use
the same bounded allocation. No full/multipath suite or existing test execution.
Use fresh environment checks and isolated synthetic PostgreSQL17.5. The existing
retained17.5 container may host a new random test database; never reset its other
databases or destroy the shared container. Report any concrete scope blocker.

Write the full implementation/TDD/static report to
`docs/test-evidence/expert-authenticated-entry-2026-10-12.md`. Return a short stable
handoff with exact test counts, remaining budgets, source risks and whether any
tools/writes remain live. Do not claim default-process or rendered success from
injected principals or a mocked browser response alone.
