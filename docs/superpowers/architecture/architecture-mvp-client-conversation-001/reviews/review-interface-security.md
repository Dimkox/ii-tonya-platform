# Independent Interface and Security Review — MVP-CLIENT-CONVERSATION-001

Verdict: **BLOCKED**. The documentation is not implementation-ready. The proposed channel principal launders conversation authentication into booking-write authority, the inbound interface cannot preserve the header evidence its own contract requires, and the claimed replay/privacy design depends on state the reused schema does not contain. Do not implement or run the one-shot release gate until every Critical and Important finding is closed and independently re-reviewed.

Review base: `dad7e3a867e0ee4e262c5da28fd7a1f7c03449b9`. Booking comparison: sibling `mvp-client-booking-001` documentation, including `docs/contracts/client-booking-principal-prerequisite.md` and `docs/contracts/client-booking.md`.

## Critical

### C-1 — Conversation authentication is incorrectly promoted to booking-write authority

**Evidence:** `docs/contracts/client-conversation.md:74-79,164-167`; `docs/spec/mvp-client-conversation-001.md:37-40,63-67`; `docs/superpowers/plans/2026-08-14-mvp-client-conversation-001.md:268-323`. The conversation resolver produces only `authority: "client_conversation:tools"`, then the plan passes that principal directly to booking. The newer booking authority contract requires a fresh proof of exact `client_booking:write` and explicitly says catalog scope and Selarti identity cannot supply booking authority (`../mvp-client-booking-001/docs/contracts/client-booking-principal-prerequisite.md:19-35`; `../mvp-client-booking-001/docs/contracts/client-booking.md:24-29`).

**Consequence:** Any valid conversation binding becomes a confused deputy able to reserve a booking even when the user has no booking-write grant, bypassing expiry/revocation/scope controls owned by booking.

**Required remediation:** Freeze a channel-to-booking authorization contract with Booking and Security. The booking service must accept a capability/principal type that proves a freshly checked `client_booking:write` grant for this channel, or perform its own fresh resolver check from an opaque channel credential. Do not cast or structurally reuse `ClientConversationPrincipal`/`ClientPrincipal`; add negative compile-time and runtime tests showing a conversation-only or catalog-only principal cannot reserve.

### C-2 — The authentication capability cannot prove duplicate-header rejection

**Evidence:** `docs/contracts/client-conversation.md:24-29` reduces headers to `Readonly<Record<string,string>>`, while `docs/contracts/client-conversation.md:104-106` requires rejection of duplicate security headers. The existing route likewise calls `headerRecord(request.headers)` (`apps/api/src/routes/selarti-webhook.ts:43-50`), after the server/framework may have folded or joined occurrences.

**Consequence:** Two credentials/signatures can be normalized into one string before authentication, enabling request-smuggling or verifier/proxy disagreement and making the promised duplicate-header guard unimplementable.

**Required remediation:** Define and consume raw ordered header occurrences (for example `readonly {nameBytes,valueBytes}[]`) obtained at a boundary that preserves duplicates. Specify proxy/protocol prerequisites and reject when preservation cannot be proven. Add mixed-case duplicate, comma-folded, HTTP/2, and proxy-normalization vectors before any parsing into a map.

### C-3 — Reused inbox state cannot encode the specified pending/resume/completion protocol

**Evidence:** `docs/contracts/client-conversation.md:121-138,171-175` and `docs/superpowers/architecture/architecture-mvp-client-conversation-001/ARCHITECTURE-SPINE.md:43-47` require resumable pending work and exactly one completion/accounting fact. The reused `integration_inbox` has only event ID, payload hash, normalized identifier, nullable message-event link, and timestamps—no status, lease/claim token, tool operation identity, or completed result (`packages/db/src/schema/integration.ts:37-53`). Nevertheless the docs declare no migration (`docs/contracts/client-conversation.md:233-236`).

**Consequence:** Concurrent or post-crash deliveries cannot distinguish an active owner from an abandoned attempt or prove which downstream tool result must be resumed; correctness is delegated to unrelated downstream deduplication and can strand or duplicate orchestration/accounting.

**Required remediation:** Provide a transaction/locking proof against the exact `prepareInbound`/`completeInbound` implementation and all concurrent crash points. If the existing message-event state is sufficient, specify its state machine, lock order, ownership and recovery timeout with tests. Otherwise stop under the documented migration rule and add explicit claim/status/version/tool-operation/result state after booking merges.

### C-4 — Erasure and three-year retention are asserted without a realizable data model

**Evidence:** `docs/contracts/client-conversation.md:203-213` requires mapping deletion, inbox/message/ledger anonymization, three-year token retention, and 35-day backup expiry. Existing `integration_inbox.message_event_id` links into message/accounting state and has no expiry or erasure marker (`packages/db/src/schema/integration.ts:37-53`); `provider_subject_mappings` has no lifecycle/expiry/key-version columns (`packages/db/src/schema/identity.ts:101-113`). The plan merely lists privacy repository edits while retaining the no-migration premise (`docs/superpowers/plans/2026-08-14-mvp-client-conversation-001.md:336-345`; `docs/contracts/client-conversation.md:233-236`).

**Consequence:** Subject-linked pseudonymous records can survive erasure, cleanup cannot enforce the promised periods, and operators cannot demonstrate deletion or backup expiry without either over-deleting accounting evidence or retaining linkable data.

**Required remediation:** Produce an exact table/column erasure and retention matrix, FK behavior, cleanup transaction, backup receipt and legal-hold behavior. Prove it against the current schema; if any required state is absent, invoke the migration stop rule. Legal/Privacy must approve the concrete implementation, not only prose periods.

### C-5 — The proposal is not durably frozen before synchronous tool mutation

**Evidence:** The current flow prepares the inbox/message, then calls the proposal engine (`packages/application/src/conversation-service.ts:587-597,654-667`) and only later completes the message (`packages/application/src/conversation-service.ts:697-737`). The new plan inserts synchronous catalog/booking calls directly from the transient proposal (`docs/superpowers/plans/2026-08-14-mvp-client-conversation-001.md:280-323`). Yet the contract claims a crash resumes and “repeats the typed call” (`docs/contracts/client-conversation.md:129-133,171-173`) without defining durable proposal/tool-operation storage. The reused inbox has no proposal digest, tool kind/input, operation identity, or result (`packages/db/src/schema/integration.ts:37-53`).

**Consequence:** After a crash following catalog/booking commit but before conversation completion, proposal inference runs again and may choose a different tool or different filters/choice. Downstream idempotency protects only an identical call; it cannot prevent two distinct valid effects from one inbound event.

**Required remediation:** Before the first tool call, atomically freeze a validated proposal digest plus exact typed operation identity against the inbox/message event. On replay, load that frozen operation and never invoke proposal inference again. Persist/replay the typed service receipt before final accounting completion. A typed local dispatch receipt may reuse the outbox storage primitives only if it is a non-worker, non-provider orchestration record with explicit states and no registry/claim path; do **not** register a worker topic merely to make a synchronous call. Prove crashes (a) before proposal freeze, (b) after freeze/before call, (c) after downstream commit/before receipt, (d) after receipt/before completion, plus a nondeterministic engine returning a different second proposal.

## Important

### I-1 — The canonical replay payload hash is undefined

**Evidence:** `docs/contracts/client-conversation.md:123-136` relies on a “canonical payload hash,” but never defines its domain separator, included fields, field order, byte framing, algorithm, or key/version. Token construction is precise at lines 39-60, highlighting the omission. `docs/spec/mvp-client-conversation-001.md:48-53` repeats the guarantee without supplying the algorithm.

**Consequence:** Implementations can disagree on whether changed text, time, tenant, subject, or message identity is a conflict; equivalent encodings may conflict and materially changed messages may replay.

**Required remediation:** Freeze a versioned, domain-separated byte serialization covering every effect-relevant canonical field (including tenant, subject, event, message, time and text), the exact digest representation, test vectors, and upgrade/dual-read policy.

### I-2 — Event and message token namespaces assume undocumented tenant-global identifier uniqueness

**Evidence:** Subject tokens include external user and thread (`docs/contracts/client-conversation.md:49-52`), but event and message tokens omit both and hash only environment/tenant/event or environment/tenant/message (`docs/contracts/client-conversation.md:53-57`). The runbook admits there is no immutable official provider contract (`docs/runbooks/client-conversation-activation.md:11-12,21`).

**Consequence:** If Selarti IDs are scoped to a chat/thread/user, unrelated conversations collide in the inbox, causing cross-thread conflicts, denial of service, or replay suppression.

**Required remediation:** Until provider evidence proves tenant-global uniqueness, include the same subject tuple in event/message token domains. Freeze collision vectors for identical event/message IDs across tenants, users and threads and bind the final choice to the approved provider snapshot.

### I-3 — Key rotation and retention requirements are mutually incomplete

**Evidence:** `docs/contracts/client-conversation.md:60-63` says every replica retains a versioned HMAC key until every accepted event and mapping expires. Mappings last for account lifetime and inbox metadata for three years (`docs/contracts/client-conversation.md:209-213`), while mapping erasure is immediate. There is no rule for key compromise, overlapping versions, maximum accepted version, retirement proof, or replay after key destruction.

**Consequence:** A compromised key may remain usable for years/account lifetime, arbitrary version strings may drive unsafe lookup behavior, and erasure/rotation can make legitimate replay unrecoverable or leave forgeable tokens accepted.

**Required remediation:** Define active/verify-only/retired/compromised key states, bounded accepted versions, rotation overlap, compromise cutover, mapping re-tokenization, replay behavior after retirement, custody/audit ownership and evidence that no raw key enters application memory outside the capability.

### I-4 — “Process-global” and source rate limits do not bound a replicated deployment

**Evidence:** `docs/contracts/client-conversation.md:110-119` explicitly reuses an in-process limiter and labels one bucket process-global. The architecture defers production topology/scaling (`docs/superpowers/architecture/architecture-mvp-client-conversation-001/ARCHITECTURE-SPINE.md:170-174`) and the runbook records no measured provider limit (`docs/runbooks/client-conversation-activation.md:11-12`).

**Consequence:** Attackers multiply limits by replica/restart count; untrusted proxy IP handling can collapse all users into one bucket or let attackers rotate/spoof sources, while authentication work remains an amplification target.

**Required remediation:** Specify trusted-proxy/source derivation and a distributed or edge-enforced limiter for any live topology, including restart behavior, replica cardinality, IPv6 normalization, saturation behavior and measured authentication cost. Keep fixture-only limits explicitly outside release claims.

### I-5 — Success/error semantics conflict at the tool-outage path

**Evidence:** `docs/contracts/client-conversation.md:140-141` says the external success response is always `202`, while lines 171-175 say a tool outage follows an unspecified “handoff/unavailable policy.” The fixed HTTP errors at lines 115-119 do not define post-admission tool failure, and the traceability table does not pin its status/result.

**Consequence:** One adapter may return `202` and suppress provider retry while another returns `503` and causes replay; the inbox may remain pending indefinitely or create unwanted handoffs.

**Required remediation:** Add a complete post-auth state/HTTP matrix for first claim, duplicate, conflict, pending-owned, pending-abandoned, tool unavailable, tool terminal error and completion failure. Define retry ownership, retry-after behavior and whether/when a handoff is durably created.

### I-6 — The implementation plan bypasses typed adapter boundaries

**Evidence:** The plan defines `ClientBookingService.reserve(principal: ClientPrincipal, ...)` and calls both services with the same principal (`docs/superpowers/plans/2026-08-14-mvp-client-conversation-001.md:268-323`). The existing shared `ClientPrincipal` carries no scope (`packages/application/src/ports.ts:281-294,340-348`), while booking deliberately requires a distinct resolver and exact scope (`../mvp-client-booking-001/docs/contracts/client-booking-principal-prerequisite.md:19-35`).

**Consequence:** TypeScript structural typing makes privilege separation documentary only; future callers can invoke booking with any active user-shaped object.

**Required remediation:** Introduce nominal/branded, capability-specific application principals or service methods whose construction is private to approved resolvers. Add import-boundary tests forbidding conversation/AI code from constructing or widening booking authority.

### I-7 — The AI/tool-schema release gate is treated as conditional despite an explicit behavior change

**Evidence:** `docs/contracts/client-conversation.md:179-185` changes `start_booking {expertId}` to a `choiceHandle` tool but says the three AI checks apply “if behavior changes.” The current application proposal is `start_booking` with `expertId` (`packages/application/src/ports.ts:26-33`). The runbook records all AI evidence absent (`docs/runbooks/client-conversation-activation.md:26`).

**Consequence:** Implementation could classify this as a typing/refactor change and proceed without incident regressions, distribution diff, or named human sign-off even though model routing and user-visible outcomes change.

**Required remediation:** Mark the change categorically as AI behavior/schema change. Make all three artifacts and named Product/Safety/Security sign-off prerequisites to implementation completion and any non-fixture proposal engine, with a deterministic fallback while absent.

### I-8 — The one-shot gate policy discourages diagnosis and cannot establish repeat/concurrency safety

**Evidence:** `docs/superpowers/plans/2026-08-14-mvp-client-conversation-001.md:327,431-439` and `docs/runbooks/client-conversation-activation.md:39-43` prohibit rerunning a focused suite after its first pass and make any gate failure terminal. At the same time replay/race correctness is a central acceptance criterion (`docs/spec/mvp-client-conversation-001.md:48-53,68-71`).

**Consequence:** A flaky first pass can be mistaken for durable evidence; a transient infrastructure failure permanently blocks correction; developers may avoid necessary randomized/concurrency repetition before the ceremonial invocation.

**Required remediation:** Separate unlimited pre-gate development tests (including repeated stress/property tests) from one immutable release-evidence invocation. A failed release invocation must preserve evidence, permit remediation and require a new reviewed SHA/new invocation identity—not an absolute ban on verification.

### I-9 — Tenant token is rate metadata, not an enforced binding invariant

**Evidence:** The authenticated event contains both tenant and subject tokens (`docs/contracts/client-conversation.md:8-16`), but the resolver accepts only provider and subject token (`docs/contracts/client-conversation.md:86-90`); the mapping stores only subject token/ciphertext/user (`packages/db/src/schema/identity.ts:101-113`). Tenant token is used only for rate limiting (`docs/contracts/client-conversation.md:110-114`).

**Consequence:** A buggy or malicious authenticated capability can pair a subject token with a different tenant token, shifting rate cost/quota across tenants while resolving the original subject.

**Required remediation:** Bind tenant token to the mapping lookup or remove it from trusted output and derive the rate key from the verified subject tuple. Add mismatched tenant/subject vectors that fail before resolution/effects.

## Minor

### M-1 — Token template types accept values the prose forbids

**Evidence:** TypeScript uses ``hmac-sha256:v${number}:${string}`` (`docs/contracts/client-conversation.md:11-14,89`) while prose requires positive decimal version and exactly 64 lowercase hex (`docs/contracts/client-conversation.md:60-61`).

**Consequence:** Callers can construct superficially typed negative, fractional, uppercase, short or non-hex values unless every boundary revalidates them.

**Required remediation:** Treat tokens as opaque branded values returned only by the strict parser; test hostile typed adapter results and never rely on template-literal typing as validation.

### M-2 — Editorial duplication obscures the actual authority contradiction

**Evidence:** The same generic “fresh principal” assertion is repeated across contract, canonical spec, architecture and design (`docs/contracts/client-conversation.md:94-100`; `docs/spec/mvp-client-conversation-001.md:37-41`; `docs/superpowers/architecture/architecture-mvp-client-conversation-001/ARCHITECTURE-SPINE.md:37-41`) without importing the booking slice's distinct scope prerequisite.

**Consequence:** Reviewers see repeated reassurance instead of the one cross-contract rule that determines whether booking dispatch is authorized.

**Required remediation:** After C-1 is resolved, make one authority document normative and have other artifacts reference its exact capability/scope rule and version rather than restating a weaker summary.

## Counts

- Critical: 5
- Important: 9
- Minor: 2
- Total: 16
