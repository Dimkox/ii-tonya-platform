# MVP-CLIENT-CONVERSATION-001 — Canonical Specification

Status: docs approved for implementation planning after independent review (0 Critical, 0
Important, 0 Minor). Implementation and live activation remain blocked. Exact implementation base:
`141fd0229816723b137663816b2dc1773934f13f` (merged protected booking, PR #29).

## Objective, actors, owners, and approvals

An authenticated fixture can bind one exact Selarti tenant/user/thread identity to an active
internal client, atomically freeze one typed catalog or protected-booking operation with message
accounting, and let a dedicated local runner dispatch it through a runtime-authenticated claim and
an exact grant rechecked inside the downstream transaction. Identity/
Security owns inbound and grants; Conversation owns validation/freeze; Catalog and Booking own
state; Privacy owns cleanup; Verification owns the one release gate. Product, Booking and Security
approve the tool/authority contract. Provider, Legal/Privacy, AI-human and deployment approvals
are separate live gates.

## Requirements

- **CCV-001 — Exact base, prerequisite, and defaults.** Start implementation only after merged or
  reviewed-equivalent protected booking. `CLIENT_CONVERSATION_ENABLED=false`,
  `CLIENT_CONVERSATION_TOOL_DISPATCH_ENABLED=false`, `SELARTI_ENABLED=false`,
  `LLM_ENABLED=false`, and `SELARTI_OUTBOUND_BILLING_MODE=disabled`. Disabled composition creates
  no route, capability, operation runner, AI/provider client, credential read, or network call.
- **CCV-002 — Ordered authenticated fixture only.** Authentication consumes ordered occurrences
  from `request.raw.rawHeaders`, never a normalized map. Mixed-case duplicates/folding are denied.
  Only direct HTTP/1.1, `trustProxy=false`, valid socket source and a test-only injected capability
  are executable. HTTP/2/proxy paths, runtime fixture imports, allow-all/env fakes, live codec,
  credential, endpoint and transport are absent.
- **CCV-003 — Exact v1 identities and payload hash.** Fixture tokens use the exact length-prefixed
  HMAC domains in `docs/contracts/client-conversation.md`, include tenant/user/thread in subject,
  event and message tokens, and accept only `hmac-sha256:v1:<64 lowercase hex>`. Replay digest is
  the exact domain-separated SHA-256 over tenant/subject/event/message/time/text. No version
  rotation or provider-uniqueness assumption is claimed.
- **CCV-004 — Tenant-bound fresh identity.** Fresh resolution matches provider literal,
  `tenant_token`, `subject_token`, token version 1 and `users.active=true`; it returns only a
  nominal `ClientConversationIdentity` with internal binding/user IDs. No inbound UUID, bearer,
  `channel_identities`, display/username, cached claim, fallback or user/binding creation is
  authority. Missing/inactive/erased/corrupt/mismatched binding is denied; outage unavailable.
- **CCV-005 — Runtime claim plus serialized exact grant.** Identity is not tool authority. The
  operation repository privately mints a native-private-field/WeakSet-authenticated claim bound to
  one fence/tool/scope/input. After the existing repository-owned catalog `userId:requestDigest` or
  booking `choice:choiceDigest` advisory
  prelock, the matching transaction locks `users -> mapping -> exact grant -> operation`, rechecks
  all facts, then takes remaining downstream locks and mutates. Lifecycle paths start at `users` and
  never wait for a tool prelock; whichever transaction commits first wins. Cast/plain JS/
  cloned/cross-tool claims and structural principals fail at runtime. HTTP Bearer contracts remain
  unchanged; this channel seam requires Booking/Security approval.
- **CCV-006 — Bounded edge and rate.** Exact body/framing/header/UTF-8 validation, five-minute past/
  30-second future window, source 60/process 600/tenant 300/subject 30 fixture buckets and fixed
  `400|401|409|413|429|503|202` matrix apply before their documented stage. Fixture limits are not
  live evidence; replicated deployment requires approved edge/distributed limits and proxy proof.
- **CCV-007 — One inbox completion owner.** Existing `integration_inbox`, message-event link,
  payload digest and completion row lock remain the only event admission path. Same event/hash
  completes or replays once; different hash is terminal conflict. Concurrent inferences may occur
  before lock, but only the first serializable completion can freeze a durable outcome.
- **CCV-008 — Freeze before mutation.** For a valid tool, `completeInbound` atomically writes one
  ledger/audit fact and one encrypted `client_conversation_operations` row unique by message event
  before any catalog/booking call. The row freezes binding, exact scope/kind/proposal digest and
  input ciphertext with a 24-hour cap. Crash before commit has no effect; after commit replay never
  invokes inference again.
- **CCV-009 — Dedicated fenced operation runner.** A bounded local job—not integration outbox or
  provider registry—claims with `FOR UPDATE SKIP LOCKED`, database-time five-minute lease capped by
  payload expiry and fencing token. It decrypts the frozen input, mints one runtime claim, invokes
  only the matching transactional gateway and records a result digest before clearing ciphertext.
  AES-256-GCM v1 uses a unique 96-bit nonce, exact AAD, injected key lifecycle and normalized
  failures. Lease expiry is reclaimable; stale owners cannot write.
- **CCV-010 — Typed catalog gateway.** Exact `show_catalog` has only bounded optional serviceCode/
  language. A runtime-authenticated show-catalog claim calls the conversation-specific
  `ClientCatalogService` entry point, which locks/rechecks catalog-read grant in its transaction; catalog owns
  owner digest/request/snapshot/outbox/replay/retention. Conversation/runner never writes catalog
  state or accepts the booking brand.
- **CCV-011 — Typed protected booking gateway.** Exact `start_booking` has only
  `ch1.<43 base64url>`. A runtime-authenticated booking claim calls the protected channel entry
  point, which locks/rechecks booking-write grant in the reservation transaction. Booking owns
  choice ownership/freshness, idempotency, transaction, receipt,
  audit, state and dormant provider outbox. `expertId`, direct IDs, amount/payment/contact/provider/
  caller idempotency and catalog/conversation authority are forbidden.
- **CCV-012 — Unknown operation and delivery outcomes.** Unexpected failure after a tool call is
  `unknown_outcome`, never blind retry. Reconciliation replays the exact frozen downstream
  idempotent call; five failures become dead letter plus one operator case. The operation job adds
  no outbox topic or claim/reconcile registry entry. Existing local `catalog.show`, `selarti.send`,
  and `client.no_package` completion rows retain their current local semantics; this slice adds none
  and makes no new provider handler claimable. Booking-provider topics remain absent. Future Selarti ambiguity also requires authoritative
  reconciliation and is never delivery/billing evidence.
- **CCV-013 — AI change gate is mandatory.** Replacing `start_booking {expertId}` with protected
  choice is categorically an AI schema/routing change. Before implementation completion or any
  nonfixture engine, record real-incident regressions, prior-release distribution/diff and named
  Product/Safety/Security spot-check signoff. Until then deterministic fixtures only; LLM false.
- **CCV-014 — Concrete privacy lifecycle.** Mapping deletion follows the shared lifecycle locks,
  cascades grants and nulls operation binding only after any earlier mutation commits. Pending
  ciphertext clears on success/denied/dead-letter. At expiry, cleanup steals only expired leases,
  increments the fence, writes terminal `privacy_expired/payload_expired`, clears all envelope
  fields and inserts one operator case/deletion receipt transactionally. Status/digests inherit message metadata
  retention; live activation remains blocked until Legal/Privacy approves it and the wider
  platform proves message-event anonymization plus 35-day backup expiry. Raw content/identity is
  never persisted or logged.
- **CCV-015 — Fixed telemetry and errors.** Logs/traces/metrics/errors/evidence exclude raw content/
  headers/identity, tokens/ciphertext, UUID, handles, filters, proposal/result payload and free
  text. Only operation/outcome enums in the contract are permitted. The post-freeze external
  response is always no-store `202`; the local runner owns retry and terminal operator cases.
- **CCV-016 — Fail-closed composition.** API and worker validate only their local dependencies.
  Separately deployed worker jobs publish DB-time 30-second `dispatch_v1`/`cleanup_v1` leases every
  10 seconds with contract v1 and exact build SHA. Deployment readiness and every tool freeze
  require both compatible leases; loss withdraws readiness and prevents new freezes. Invalid local
  matrices fail before route/job/listener; no flag implies worker/provider/AI.
- **CCV-017 — One actual post-booking migration.** After booking merges, inspect the journal and
  allocate only the next actual prefix. Add tenant/version mapping fields, grants, durable operation
  state, exact provider/scope/status/claim/crypto/result checks, runtime leases, cases, indexes/FKs/
  cleanup. No prefix is reserved and no other schema is authorized.
- **CCV-018 — Development and one release gate.** Development may repeat focused/property/race
  tests without invoking Claw/PG. After zero unresolved Critical/Important findings, run one total
  immutable `client-conversation` Claw/PostgreSQL 16.15 release-evidence invocation for the reviewed SHA and
  identity. Pass ends the gate; failure is preserved and blocks this story. A successor run needs
  new SHA, delta review and explicit new verification identity/authorization, never silent rerun.
- **CCV-019 — Activation remains NO-GO.** Live requires immutable provider auth/payload/rate/
  delivery contract, binding/grant provisioner and key lifecycle, Privacy/Legal evidence, mandatory
  AI signoff, staging, Product/Booking/Security approvals and separate deployment authorization.
  Docs/tests/gates grant none.

## Acceptance criteria

| ID        | Acceptance                                                                                                                                                                                             |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| CCV-AC-01 | All defaults create no route/job/provider/AI/network; invalid matrices fail before migration/listen.                                                                                                   |
| CCV-AC-02 | Duplicate/folded headers, HTTP/2/proxy ambiguity and hostile capability shapes fail before authentication/resolution; raw ordered HTTP/1.1 vectors pass only in the fixture.                           |
| CCV-AC-03 | Exact tenant/user/thread/event/message/payload vectors avoid cross-tenant/thread collisions; only version 1 parses.                                                                                    |
| CCV-AC-04 | Active exact binding resolves; inbound UUID, channel identity, wrong tenant, inactive/erased binding and outage never become authority.                                                                |
| CCV-AC-05 | Runtime claim forgeries fail; catalog cannot book; real-PG races prove lifecycle commit-winner, no deadlock, and identical ordinary/conversation prelock keys including booking `choice:choiceDigest`. |
| CCV-AC-06 | Three same event/hash deliveries create one message/accounting/operation; changed hash is conflict; concurrent different proposals produce one frozen winner.                                          |
| CCV-AC-07 | Crash tests before freeze, after freeze, after downstream commit and after receipt resume one exact effect; nondeterministic second inference cannot change the frozen operation.                      |
| CCV-AC-08 | Catalog and protected booking gateways receive only matching runtime-authenticated claims and exact frozen input; zero structural principal/direct repository/financial/provider authority crosses.    |
| CCV-AC-09 | Leases/fencing/unknown reconciliation/dead-letter counts are deterministic; exact AEAD hostile vectors pass; the operation job is absent from outbox registry and providers record zero attempts.      |
| CCV-AC-10 | Lifecycle races serialize; expiry transaction writes `privacy_expired`, invalidates stale claims, creates one case/receipt, clears crypto, and logs/exports/evidence contain no forbidden sentinels.   |
| CCV-AC-11 | Mandatory AI regression/diff/named signoff artifacts exist before implementation completion/nonfixture engine.                                                                                         |
| CCV-AC-12 | Closure review has zero Critical/Important and one total immutable release gate records exact SHA/identity, PostgreSQL 16.15, counts, cleanup and no credentials.                                      |

## Non-goals and blockers

No live provider, binding/grant enrollment API, payment/pricing, catalog/booking redesign, outbound
delivery, AI prompt/model execution, deployment or production mutation is in scope. Implementation
awaits booking merge, contract approvals, mandatory AI evidence and review closure. Live activation
also remains blocked by provider, key/provisioner, Privacy/Legal, staging and deployment gates.
