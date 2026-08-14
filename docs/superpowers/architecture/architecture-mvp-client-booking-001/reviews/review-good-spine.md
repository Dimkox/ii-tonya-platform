# Good-spine review — MVP Client Booking 001

## Verdict

**FAIL — one Critical and two Important findings.** The spine covers all four declared capabilities and gives the feature a credible default-off operational envelope, but it is not yet a safe build substrate: its central cross-lifecycle lock rule conflicts with the brownfield lock topology, its principal inheritance cannot be inspected from the cited source, and its erasure rule can strand an active owner's cancellation path.

Deterministic `lint_spine.py` result: **PASS**, 0 mechanical findings. This review is the semantic BMad good-spine gate.

## Findings

### Critical — AD-5 invents a lock order that does not ratify the existing booking, catalog-retention, or erasure paths

**Evidence:**

- The spine mandates `users -> catalog request -> choice -> sorted booking advisory keys -> slot/service/expert -> booking receipt -> reservation` for every mutating lifecycle path (`ARCHITECTURE-SPINE.md:84-91`).
- Existing reserve first acquires sorted advisory locks and only afterwards locks slot/service/expert rows (`packages/db/src/repositories/booking-repository.ts:738-777`).
- Existing transition likewise acquires reservation/slot/client/expert advisory locks first and then locks reservation/slot/expert/service rows (`packages/db/src/repositories/booking-repository.ts:935-978`).
- Existing catalog retention locks the outbox row before the catalog request (`packages/db/src/repositories/client-catalog-repository.ts:398-418`), a resource and order absent from AD-5's prefix.
- Existing erasure acquires a user-key advisory lock, then locks outbox rows, catalog requests, tombstones, and erasure-index rows (`packages/db/src/repositories/privacy-repository.ts:228-273`); it does not lock a `users` row in the order AD-5 states.

**Why this breaks the spine:** AD-5 claims one global race/deadlock invariant, yet a builder cannot extend the existing transaction and obey the stated sequence without changing multiple already-built repositories. Conversely, preserving the brownfield order violates the AD. The rule also mixes row-lock targets and advisory-lock namespaces without defining how they compare, so it does not actually prevent the deadlock divergence named in `Prevents`.

**Required disposition:** **Discuss/fix before implementation.** Derive one compatible global ordering from the actual SQL paths (including outbox, privacy erasure, retention, expiry, and transition), state exact advisory-key namespaces and row-lock ordering, and identify which existing methods must be amended atomically. If harmonizing those paths is deliberately out of this feature, move the cross-lifecycle claim to an explicit blocker rather than presenting it as adopted build guidance.

### Important — the principal invariants are inherited from a source that is absent in this worktree

**Evidence:**

- Frontmatter cites `docs/superpowers/architecture/architecture-mvp-client-principal-001/ARCHITECTURE-SPINE.md` at `principal@94ad64c` (`ARCHITECTURE-SPINE.md:13-16`), but that path does not exist in this worktree.
- The spine nevertheless treats Principal AD-1/4/5/6/7/8 as binding, including exact credential grammar and normalized failure semantics (`ARCHITECTURE-SPINE.md:40-42`, `48-55`).
- The available catalog authority contract explicitly says the repository has no client session issuer or resolver and leaves proof of `active` to a future issuer (`docs/contracts/client-catalog.md:14-21`).
- Current brownfield resolution collapses every resolver exception to `null` (`apps/api/src/client-principal-resolver.ts:22-30`), whereas the booking contract distinguishes denied authority (`401`) from resolver unavailability (`503`) (`docs/contracts/client-booking.md:74-84`).

**Why this breaks the spine:** the level below cannot inspect the supposed parent ADs, determine the promised "exact credential grammar," or know whether booking is extending a compatible principal boundary or creating a new incompatible one. The missing inherited artifact also hides a required brownfield change in error semantics.

**Required disposition:** **Fix before implementation.** Vendor or restore the immutable principal spine at the cited revision (or cite a repository-accessible canonical contract) and enumerate its exact inherited AD IDs. Make the booking-specific resolver/error adaptation explicit: malformed/denied credentials map to `401`, dependency unavailability maps to `503`, and no existing null-collapsing helper may erase that distinction.

### Important — AD-8 and AD-9 leave active-booking erasure behavior contradictory

**Evidence:**

- Rollback must keep owner DELETE and expiry available until active reservations resolve (`ARCHITECTURE-SPINE.md:110-117`).
- Subject erasure is required to remove public booking receipts/handles, without a timing condition or replacement recovery authority (`ARCHITECTURE-SPINE.md:119-126`).
- The booking contract makes the owner-scoped receipt/handle the only public route to cancellation (`docs/contracts/client-booking.md:54-67`).
- The contract says the protected receipt contains owner UUID and reservation FK (`docs/contracts/client-booking.md:91-100`), so immediate receipt deletion and retained active reservation are both plausible implementations.
- The activation runbook independently requires an approved cancellation/recovery path before disabling the route family (`docs/runbooks/client-booking-activation.md:43-52`).

**Why this breaks the spine:** two implementations can both claim compliance: one immediately deletes an active owner's receipt during erasure and strands self-service cancellation; another retains the receipt until terminal state and violates the unconditional erasure wording. This is a real lifecycle divergence, not implementation detail.

**Required disposition:** **Discuss/fix before implementation.** Decide the authoritative erasure policy for active reservations: terminalize/cancel before deleting the receipt, retain a minimally pseudonymized recovery capability until terminal state under an approved retention basis, or provide another explicit operator-owned recovery route. Bind erasure, rollback, export, receipt uniqueness, and audit retention to that same decision.

## Minor findings

### Minor — AD-2 omits the enforceable choice-expiry formula carried by the amendment

The amendment fixes choice expiry as the earliest of request expiry, observation plus 15 minutes, and slot start minus 24 hours (`docs/contracts/client-catalog-booking-amendment.md:47-50`), but AD-2 only says the mapping is stored atomically and v1 is unbookable (`ARCHITECTURE-SPINE.md:57-64`). Because choice validity is a central CAP-1/CAP-3 divergence point, either incorporate that formula into AD-2/AD-3 or explicitly state that the frozen amendment is the binding rule rather than leaving the AD independently incomplete.

## Checklist summary

- Real divergence points: **fail** on cross-lifecycle locking and active erasure.
- Enforceable ADs: **fail** for AD-5; **partial** for AD-1 and AD-9.
- Deferred holes: **fail** because the principal source and active-erasure policy are blockers but are not represented as open decisions.
- Brownfield fit: **fail** on lock topology and principal failure mapping.
- Inherited catalog/principal invariants: catalog inheritance is inspectable; principal inheritance is **not inspectable**.
- Capability coverage: **pass** for CAP-1 through CAP-4.
- Operational envelope: **pass with the erasure/rollback exception**; feature/provider defaults, activation approvals, evidence gate, and rollback sequencing are otherwise present.
