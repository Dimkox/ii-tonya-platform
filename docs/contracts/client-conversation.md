# Client Conversation Inbound, Authority, and Tool Contract v2

Status: frozen implementation contract after independent security review; default-off,
fixture-only, and **NO-GO** for live activation.

## 1. Duplicate-preserving authenticated inbound capability

```ts
export interface RawHeaderOccurrence {
  readonly name: string;
  readonly value: string;
}

export interface AuthenticatedClientConversationInbound {
  readonly kind: "client_message";
  readonly provider: "selarti";
  readonly tenantToken: OpaqueConversationToken;
  readonly subjectToken: OpaqueConversationToken;
  readonly providerEventId: OpaqueConversationToken;
  readonly providerMessageId: OpaqueConversationToken;
  readonly occurredAt: string;
  readonly text: string;
}

declare const conversationTokenBrand: unique symbol;
export type OpaqueConversationToken = string & {
  readonly [conversationTokenBrand]: true;
};

export type AuthenticatedConversationInboundResult =
  | { readonly kind: "authenticated"; readonly event: AuthenticatedClientConversationInbound }
  | { readonly kind: "denied" }
  | { readonly kind: "unavailable" };

export interface AuthenticatedConversationInboundCapability {
  authenticate(input: {
    readonly rawBody: Uint8Array;
    readonly rawHeaders: readonly RawHeaderOccurrence[];
    readonly signal: AbortSignal;
  }): Promise<AuthenticatedConversationInboundResult>;
}
```

The API constructs `rawHeaders` only from the ordered alternating entries in
`request.raw.rawHeaders`; it never uses `request.headers`, a record, comma folding, or the last
occurrence. Header names are compared case-insensitively while occurrences and values remain
distinct. Mixed-case duplicates are duplicates. The fixture edge accepts only direct HTTP/1.1
with `trustProxy=false` and a valid socket peer address. HTTP/2 and any proxy path are rejected
until deployment evidence proves occurrence preservation, source attribution, framing, and
signature behavior end to end.

Production supplies no capability implementation. A test-support fixture is blocked from runtime
imports. The capability returns no internal UUID, credential, raw identity, contact, display name,
provider payload, or claim. Hostile runtime output is exact-key validated and tokens are accepted
only through one parser matching `^hmac-sha256:v1:[0-9a-f]{64}$`; arbitrary versions and
template-literal assertions are rejected.

## 2. Fixture token and payload identities

This slice accepts exactly fixture key version `v1`; it makes no live key-rotation claim. Let
`LP(x)` be four-byte unsigned big-endian byte length followed by exact UTF-8 bytes. Tenant,
external-user, thread, event, and message inputs are 1–512 bytes, contain no NUL/control, and are
not trimmed or normalized by application code. The fixture emits:

```text
tenantToken = HMAC-SHA-256(K_fixture_v1,
  UTF8("ii-tonya/selarti-tenant/v1\0") || LP(environment) || LP(tenant))

subjectToken = HMAC-SHA-256(K_fixture_v1,
  UTF8("ii-tonya/selarti-client-thread/v1\0") || LP(environment) ||
  LP(tenant) || LP(externalUser) || LP(thread))

providerEventId = HMAC-SHA-256(K_fixture_v1,
  UTF8("ii-tonya/selarti-event/v1\0") || LP(environment) || LP(tenant) ||
  LP(externalUser) || LP(thread) || LP(event))

providerMessageId = HMAC-SHA-256(K_fixture_v1,
  UTF8("ii-tonya/selarti-message/v1\0") || LP(environment) || LP(tenant) ||
  LP(externalUser) || LP(thread) || LP(message))
```

`environment` matches `^[a-z][a-z0-9_-]{0,31}$`. Collision tests reuse identical event/message
IDs across tenants, users, and threads. A live design must separately approve key custody,
active/verify-only/retired/compromised states, overlap, retokenization and compromise cutover
before a version other than fixture `v1` is accepted.

The replay payload digest is lowercase hex:

```text
SHA-256(
  UTF8("ii-tonya/client-conversation-inbound-payload/v1\0") ||
  LP(tenantToken) || LP(subjectToken) || LP(providerEventId) ||
  LP(providerMessageId) || LP(occurredAt) || LP(UTF8(text))
)
```

Every field is the already validated canonical value in this exact order. There is no dual-read
or upgrade path in v1; changing the serialization requires a new reviewed domain/version and an
explicit migration/replay compatibility decision.

## 3. Binding, grants, and runtime authority

`provider_subject_mappings` remains the identity binding, but the post-booking migration adds
`tenant_token` and `token_version` for provider literal `selarti.client-thread.v1`. Resolver input
must match provider, `tenant_token`, `subject_token`, and version `1`; a tenant/subject mismatch is
denied. Plaintext `channel_identities`, inbound UUIDs, bearer tokens, display/usernames, cached
claims, and user creation are forbidden authority. Inbound never creates, relinks, restores,
guesses, or upserts a mapping.

The same migration adds `client_conversation_grants(provider_subject_mapping_id, scope,
expires_at, revoked_at, created_at)`, unique by mapping/scope, with scope constrained to
`client_catalog:read|client_booking:write`. Mapping deletion cascades grants. No grant is inferred
from identity, catalog scope, conversation acceptance, flags, or structural TypeScript shape.

```ts
declare const conversationIdentityBrand: unique symbol;
declare const conversationOperationClaimBrand: unique symbol;

export type ClientConversationIdentity = Readonly<{
  bindingId: string;
  userId: string;
  [conversationIdentityBrand]: true;
}>;
export type ClaimedConversationOperation = Readonly<{
  operationId: string;
  [conversationOperationClaimBrand]: true;
}>;
```

Ingress performs a fresh uncached mapping/users join and returns one branded identity only for an
active user. The operation repository alone mints `ClaimedConversationOperation` after a fenced DB
claim. Its private class constructor and reader are not exported, each instance carries a native
private field and is registered in a module-private `WeakSet`, and the reader returns only
`operationId`, claim token, owner, exact tool/scope and frozen input. Every gateway first requires
matching private-field and WeakSet provenance; plain/deserialized/cloned/spread/cross-realm objects,
`as unknown as`, a stolen user UUID, and a claim for the other tool are synchronously denied before
DB or service invocation. A genuine claim is not authority by itself: the gateway rechecks its
fence and grant inside the downstream mutation transaction defined below. The DB repository returns
raw rows and never constructs a principal or brand. Conversation/AI cannot import the constructor,
reader, WeakSet, gateways' underlying services, or service principals.

Catalog and booking each expose one conversation-specific application entry point, not a public
structural principal. The entry point opens the same PostgreSQL transaction that will own the
catalog request or booking mutation. A preliminary non-authoritative lookup obtains candidate IDs.
To preserve the implemented downstream topology, catalog first takes its existing
`hashtextextended(UTF8(userId + ":" + requestDigest),0)` advisory lock and booking first takes its
existing `hashtextextended(UTF8("choice:" + choiceDigest),0)` advisory lock. These byte expressions
are repository-owned: the conversation entry must call the same shared repository helper/
transaction seam as the ordinary path and may not reconstruct or rename either key. Each then locks `users` row, provider
mapping row, exact grant row and claimed operation row, followed by its existing remaining
advisory/row locks. It
rechecks `users.active`, provider/tenant/subject/version binding, grant scope plus DB-time expiry and
revocation, operation `processing` status/owner/claim token/tool/scope/payload digest, and frozen
input before mutation. Revocation, user deactivation, mapping erasure and retention cleanup do not
need a tool advisory key; they lock `users -> mapping -> grant -> operation`, never acquire a tool
prelock after `users`, and therefore cannot form the inverse wait edge. Missing ancestors are
skipped, never acquired after the operation row. A 2-second lock timeout before downstream
invocation yields `retry_wait`; crash releases all locks. If mutation wins, it commits before a
waiting revocation/erasure can commit. If revocation/erasure commits first, mutation is denied. Thus
no downstream effect may commit after a successful earlier revoke/erase commit. No prechecked
conversation object is ever converted to the ordinary structural `ClientPrincipal`.

Compile/import/hostile runtime and real-PostgreSQL race tests prove conversation-only, catalog-only,
expired, revoked, inactive, erased, wrong-tenant, wrong-scope, spread/cast/cloned claims and both
orders of revoke/delete versus downstream commit cannot book after the lifecycle transaction wins.
Deadlock tests mix conversation, ordinary protected booking/catalog and lifecycle calls at each
prelock/row-lock seam and require bounded completion without changing existing lock-key bytes. A
blocking probe proves ordinary and conversation calls contend on the identical advisory key, while
catalog choice cleanup cannot cross an in-flight protected booking prelock.

HTTP Bearer catalog/booking contracts remain unchanged. This is a distinct channel authorization
seam that requires Booking and Security approval; it never launders `client_conversation:tools`
into `client_booking:write`.

## 4. Edge limits and complete HTTP matrix

The de-framed entity cap is 64,000 octets. Ambiguous framing, any content encoding, malformed
UTF-8, duplicate security headers, and inexact capability output fail before resolution. A body
over the cap is `413 {"error":"body_too_large"}`; other malformed input is
`400 {"error":"invalid_request"}`. Authentication denial and provider time outside
`[serverNow-5 minutes, serverNow+30 seconds]` are `401 {"error":"unauthorized"}`.
Authentication/resolver/database failure before durable completion is
`503 {"error":"temporarily_unavailable"}` with `Retry-After: 1`.

Fixture-only, non-refunding 60-second in-process buckets run in this order: socket source 60,
process 600, authenticated tenant 300, authenticated subject 30. IPv4-mapped IPv6 is normalized;
invalid/missing source is denied. Exhaustion is `429 {"error":"rate_limited"}` before the next
stage. These are test limits, not a release claim. Any live replicated topology requires an
approved edge/distributed limiter with trusted-proxy chain, IPv6 rules, replica/restart behavior,
saturation mode, measured authentication cost and provider limits.

| State at HTTP edge | Response | Retry owner |
| --- | --- | --- |
| malformed/oversize/auth denied/stale/rate exceeded | fixed `400|413|401|429` | caller only under an approved contract |
| fresh identity or database unavailable before message completion | fixed `503`, `Retry-After: 1` | caller |
| same event with different payload digest | `409 {"error":"event_conflict"}` | terminal; operator/security case |
| first event completed with ordinary answer/handoff or frozen tool operation | `202 {"accepted":true}` no-store | application/operation runner |
| same event/payload already completed | same `202` | none |
| same event/payload while initial completion transaction is active | wait for row lock within route deadline, then `202` or pre-completion `503` | database lock owner/caller |
| frozen operation pending, retry-wait, processing, unknown or reconciling | same `202` | dedicated operation runner only |
| tool grant denied, terminal, dead-letter, or tool unavailable after freeze | same `202`; fixed local operator case | dedicated operation runner/operator |

No post-freeze tool failure becomes a provider `503` or triggers a second inference. A durable
operation means the server owns retry/reconciliation. Infrastructure failure never fabricates a
human-handoff message; invalid proposals retain the existing one-time handoff transaction.

## 5. Inbox completion and durable typed operation

The existing `integration_inbox` unique event, message-event association, payload hash and
`ConversationMessageRepository.completeInbound` lock remain the admission spine. No second
webhook inbox is added. Concurrent same-event callers may infer before the completion lock, but
the first completion transaction freezes the only durable outcome; every loser reads that outcome
and performs no mutation.

The post-booking migration adds `client_conversation_operations`:

| Column/state | Contract |
| --- | --- |
| `id`, `message_event_id` | UUID; one operation per message event, unique FK |
| `binding_id` | nullable FK to provider mapping, `ON DELETE SET NULL` |
| `required_scope`, `tool_kind` | exact catalog/read or booking/write pairing |
| `proposal_digest` | exact domain-separated SHA-256 of the typed proposal |
| crypto envelope fields | version, key ID, 12-byte nonce, ciphertext, 16-byte tag and expiry at most creation + 24h |
| `status` | `pending|processing|retry_wait|unknown_outcome|reconciling|succeeded|denied|dead_letter|privacy_expired` |
| lease/retry fields | claim token, owner, database-time lease, attempts, next attempt and reconciliation fields |
| `result_digest`, `terminal_reason` | no public handle or payload; fixed reason enum |

Exact proposal digest:

```text
show_catalog = SHA-256(UTF8("ii-tonya/client-conversation-operation/v1\0") ||
  LP(messageEventId) || LP(bindingId) || LP("show_catalog") ||
  LP(serviceCode-or-empty) || LP(language-or-empty))

start_booking = SHA-256(UTF8("ii-tonya/client-conversation-operation/v1\0") ||
  LP(messageEventId) || LP(bindingId) || LP("start_booking") || LP(choiceHandle))
```

Known result digest is lowercase hex:

```text
SHA-256(UTF8("ii-tonya/client-conversation-result/v1\0") || LP(operationId) ||
  LP(toolKind) || LP(outcomeCode) || LP(downstreamReceiptDigest-or-empty))
```

`outcomeCode` is exactly `applied|not_found|conflict|feature_disabled`; only `applied` has a
64-lowercase-hex downstream receipt digest produced by the owning service. Rejections use empty.

### 5.1 Exact operation cryptography

`ConversationOperationCrypto` is an injected key-provider capability; application code never reads
raw key bytes. Envelope version 1 is AES-256-GCM with a CSPRNG-generated 96-bit nonce and 128-bit
tag. Storage is the tuple `(envelope_version=1, key_id, nonce bytea(12), ciphertext bytea,
tag bytea(16))`; `(key_id, nonce)` is unique, and a collision aborts the freeze transaction and
alarms instead of retrying with the same key. `key_id` matches `^[A-Za-z0-9_-]{1,32}$`.

The plaintext is the exact LP-framed proposal fields used by the proposal digest, with the same
tool-specific order. The AAD is:

```text
UTF8("ii-tonya/client-conversation-operation-aead/v1\0") ||
LP("1") || LP(keyId) || LP(operationId) || LP(messageEventId) || LP(bindingId) ||
LP(toolKind) || LP(requiredScope) || LP(proposalDigest) || LP(payloadExpiresAt)
```

`payloadExpiresAt` is canonical UTC `YYYY-MM-DDTHH:mm:ss.sssZ`. Every AAD field is reloaded from the
same row; swap, metadata edit, tag edit, truncation, unknown version/key, or decrypt error is one
normalized `crypto_invalid` dead letter/security case and never reveals which check failed.

Key states are `active`, `decrypt_only`, `retired`, or `compromised`. Exactly one key may encrypt;
active and decrypt-only keys may decrypt. A key remains decrypt-capable for at least 24 hours plus
six minutes after its last encryption. Retired/compromised keys never decrypt. Compromise turns tool
dispatch off, prevents new freezes, privacy-expires affected ciphertext, and opens one security case;
it never attempts blind recovery. The provider obtains keys from an approved secret store, records
only key ID/state, never logs/exports key material, plaintext, nonce, tag, or envelope, and wipes
explicit plaintext buffers in `finally` (without claiming JavaScript GC zeroization). Hostile vectors
cover nonce collision, AAD/ciphertext/tag swaps, wrong key state and rotation across the full window.

### 5.2 Normative database row shapes

The migration, Drizzle schema and parity tests must encode these predicates, not application-only
conventions:

- For provider `selarti.client-thread.v1`, `tenant_token` is non-null and matches the v1 token
  grammar and `token_version=1`; for every other provider both new columns are null.
- `(tool_kind,required_scope)` is exactly (`show_catalog`,`client_catalog:read`) or
  (`start_booking`,`client_booking:write`). Digests are 64 lowercase hex; attempts and
  reconciliation attempts are integers from 0 through 5; `payload_expires_at` is after creation and
  no later than creation plus 24 hours.
- `processing` has one non-null dispatch owner/token/lease, no reconciliation tuple, ciphertext
  present, and lease no later than payload expiry. `reconciling` has the inverse claim tuple and the
  same ciphertext/lease rule. `pending|retry_wait|unknown_outcome` have neither claim tuple and keep
  ciphertext. `retry_wait` alone requires `next_attempt_at`; other statuses require it null.
- Terminal `succeeded|denied|dead_letter|privacy_expired` rows have no claims, next attempt, or
  crypto fields. `succeeded` alone requires a result digest and null terminal reason. The other
  terminal states require a null result digest and a fixed reason from
  `grant_denied|invalid_operation|attempts_exhausted|payload_expired|crypto_invalid`; only
  `privacy_expired` may use `payload_expired`.
- `updated_at >= created_at`; grant expiry is after grant creation and revocation is null or no
  earlier than creation. `binding_id` may become null through erasure, but a null-binding nonterminal claim cannot pass the
  downstream transaction and must become `denied` or `privacy_expired`. Claim tokens and fence
  generations are checked together; every claim SQL increments the generation atomically, so a
  reused token cannot revive an old claim. Operator case/deletion receipt uniqueness is
  `operation_id` plus case kind, so retries cannot create a second case.

Hostile SQL tests attempt every forbidden provider, scope/tool, status/claim, crypto, digest,
attempt, expiry, terminal/result and timestamp shape against real PostgreSQL and schema parity.

`completeInbound` locks message/inbox, verifies the payload digest and user, writes the one ledger
fact, one audit fact, and either the ordinary existing outcome or one encrypted typed operation in
the same serializable transaction. It does not call a tool. A duplicate reads the stored outcome.
Crash before commit has no durable effect; retry may infer again but only one proposal can win the
transaction. Crash after commit never runs inference again.

A dedicated bounded worker job—not `integration_outbox`, not a provider handler and not the
outbox topic registry—claims operations with `FOR UPDATE SKIP LOCKED`, database-time five-minute
lease capped at `payload_expires_at` and fencing token. It decrypts the exact frozen input and
passes its runtime-authenticated, tool-bound claim to the matching gateway. The downstream
transaction freshly locks and rechecks binding, user, exact grant and operation fence before it can
mutate. A result is recorded under the fencing token, its digest is stored, and ciphertext is
cleared.

The operation state machine is closed:

```text
pending -> processing
retry_wait -> processing
processing -> succeeded | denied | retry_wait | unknown_outcome | dead_letter | privacy_expired
processing --expired lease--> unknown_outcome
unknown_outcome -> reconciling
reconciling -> succeeded | unknown_outcome | dead_letter | privacy_expired
reconciling --expired lease--> unknown_outcome
```

`succeeded`, `denied`, `dead_letter`, and `privacy_expired` are terminal. Grant absence/expiry/revocation is `denied`;
pre-call grant/database unavailability is `retry_wait`; malformed ciphertext/digest/scope-kind
pair is immediate `dead_letter`. A known downstream business result (`applied|not_found|conflict|
feature_disabled`) is `succeeded` with a digest over its fixed code and receipt fields. Once the
gateway call begins, an unexpected exception is `unknown_outcome`, because commit is not disproven.
Attempt/reconciliation counters are capped at five.

Payload expiry is a privacy fence, not an ordinary failure. Claims and downstream transaction
timeouts may not extend beyond it. At DB time `payload_expires_at`, cleanup locks the row (stealing
only an expired lease), increments the fence, invalidates both dispatch/reconciliation claim tuples,
transitions every nonterminal status to `privacy_expired`, sets fixed reason `payload_expired`,
nulls envelope/key/nonce/ciphertext/tag in the same transaction, and inserts exactly one sanitized
operator case plus deletion receipt under unique `operation_id`. A still-running owner cannot have
a valid lease after expiry and its fenced write fails. Dispatch starts only with at least 30 seconds
remaining and uses transaction-local statement/lock/idle timeouts bounded by the expiry; tests hold
each competing lock across the deadline. Legal hold cannot bypass this transition.

Unexpected service failure after invocation becomes `unknown_outcome`, never blind retry. The
reconciliation phase replays the same frozen call through the downstream service's server-derived
idempotency: catalog returns the same owner request; booking returns the same protected receipt.
Five dispatch or reconciliation failures move to `dead_letter`, clear ciphertext, and create one
operator case. Lease expiry is reclaimable; a stale owner cannot write. Required crash tests cover
before freeze, after freeze/before call, after downstream commit/before receipt, and after receipt,
with a nondeterministic engine returning a different second proposal.

## 6. Exact tools and ownership

```ts
export type ClientConversationToolProposal =
  | { readonly kind: "show_catalog"; readonly serviceCode?: string; readonly language?: string }
  | { readonly kind: "start_booking"; readonly choiceHandle: `ch1.${string}` };
```

Exact keys only. `serviceCode` is 1–64 trimmed non-control characters; `language` is 1–32;
`choiceHandle` matches `^ch1\.[A-Za-z0-9_-]{43}$`. User/expert/slot/reservation/provider IDs,
amount, price, payment, contact, authorization, URL, idempotency key, clock/version, free-form tool
name and nested payload are rejected.

The catalog gateway accepts only a runtime-authenticated `show_catalog` operation claim. Its
conversation-specific `ClientCatalogService` entry point performs the shared-lock/fresh
`client_catalog:read` recheck inside the request transaction; catalog owns request digest, snapshot,
local outbox, replay, retention and errors. The booking gateway analogously accepts only a
`start_booking` claim, and its protected booking entry point performs the shared-lock/fresh
`client_booking:write` recheck inside the reservation transaction; booking owns choice/owner/
freshness, idempotency, receipt, audit, state and dormant provider outbox. Neither gateway accepts
the other claim or a structural `ClientPrincipal` from conversation code.

## 7. AI behavior checkpoint

Replacing `start_booking {expertId}` with a protected `choiceHandle` is categorically an AI tool
schema and routing behavior change. Before implementation completion or any non-fixture proposal
engine, record all three: real-incident regression cases, distribution/diff against the prior
release, and named Product/Safety/Security human spot-check signoff. Until then only a
deterministic test proposal engine may run. `LLM_ENABLED=false` remains default. Existing
deterministic safety-first order and approved handoff behavior are not weakened.

## 8. Worker registry, provider, and unknown delivery

The dedicated operation job is not an outbox handler. The only tool-related outbox handler remains
existing local `catalog.show`; conversation adds no topic to exports, registry or claim/reconcile
allowlists. Existing ConversationService may still persist its pre-existing `selarti.send` answer
and `client.no_package` completion facts; they remain absent from the worker registry and no handler
in this slice can claim them. Booking-created Planerka/Telegram facts likewise remain dormant.
Contract tests enumerate the registry and these allowed dormant row topics separately. There are
zero provider and outbound-billing attempts.

Future approved Selarti send acceptance is not delivery evidence. After-write/ambiguous response
is `unknown_outcome` with the original server key; only authoritative reconciliation may resolve
it and exhaustion becomes dead-letter/operator case. No current delivery handler exists.

## 9. Privacy, retention, and erasure matrix

| Data | Primary lifetime and cleanup | Erasure | Live gate |
| --- | --- | --- | --- |
| raw body/text/headers/identity | memory only through bounded request; never logged/persisted | discarded before response | raw-content prohibition |
| provider mapping ciphertext/tokens | account lifetime in existing mapping | mapping delete; grants cascade; operation binding becomes null | approved provisioner/key custody |
| operation ciphertext | pending/recovery only; clear on success/denied/dead-letter or fenced `privacy_expired` at 24h | mapping deletion wins the shared lifecycle lock or waits for an earlier mutation; cleanup privacy-expires remaining ciphertext | encryption/key and cleanup evidence |
| operation kind/status/digests/message link | inherited message-metadata period, currently proposed three years | binding nulled; wider message-event subject link remains an explicit platform blocker | Legal/Privacy approval plus platform anonymization proof |
| inbox/message/ledger/audit | existing retention contract | existing privacy workflow; this slice does not claim missing anonymization is solved | no live data until executable anonymization and 35-day backup receipt exist |

The operation cleanup job uses the exact expiry transition in section 5, the shared lifecycle lock
order, legal-hold flag from the approved retention service, fixed batches and unique deletion
receipts. It runs at least every minute while readiness is exposed; live activation treats a missed
heartbeat, any ciphertext past its deadline, or cleanup lag over 60 seconds as a security incident
and withdraws the route. Legal hold may retain digests/status but never extends ciphertext. This
slice implements mapping/grant/operation cleanup and tests it, while live activation remains blocked
on broader message-event anonymization and backup-expiry evidence.

Logs/traces/metrics/errors/evidence exclude raw content/headers/identity, HMAC/ciphertext, UUID,
handles, filters, proposal/result payload and free text. Metrics use only operation
`authenticate|resolve|freeze|dispatch|reconcile|cleanup` and outcome
`accepted|duplicate|denied|conflict|rate_limited|retry|unknown|succeeded|dead_letter|unavailable|failed`.

## 10. Defaults, migration, and verification

```text
CLIENT_CONVERSATION_ENABLED=false
CLIENT_CONVERSATION_TOOL_DISPATCH_ENABLED=false
SELARTI_ENABLED=false
LLM_ENABLED=false
SELARTI_OUTBOUND_BILLING_MODE=disabled
```

API preflight proves only its local ordered-header capability, identity/message/operation
repositories, crypto, safety/handoff, rate, DB and redaction dependencies. Worker preflight proves
only its local crypto, operation cleanup/dispatch repositories, exact gateways and merged catalog/
booking dependencies. Neither process claims local startup can prove the other process exists.

The migration also adds `client_conversation_runtime_leases(capability,instance_id,
contract_version,build_sha,heartbeat_at,lease_until)` with exact capabilities `dispatch_v1` and
`cleanup_v1`. The worker writes database-time 30-second leases every 10 seconds only after its
matching job is running. Before registering an exposed route, deployment readiness requires both
capabilities with `contract_version=1`, the API's exact build SHA, and at least five seconds
remaining. Before any tool proposal is frozen, the completion transaction repeats that DB-time
check; absence/incompatibility is pre-completion `503`, never an accepted stranded operation.
Continuous readiness fails on either lease loss, the route is withdrawn from load balancing, and
alerts fire at 20 seconds heartbeat age or any cleanup lag. Activation starts worker before API.

Invalid local flag/dependency matrices fail pure preflight before migration, route, job or listener.
`CLIENT_CONVERSATION_ENABLED=true` never implies worker/provider/AI; worker dispatch requires its
own tool flag. All flags remain false by default.

One reviewed migration is required. Its numeric prefix is deliberately absent: after booking
merges, inspect the journal and allocate only the next actual entry. It adds tenant/version binding
columns, grants, operations, constraints/indexes/FKs and cleanup state above; no other schema is
authorized.

Development may run and repeat focused/property/concurrency tests as needed without calling the
Claw/PG release gate. After independent review closes every Critical/Important finding, one total
immutable `client-conversation` Claw/PostgreSQL 16.15 (`server_version_num=160015`) release-evidence invocation is permitted for
the reviewed SHA/invocation identity. Pass ends the gate. Failure is preserved and blocks this
story; remediation requires an explicitly approved successor verification identity, new clean
SHA, delta review and separate authorization, never a silent rerun.
