# Phase 0 local ingress readiness

These changes are development foundations, not deployment, provider verification,
physical erasure evidence or a legal compliance certification.

## Telegram deletion

Both authenticated Telegram ingress routes intercept the exact `/delete_data`
command before navigation, promo, conversation and expert AI routing. Private
human sender and matching chat IDs are mandatory; forwarded, business and bot
messages are denied. Text cannot supply another user's target ID.

`buildApp` accepts an optional `TelegramDeletionCapability.request` authority.
The default server constructs it only with privacy/request gates, the existing
parsed numeric bot ID, a configured bot binding, and a protected webhook key of
at least 32 bytes. The factory's `createTelegramDeletionCapability` composes
`PostgresErasureRequestRepository.acceptTelegram` with verified request projection;
it never performs a separate owner-resolution/request-write pair.

`acceptTelegram` serializes a SHA-256 domain-separated stable bot-ID/update-ID key
with a transaction advisory lock, pins the first observed owner in
`integration_inbox` under provider `telegram_erasure_v1`, locks the active user,
and revalidates the exact private active identity under a row lock before request
acceptance. Denied admissions retain their pinned owner/denial tombstone. Changed
senders, missing/revoked mappings and old updates after account rebinding fail
closed. Neither webhook-key rotation nor bot-path rotation changes the replay key.
The inbox records contain digests and a user UUID/denial marker, no command payload
or raw Telegram identifiers. They are retained as anti-replay authority alongside
the erasure request; deleting these tombstones would reopen replay and requires a
separate reviewed retention/recovery design.

Receipt bytes derive from the existing protected webhook key using a dedicated
HMAC domain and stable bot-ID/user-ID binding. Only the digest is stored. The
private reply includes the derived `er1` key only if the transaction proves it
matches the request's unrevoked stored digest. An existing browser request, revoked
receipt or rotated key never receives an invalid replacement. Previously saved
receipts continue to work through the existing receipt-status read boundary after
Telegram identity removal/deactivation. The user must save the private key before
execution; a Telegram delivery failure remains retryable. Missing receipt requires
the user's previously saved key and is stated explicitly.

Replies use the existing verified request projection, including awaiting execution,
deleting, awaiting backup, attention and completed states. Completion requires the
existing verified job/proof checks; forged job status remains unavailable. No
receipt, private status or target user crosses a rebound owner's stale update.
Default flags remain disabled. Immutable financial/audit evidence stays intact.

This does not expose the physical erasure executor. Real execution, processor
proof, backup retention/erasure verification, protected hosting evidence and
recovery acceptance remain separate external gates. A webhook HTTP response is
not evidence that Telegram displayed the reply; the durable request still permits
safe retry.

## Suspicious request telemetry

Telegram authentication/authorization rejection, wrong-bot paths (including their
HTTP 200 rejection), and rate-limit responses emit only
an enum reason and HMAC SHA-256 IP/user-agent fingerprints. Trusted `request.ip`
is used, never forwarded-header input. User-agent input is capped at 512 code
units before hashing. The random HMAC key lives only in the process; no new secret
configuration is required. Fingerprints permit only process-local correlation and
are not returned to clients. Logger projection drops raw headers, payloads,
addresses, user agents, arbitrary error prose and malformed fingerprints.

## Existing manager boundaries

Manager/operator views continue to use the current authenticated application
services and server-owned masked projections. This increment does not add a
manager bypass, expose deletion text to managers/LLMs or allow adapters to change
balances, ownership, provider facts or immutable financial evidence.

## YooKassa and activation

The companion placeholder-only test profile must retain test mode and disabled
flags. The owner already has a test merchant and supplies protected parameters
outside Git. No checkout `.env` is copied and no merchant API is called for this
local implementation. Before any external activation, explicitly review merchant
mode, feature gates, credentials, webhook target/peer allowlist, real authoritative
GET evidence and recovery; configuring a profile alone is not activation evidence.
Waiting-for-capture acknowledgement must never settle, deliver entitlement or
capture held money. Provider validation remains a separate test-merchant gate.

## Local checks

The environment preflight passed with Node 24.22.0 and pnpm 11.9.0; `.env` was
absent. Test executions use one focused file at a time, no full suite and no
PostgreSQL tests for this ingress task. Detailed commands and bounded run counts
are included in the implementer handoff. No commit, push, deployment, live flag
change or external provider call is authorized by this readiness note.

## Review correction and bounded verification

The initial resolve-then-request design did not bind Telegram replay to the original
owner and could race identity revocation. Independent review required atomic
admission, private receipt tracking and truthful stage projection; the implementation
above replaces that design. The fresh PostgreSQL focused file is
`tests/integration/telegram-deletion-atomic.test.ts`, using isolated PostgreSQL
17.5 with real migrations, repository, HTTP routes and `buildApp` capability gates.
Its invocation 1 was an import-resolution failure before collection; invocation 2
ran against the previous repository and failed 8/9 cases as expected. Invocation 3
passed all 10 cases on reviewed corrected source; the PG budget is fully consumed.
The corrected adapter passed 13 unit cases (third invocation); the new stage/update/
capability remediation file passed 10 cases. The adapted ingress unit file passed
4 cases in its fourth invocation after coordinator clarification that the hard
three-run repository limit applies to PG/concurrency tests; the revised atomic
interface required this ordinary-unit regression. Security helper was not rerun.
API/DB typechecks, tests TypeScript, scoped ESLint, formatting and whitespace checks
passed. Logs are retained locally in `.superpowers/sdd/phase0-ingress-20261023/`.
