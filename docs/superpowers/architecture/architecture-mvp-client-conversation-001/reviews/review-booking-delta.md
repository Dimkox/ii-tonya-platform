# Booking Delta Re-review — MVP-CLIENT-CONVERSATION-001

Verdict: **BLOCKED**. The required zero Critical/Important threshold is not met because the revised conversation documents freeze a booking advisory-lock key that does not match the implemented booking repository at `e5efdb23a8bd80119aa2a28a533949d8a399d99a`.

Scope: read-only comparison of the current conversation documents with sibling booking HEAD `e5efdb23a8bd80119aa2a28a533949d8a399d99a`, its protected service/repository and migration journal. No authored document, booking file or other worktree was modified. No code test, database, network or deployment command was run. The booking worktree had unrelated uncommitted API files; the reviewed committed protected booking service/repository and migration evidence were read only.

## Critical

None.

## Important

### I-1 — Documented booking advisory key does not match the implemented protected-booking prelock

**Conversation evidence:** The v2 contract says booking first takes its existing ``client-booking-choice:userId:choiceDigest`` advisory lock and requires deadlock tests without changing existing lock-key bytes (`docs/contracts/client-conversation.md:142-165`). AD-4 repeats that the service keeps its implemented protected-choice prelock (`docs/superpowers/architecture/architecture-mvp-client-conversation-001/ARCHITECTURE-SPINE.md:51-55`). The plan specifically instructs implementation to preserve ``client-booking-choice:userId:choiceDigest`` before taking `users -> mapping -> grant -> operation` (`docs/superpowers/plans/2026-08-14-mvp-client-conversation-001.md:338-355`).

**Actual booking evidence:** At booking HEAD `e5efdb23a8bd80119aa2a28a533949d8a399d99a`, `PostgresBookingRepository.reserveProtectedChoice` opens the serializable transaction and takes:

```text
pg_advisory_xact_lock(hashtextextended(`choice:${command.choiceDigest}`, 0))
```

at sibling `packages/db/src/repositories/booking-repository.ts:735-769`. The key contains neither the documented `client-booking-choice` domain nor `userId`. The protected service derives `choiceDigest` and delegates to that repository at sibling `packages/application/src/client-booking-service.ts:147-180`. The booking contract describes a choice-digest advisory lock without freezing the contradictory key bytes at sibling `docs/contracts/client-booking.md:107-117`.

**Incompatible lower-level implementation:** A conversation-specific booking entry follows the conversation plan literally and locks `client-booking-choice:<userId>:<choiceDigest>`, while the ordinary protected booking path continues to lock `choice:<choiceDigest>`. Both implementations can claim they use a protected-choice prelock, but they occupy disjoint PostgreSQL advisory namespaces.

**Consequence:** Ordinary and conversation booking calls no longer serialize at the intended first lock. More importantly, the implemented choice-digest lock coordinates booking with catalog choice cleanup; a separate conversation key permits cleanup and conversation booking to cross the seam without the established prelock. Remaining row/advisory locks may still prevent some duplicate/capacity effects, but the no-deadlock/TOCTOU proof in AD-4 is invalid because it reasons about a lock edge that the current repository does not take.

**Required remediation:** Re-read the merged booking implementation and freeze the exact existing key expression and byte domain in the conversation contract/AD-4/plan, then make the new conversation entry call the same shared lock-key helper or the same repository transaction seam. Do not independently reconstruct the key. Add a repository-reality test that ordinary and conversation protected booking block on the identical advisory key, plus the documented mixed ordinary/conversation/catalog-cleanup/lifecycle deadlock probes. If Booking intentionally changes the key to a user-bound/domain-separated v2 form, that must be one coordinated booking migration/change with all ordinary, cleanup and conversation callers switched atomically and re-reviewed; it cannot be silently introduced only in conversation.

## Lock topology and TOCTOU assessment

Apart from I-1, the revised graph is directionally sound:

- Catalog's implemented request prelock is `hashtextextended(userId + ':' + requestDigest, 0)` at sibling `packages/db/src/repositories/client-catalog-repository.ts:249-259`, matching the conversation description of the existing `userId:requestDigest` prelock.
- Protected booking takes its advisory prelock before choice/user row locks and reservation locks at sibling `packages/db/src/repositories/booking-repository.ts:753-845`.
- Conversation then plans `users -> mapping -> exact grant -> operation -> remaining downstream locks`, while lifecycle paths start at `users` and never acquire a tool prelock (`docs/contracts/client-conversation.md:145-165`). Because a previously claimed operation does not retain a PostgreSQL row lock across transactions, lifecycle can finish through the operation row without waiting for the tool prelock; no inverse prelock edge is introduced by the written lifecycle path.
- The exact grant/fence/binding recheck remains inside the downstream mutation transaction, so the earlier revoke/erase commit-winner property remains intact once every caller uses the correct shared prelock.

## Migration-next-actual assessment

Closed. Booking HEAD's journal ends at `0031_client_booking_references` (sibling `packages/db/migrations/meta/_journal.json`, entry `idx:31`), and the booking progress file records that allocation at sibling `docs/spec/mvp-client-booking-001-progress.md:16-18`. Conversation does not reserve `0032`: it requires booking to merge, then re-reads the actual journal and allocates only the next actual prefix (`docs/spec/mvp-client-conversation-001.md:107-109`; `docs/superpowers/plans/2026-08-14-mvp-client-conversation-001.md:18-24,41-49,157-166`; `docs/contracts/client-conversation.md:451-456`). This remains safe if another migration lands before conversation.

## Counts

- Critical: 0
- Important: 1
- Minor: 0
- Total: 1
