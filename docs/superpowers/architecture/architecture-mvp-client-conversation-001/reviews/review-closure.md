# Closure Re-review — MVP-CLIENT-CONVERSATION-001

Verdict: **BLOCKED**. The revised v2 set materially closes C-2, C-3, C-5 and I-1–I-9 from the draft review, and it substantially improves C-1/C-4. It does not yet reach the required zero Critical/Important threshold: the documented nominal authorities have no runtime authenticity, grant/erasure freshness is subject to a check-then-use race, and several lower-level implementations incompatible with the intended spine still satisfy the written contracts.

Review base: `dad7e3a867e0ee4e262c5da28fd7a1f7c03449b9`. Authored documents were reviewed read-only. Existing code and sibling booking documents remain implementation-reality inputs, not evidence that this docs-only slice is implemented.

## Closure of prior findings

| Prior finding | Closure result | Material evidence |
| --- | --- | --- |
| C-1 booking authority laundering | **Reopened below** | Exact grants and separate gateway are added, but the shown brand is compile-time only and grant use is racy. |
| C-2 duplicate headers | Closed | Ordered `request.raw.rawHeaders`, direct HTTP/1.1 boundary and proxy/HTTP2 denial: `docs/contracts/client-conversation.md:6-56`. |
| C-3 resumable operation state | Closed subject to new findings | Dedicated operation state, leases/fence and non-outbox runner: `docs/contracts/client-conversation.md:179-229`. |
| C-4 retention/erasure | **Reopened below** | Concrete matrix and migration exist, but erasure/revocation is not atomic with tool use. |
| C-5 volatile proposal | Closed | Freeze and accounting share one transaction before mutation; no inference after commit: `docs/contracts/client-conversation.md:200-229`. |
| I-1 payload digest | Closed | Exact domain-separated serialization: `docs/contracts/client-conversation.md:87-99`. |
| I-2 token namespaces | Closed | Event/message domains include tenant/user/thread: `docs/contracts/client-conversation.md:69-85`. |
| I-3 HMAC rotation | Closed for this fixture-only slice | Parser accepts only fixture v1 and makes live rotation an explicit blocker: `docs/contracts/client-conversation.md:54-60,82-85`. |
| I-4 replicated rate limit | Closed | In-process limits are fixture-only; live distributed/proxy evidence is mandatory: `docs/contracts/client-conversation.md:157-162`. |
| I-5 HTTP outage semantics | Closed | Complete state/owner matrix and post-freeze 202 ownership: `docs/contracts/client-conversation.md:164-177`. |
| I-6 typed boundaries | **Reopened below** | Separate types exist, but runtime authenticity and resolver use are not sealed. |
| I-7 AI signoff | Closed | Change is categorical and all three checks precede implementation completion: `docs/contracts/client-conversation.md:252-259`. |
| I-8 one-shot gate | Closed | Repeatable development diagnostics are separated from immutable release evidence: `docs/contracts/client-conversation.md:313-318`. |
| I-9 tenant binding | Closed | Mapping resolution matches tenant, subject and version: `docs/contracts/client-conversation.md:101-108`. |

## Critical

### C-1 — The “nominal” authorities have no runtime authenticity

**Evidence:** The normative contract defines catalog and booking authority as plain object types carrying a `unique symbol` brand (`docs/contracts/client-conversation.md:115-133`) and relies on private constructors/import tests (`docs/contracts/client-conversation.md:135-141`). The plan exposes gateways that receive those objects (`docs/superpowers/plans/2026-08-14-mvp-client-conversation-001.md:237-246`). TypeScript brands and private constructors are erased at runtime; an object asserted through `unknown`, deserialized input, compromised adapter, or JavaScript caller is indistinguishable from a minted authority. The contract promises “hostile runtime tests” but specifies no runtime verification material. The existing shared `ClientPrincipal` is likewise a structural `{authenticated,active,userId}` object (`packages/application/src/ports.ts:281-294`).

**Incompatible lower-level implementation that still satisfies the spine:** `reserve({userId} as ConversationBookingAuthority, input)` passes type checking through an assertion and the gateway forwards it because the only runtime field is `userId`. AD-4's “nominal” wording (`docs/superpowers/architecture/architecture-mvp-client-conversation-001/ARCHITECTURE-SPINE.md:50-54`) does not reject this implementation.

**Consequence:** Any in-process caller that learns a user UUID can forge booking-write authority and recreate the confused-deputy path C-1 was meant to remove.

**Required remediation:** Make the gateway accept an unforgeable runtime capability: for example a non-exported class verified by private-field/`WeakSet` membership, or better a closure/gateway method that accepts an operation claim and performs grant resolution internally without returning authority. Define the runtime rejection behavior and tests for `as unknown as`, plain JS objects, cloned/deserialized objects, cross-brand objects and stolen user IDs. Do not forward a bare structural principal into booking.

### C-2 — Grant revocation and mapping erasure race with downstream mutation

**Evidence:** The runner freshly resolves mapping/user/grant and then calls a gateway (`docs/contracts/client-conversation.md:135-141,217-225`). Mapping deletion is claimed to prevent dispatch (`docs/contracts/client-conversation.md:274-285`; `docs/spec/mvp-client-conversation-001.md:81-86`), but no lock or transaction spans the grant check, mapping/grant deletion, and catalog/booking commit. The migration uses `ON DELETE SET NULL` only after deletion (`docs/superpowers/plans/2026-08-14-mvp-client-conversation-001.md:59-89`). The sibling booking service owns a separate transaction, so a resolver transaction cannot automatically protect its mutation.

**Incompatible lower-level implementation that still satisfies the spine:** Worker A reads an active booking grant and mints authority; erasure/revocation transaction B commits; worker A then calls `reserve` and creates the booking. Every documented step occurred in order and the grant was “fresh” when read, yet the claimed post-erasure dispatch prevention is false.

**Consequence:** A booking or catalog effect can be created after consent/scope revocation, account erasure, or mapping deletion, violating both authority and privacy guarantees.

**Required remediation:** Specify one enforceable serialization protocol shared by grant lifecycle and tool mutation. Options include a binding-scoped PostgreSQL advisory lock held by dispatch through the downstream local transaction with erasure/revocation taking the same lock, or moving the exact grant recheck into the catalog/booking transaction under a locked grant/mapping row. Freeze lock order, timeout and crash behavior; add deterministic races for revoke/delete immediately before and during gateway commit and require no post-revocation effect.

## Important

### I-1 — Operation encryption is not a reproducible security contract

**Evidence:** The contract requires “authenticated encryption,” ciphertext and a key version (`docs/contracts/client-conversation.md:187-221`) but never fixes the AEAD algorithm, nonce generation/uniqueness, envelope framing, authenticated associated data, key source/custody, decrypt-failure normalization or key-retirement behavior during the 24-hour recovery window. The implementation plan creates `client-conversation-operation-crypto.ts` but supplies none of these invariants (`docs/superpowers/plans/2026-08-14-mvp-client-conversation-001.md:190-216`). The live runbook asks for encryption evidence only as part of a future provisioner gate (`docs/runbooks/client-conversation-activation.md:20-25`).

**Incompatible lower-level implementation that still satisfies the spine:** AES-GCM with a constant nonce, or AEAD authenticating only plaintext while omitting message event/binding/scope/tool/expiry as AAD, still meets the words “authenticated encryption” and can pass round-trip tests.

**Consequence:** Nonce reuse can expose plaintext/key material; ciphertext can be transplanted between operations or interpreted under changed metadata; key rotation can strand live recovery operations.

**Required remediation:** Freeze the envelope version, approved AEAD, CSPRNG nonce size/uniqueness, exact AAD containing operation ID/message event/binding/scope/tool/proposal digest/expiry, key-provider boundary, active/decrypt-only/retired states, maximum decrypt lifetime, zeroization expectations and hostile swap/nonce/decrypt vectors.

### I-2 — The 24-hour hard-clear path has no terminal state transition

**Evidence:** Ciphertext must be cleared at 24 hours regardless of legal hold (`docs/contracts/client-conversation.md:274-285`; `docs/superpowers/plans/2026-08-14-mvp-client-conversation-001.md:248-256`), while operations can remain `processing`, `retry_wait`, `unknown_outcome` or `reconciling` (`docs/contracts/client-conversation.md:189-198`). The documents do not say how hard-clear atomically fences an active claimant, which terminal reason/status is written, or whether the required operator case is created when the exact frozen call becomes unrecoverable.

**Incompatible lower-level implementation that still satisfies the spine:** Cleanup nulls ciphertext on an `unknown_outcome` row while a worker lease remains valid; the worker later writes retry state, or reconciliation repeatedly fails decrypt and consumes attempts without one deterministic terminal case.

**Consequence:** Recovery state becomes internally contradictory, a stale worker can act after privacy cleanup, and an unknown downstream effect can be silently abandoned without operator ownership.

**Required remediation:** Define hard-clear as one fenced transaction: acquire/steal only an expired lease, invalidate prior claim tokens, transition every nonterminal row to one fixed terminal/privacy-expired state, clear ciphertext/key/nonce, and create exactly one sanitized operator case/deletion receipt. Specify handling when a lease is still active at expiry and test the race.

### I-3 — Cross-process “preflight requires operation job” is not realizable as written

**Evidence:** The contract says conversation enablement requires the operation job and invalid matrices fail before route, worker or listener (`docs/contracts/client-conversation.md:293-306`; `docs/spec/mvp-client-conversation-001.md:91-95`). The structural seed places the route in `apps/api` and the job in separately composed `apps/worker` (`docs/superpowers/architecture/architecture-mvp-client-conversation-001/ARCHITECTURE-SPINE.md:121-140`). A pure process-local preflight cannot prove that the other process/deployment is enabled, healthy or running.

**Incompatible lower-level implementation that still satisfies the spine:** API starts with all local dependencies and accepts/freezes operations while the worker deployment is absent or its tool-dispatch flag is false; each process's local preflight passes its own matrix.

**Consequence:** Accepted requests accumulate permanently pending operations while the external response is fixed 202, creating silent availability loss and eventual privacy-expiry dead letters.

**Required remediation:** Split API and worker configuration implications explicitly. API preflight can prove freeze dependencies only; worker preflight proves dispatch dependencies. Activation must require deployment-level readiness evidence (worker heartbeat/lag and compatible contract/schema version) before exposing the route, with alert/rollback thresholds. Do not claim pure startup validation proves cross-process presence.

### I-4 — The DDL contract leaves security-critical checks to unspecified tests

**Evidence:** The plan's required DDL adds nullable `tenant_token`/`token_version` with no shown check or conditional NOT NULL rule (`docs/superpowers/plans/2026-08-14-mvp-client-conversation-001.md:51-58`), and its operation table has unconstrained `required_scope`, `tool_kind`, `status`, claim tuple and terminal fields (`docs/superpowers/plans/2026-08-14-mvp-client-conversation-001.md:69-90`). Step 2 merely says tests will assert “scope/state/check pairings” (`docs/superpowers/plans/2026-08-14-mvp-client-conversation-001.md:93-100`) without making the exact predicates normative. AD-3/AD-5 require exact pairing and fenced state but do not enumerate legal row shapes (`docs/superpowers/architecture/architecture-mvp-client-conversation-001/ARCHITECTURE-SPINE.md:44-60`).

**Incompatible lower-level implementation that still satisfies the spine:** A migration allows `tool_kind='start_booking'` with `required_scope='client_catalog:read'`, a `processing` row without claim token/lease, or a fixture provider mapping with null token version; application code normally avoids these rows, but corruption/manual writes turn them into authority or recovery ambiguity.

**Consequence:** Database state can encode cross-scope operations or unfenced claims, and different implementations can write mutually unreadable/unsafe states while each claims compliance.

**Required remediation:** Put the exact provider-conditional mapping checks, scope/tool pairing, status enum, claim/lease/state truth table, digest grammar, attempt bounds, ciphertext/terminal/result invariants and timestamp lifecycle in the normative contract and migration, not only test prose. Include hostile SQL/parity tests for every forbidden row shape.

## Minor

### M-1 — Canonical spec overstates absence of existing conversation topics

**Evidence:** `docs/spec/mvp-client-conversation-001.md:71-76` says Selarti/no-package/conversation topics “remain absent,” while existing application code emits `selarti.send` for answers and `client.no_package` for no-package completion (`packages/application/src/ports.ts:113-136`; `packages/application/src/conversation-service.ts:715-737`). The v2 contract more narrowly says the new operation job adds no registry topic (`docs/contracts/client-conversation.md:261-270`).

**Consequence:** Tests may assert no rows/topics at all and accidentally remove established local completion behavior, or may ignore provider-like rows because “absent” was interpreted as registry-only.

**Required remediation:** Say explicitly whether absence means worker registry membership, newly created rows, or all persisted topics. List the exact allowed existing completion topics and prove none is claimable by a provider handler under this slice.

## Good-spine and repository-reality result

The spine is materially improved: it selects one orchestration owner, separates provider/outbox authority, identifies exact technology versions, acknowledges the required migration, and links capabilities to invariants. It still permits the four incompatible lower-level implementations above because runtime capability authenticity, lifecycle/mutation serialization, cryptographic envelope, expiry transition and database truth tables are not fixed tightly enough. Those are architecture-spine holes, not implementation-detail preferences.

The technology choices otherwise match the current repository: Fastify exposes Node raw header occurrences, PostgreSQL supports the proposed row/advisory locks and `SKIP LOCKED`, Drizzle can express the schema, and the API/worker are separate runtimes. Existing code remains structurally incompatible until implementation: direct `userId`, `expertId`, synchronous completion outbox outcomes and the old route/header map are current reality, not closure evidence.

## Counts

- Critical: 2
- Important: 4
- Minor: 1
- Total: 7
