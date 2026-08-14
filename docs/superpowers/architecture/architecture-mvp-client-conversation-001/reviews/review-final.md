# Final Independent Adversarial Closure Review — MVP-CLIENT-CONVERSATION-001

Verdict: **APPROVED FOR IMPLEMENTATION PLANNING / LIVE ACTIVATION REMAINS NO-GO**.

The revised documentation materially closes every finding from `review-closure.md`. No unresolved Critical or Important documentation/interface/security finding remains. This is a docs closure verdict only: existing code still implements the old interface, booking is not merged here, the migration/tests/evidence do not exist, and every provider, privacy, AI, deployment and live-activation gate remains blocked.

Review base: `dad7e3a867e0ee4e262c5da28fd7a1f7c03449b9`. Scope was read-only except this report. Only documentation consistency checks were run; no code tests, database, Claw, provider, network or deployment action was executed.

## Prior closure findings

| Finding | Final result | Material closure evidence |
| --- | --- | --- |
| C-1 runtime claim unforgeability | Closed | The repository privately mints a native-private-field plus module-private `WeakSet` claim; every gateway verifies provenance and rejects plain, cast, cloned, spread, deserialized, cross-realm and cross-tool objects before DB/service access. The claim remains insufficient until an in-transaction grant/fence recheck: `docs/contracts/client-conversation.md:115-140`; plan tests and construction boundary: `docs/superpowers/plans/2026-08-14-mvp-client-conversation-001.md:174-206,313-328`. |
| C-2 revoke/erase TOCTOU | Closed | Catalog/booking expose conversation-specific transactional entry points. Mutation and lifecycle operations use the single `users -> mapping -> grant -> operation -> downstream` order and recheck active binding, exact grant, fence, tool and frozen input before mutation. Commit-winner semantics and both race orders are explicit: `docs/contracts/client-conversation.md:142-158`; architecture invariant: `docs/superpowers/architecture/architecture-mvp-client-conversation-001/ARCHITECTURE-SPINE.md:51-55`; implementation/race tasks: `docs/superpowers/plans/2026-08-14-mvp-client-conversation-001.md:298-349`. |
| I-1 exact AEAD/key lifecycle | Closed | AES-256-GCM v1, 96-bit CSPRNG nonce, 128-bit tag, unique `(key_id,nonce)`, exact LP-framed plaintext/AAD, envelope storage, failure normalization, injected secret-store boundary and active/decrypt-only/retired/compromised lifecycle are normative: `docs/contracts/client-conversation.md:238-266`; hostile vectors are required at `docs/superpowers/plans/2026-08-14-mvp-client-conversation-001.md:277-289`. |
| I-2 fenced `privacy_expired` cleanup | Closed | Expiry caps every lease/timeout, cleanup steals only expired leases, increments the fence, invalidates both claim tuples, terminalizes to `privacy_expired/payload_expired`, clears the whole envelope and creates one unique operator case plus deletion receipt atomically. Active/stale owner behavior and legal-hold exclusion are explicit: `docs/contracts/client-conversation.md:331-339`; DDL uniqueness: `docs/superpowers/plans/2026-08-14-mvp-client-conversation-001.md:148-154`; race task: `docs/superpowers/plans/2026-08-14-mvp-client-conversation-001.md:330-349`. |
| I-3 cross-process readiness | Closed | API and worker preflight claims are correctly separated. Running dispatch/cleanup jobs publish DB-time, exact-contract/exact-build leases; route exposure and every freeze require both compatible leases, continuous loss withdraws readiness, and rollout is worker-first: `docs/contracts/client-conversation.md:427-444`; AD-6: `docs/superpowers/architecture/architecture-mvp-client-conversation-001/ARCHITECTURE-SPINE.md:63-67`; activation evidence: `docs/runbooks/client-conversation-activation.md:22-25,47-51`. |
| I-4 normative DDL truth tables | Closed | Provider token/version, tool/scope pairing, status, dispatch/reconciliation claims, lease/expiry, crypto envelope, result/terminal reason, attempts, nonce uniqueness, runtime leases and unique cases are explicit database predicates rather than application conventions: `docs/contracts/client-conversation.md:268-296`; executable DDL shape and hostile SQL mandate: `docs/superpowers/plans/2026-08-14-mvp-client-conversation-001.md:52-166`. |
| M-1 dormant topic wording | Closed | The contract and canonical spec now distinguish existing persisted `selarti.send`/`client.no_package` completion rows from worker registry membership, preserve existing `catalog.show`, and prohibit any new claimable/provider handler: `docs/contracts/client-conversation.md:382-388`; `docs/spec/mvp-client-conversation-001.md:77-83`; AD-5 at `docs/superpowers/architecture/architecture-mvp-client-conversation-001/ARCHITECTURE-SPINE.md:57-61`. |

## Good-spine result

The architecture spine now has a lean, enforceable chain of invariants:

1. Ordered authenticated fixture evidence enters through one boundary.
2. Message completion freezes exactly one encrypted operation before mutation.
3. A fenced local runner produces an unforgeable, tool-bound runtime claim.
4. The matching downstream transaction rechecks claim, lifecycle and exact grant under one global lock order.
5. Unknown outcomes replay only the frozen downstream idempotency identity.
6. Runtime leases gate cross-process exposure/freeze, while expiry independently fences and destroys ciphertext.

These rules are projected consistently into the canonical spec, BMad SPEC, architecture, design, plan, traceability and runbook. The spine distinguishes build evidence from activation authority and does not treat a future green test as provider, privacy, AI or deployment approval.

## Repository and booking reality

- Current repository reality remains intentionally incompatible with v2 until implementation: `packages/application/src/ports.ts:26-30,56-68` still carries `expertId` and direct `userId`; `packages/application/src/conversation-service.ts:654-737` still performs the old proposal/completion flow; `apps/api/src/routes/selarti-webhook.ts:43-69` still uses the old Selarti edge; and `packages/db/src/schema/integration.ts:37-53` lacks v2 operation state. The progress file truthfully reports no implementation/test evidence at `docs/spec/mvp-client-conversation-001-progress.md:3-13`.
- The sibling booking contract currently owns its ordinary Bearer authority and booking transaction. The revised plan does not cast into that path: it explicitly requires a new conversation-specific protected entry point and changes to booking service/ports/PostgreSQL repositories (`docs/superpowers/plans/2026-08-14-mvp-client-conversation-001.md:307-309,338-349`) after booking is merged/reviewed. Booking/Security approval remains a gate (`docs/runbooks/client-conversation-activation.md:20-25`).
- Node/Fastify raw header occurrences, PostgreSQL row/advisory locks and `SKIP LOCKED`, Drizzle constraints, Vitest and separate API/worker runtimes match the existing repository technology declared at `docs/superpowers/architecture/architecture-mvp-client-conversation-001/ARCHITECTURE-SPINE.md:109-120`.

## Incompatible-implementation attempts

No remaining incompatible lower-level implementation was found that still satisfies the normative documents:

- A forged structural/cast claim fails private-field and `WeakSet` provenance before access.
- A genuine but stale/cross-tool claim fails the locked operation fence/tool/scope/input recheck.
- Revocation, deactivation or erasure racing mutation is serialized by the shared lock order; the first commit wins.
- Constant/reused nonce or transplanted ciphertext fails nonce uniqueness or exact AAD/tag verification.
- Cleanup racing an owner caps the lease at expiry, increments the fence and rejects the stale write.
- API-only deployment cannot expose/freeze tools without compatible exact-build dispatch and cleanup leases.
- Cross-scope, unfenced, malformed-crypto or inconsistent terminal rows violate normative database checks.
- Existing dormant completion rows remain unclaimable because registry topics and allowed dormant row topics are tested separately.

An implementation that omits any of these mechanisms is non-conforming and must fail the specified hostile runtime, real-PostgreSQL race, hostile SQL, registry or readiness checks.

## Counts

- Critical: 0
- Important: 0
- Minor: 0
- Total: 0
