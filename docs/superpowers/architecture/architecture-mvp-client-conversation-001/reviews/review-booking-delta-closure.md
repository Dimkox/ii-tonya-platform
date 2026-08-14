# Booking Delta Closure Re-review — MVP-CLIENT-CONVERSATION-001

Verdict: **APPROVED / DELTA FINDING CLOSED**. The booking-delta advisory-lock mismatch is materially remediated. No unresolved Critical or Important finding remains in this focused delta. This remains documentation approval only; booking is unmerged here, conversation is unimplemented, and live activation remains NO-GO.

Scope: read-only comparison against booking HEAD `e5efdb23a8bd80119aa2a28a533949d8a399d99a`. Only documentation checks were run. No authored documents, code, tests, database, network, booking worktree or deployment state were modified.

## Prior Important finding

### I-1 — Exact booking advisory key mismatch: closed

The normative contract now freezes the implemented expressions:

- catalog: `hashtextextended(UTF8(userId + ":" + requestDigest),0)`;
- booking: `hashtextextended(UTF8("choice:" + choiceDigest),0)`.

It also requires the ordinary and conversation entry points to call the same repository-owned helper/transaction seam and explicitly forbids reconstructing or renaming either key (`docs/contracts/client-conversation.md:142-149`). This matches current booking code at sibling `packages/db/src/repositories/booking-repository.ts:735-769`, which passes the exact `choice:${command.choiceDigest}` text value to `hashtextextended(...,0)`, and current catalog code at sibling `packages/db/src/repositories/client-catalog-repository.ts:249-259`, which passes `${userId}:${input.requestDigest}` with seed `0`.

The closure is consistently projected into:

- AD-4's repository-helper and no-reconstruction invariant: `docs/superpowers/architecture/architecture-mvp-client-conversation-001/ARCHITECTURE-SPINE.md:51-55`;
- canonical CCV-005 and its blocking/deadlock acceptance test: `docs/spec/mvp-client-conversation-001.md:40-48,127-131`;
- implementation task requiring one shared helper in the same transaction: `docs/superpowers/plans/2026-08-14-mvp-client-conversation-001.md:338-358`;
- activation evidence requiring unchanged catalog/protected-choice prelocks and deadlock/race proof: `docs/runbooks/client-conversation-activation.md:20-25`.

The previous incompatible implementation—ordinary booking locking `choice:<digest>` while conversation locks `client-booking-choice:<user>:<digest>`—is now expressly non-conforming. A literal compliant implementation cannot occupy separate advisory namespaces because it must call the repository-owned seam rather than reproduce key bytes.

## Deadlock, TOCTOU, and cleanup result

No remaining incompatible lock implementation was found within the revised contract:

- Ordinary and conversation booking first contend on the identical repository-owned `choice:<choiceDigest>` advisory lock.
- Catalog ordinary/conversation paths analogously share the exact `userId:requestDigest` seed-0 lock.
- After the tool prelock, conversation takes `users -> mapping -> exact grant -> operation`, rechecks the lifecycle/fence/input facts, and then takes the unchanged remaining downstream locks.
- Lifecycle starts at `users`, never later requests a tool prelock, and skips missing ancestors instead of acquiring them after `operation`; therefore it creates no inverse tool-prelock edge (`docs/contracts/client-conversation.md:149-165`).
- The mandatory blocking probe proves identical ordinary/conversation advisory contention, and the mixed probes cover ordinary booking/catalog, catalog choice cleanup, conversation and lifecycle at every advisory/row seam (`docs/contracts/client-conversation.md:163-169`; `docs/superpowers/plans/2026-08-14-mvp-client-conversation-001.md:330-358`).

Thus catalog cleanup cannot cross an in-flight protected-choice prelock, while revoke/deactivate/erase retains the previously reviewed commit-winner property.

## Migration-next-actual result

Still closed. Booking owns implemented migration `0031_client_booking_references`; conversation records it as unmerged input and does not reserve `0032`. After booking merges, implementation must inspect the then-current journal and allocate only the next actual entry (`docs/superpowers/plans/2026-08-14-mvp-client-conversation-001.md:18-24,41-49,157-166`; `docs/contracts/client-conversation.md:455-460`). Any intervening migration therefore advances the conversation prefix instead of colliding.

## Counts

- Critical: 0
- Important: 0
- Minor: 0
- Total: 0
