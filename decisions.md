# Decisions

Pin the Claw test image by both a clean pushed source SHA and Docker image ID, while mounting the exact candidate source separately at gate time. This restored deterministic gate execution without turning the test container into production state.

Use authoritative source files and strip only known artifacts. This preserved the approved legal and landing copy while removing only chat prefaces, BOMs, and citation markers.

Treat approved analytics bootstrap code as a release-preserved asset and exercise it as executable HTML-shell behavior. This catches accidental removal or counter/config drift while allowing the rest of the landing to evolve independently.

- A2.1 settlement and maturity processing locks the shared financial prefix before sorted expert rows; this matches the architectural order and keeps reciprocal settlement/refund races deadlock-safe while retaining the legacy immediate-grant branch.

Use one canonical financial lock prefix everywhere: provider inbox when present, then separate order, payment, marker, maturity locks, UUID-sorted experts, expiry/grant/id grants, and id-sorted ledgers. Sequential statements make the order explicit instead of delegating it to the PostgreSQL join planner.

Release B1 keeps ingress and hybrid routing independently default-off and validates bot-scoped private identity before any durable effect; this preserves existing expert paths and makes provider activation reversible.

B2 retains a terminal Selarti request payload until either its proposal exists or its deadline passes; this preserves response convergence while still allowing bounded sensitive-data redaction.

B3 derives the live hard cap only from settled expert-residency cash and snapshots integer FX arithmetic with each reservation. This makes refunds and referral credits conservative automatically and prevents later policy/rate changes from rewriting historical cost authority.

Release C resolves reminders against the configured client bot, a numeric Telegram chat identity, current booking state, and the latest exact-policy consent in the same transaction that allocates the dialogue sequence. This prevents cross-bot delivery and makes consent withdrawal win before any outbox fact is created.

Lifecycle workers reclaim expired processing leases in a bounded `SKIP LOCKED` pass before claiming due work, dead-lettering exhausted attempts and rotating the fencing token. The logical `botKey` deliberately excludes `:` so a Telegram API token cannot be accidentally persisted as routing metadata.

Reservation expiry appends `waitlist.promote.v1` in the same PostgreSQL transaction as the expired state and other integration facts. This preserves newly available capacity across crashes while keeping FIFO promotion independently retryable and capacity-fenced.

Consume `waitlist.promote.v1`, FIFO promotion, protected booking-receipt creation, and terminal outbox transition in one PostgreSQL transaction. This closes the crash gap where a promoted reservation could exist without a client handle or the command could be acknowledged without the reservation.

Any correction after a migration has been committed uses a new forward migration plus an explicit old-to-new upgrade test. This preserves already-applied databases while still validating fresh installs through the complete journal.
## 2026-08-30 — Keep partner commerce separate from expert residency

Centers and organizers use a separate `Partner Commerce` bounded context while sharing identity, payment observations, outbox, and audit primitives. This preserves the fixed expert tariff/referral invariants and avoids a polymorphic migration for products with different qualification and event-quota semantics.

## 2026-08-30 — Bound the client trial and shorten future validity windows

New paid/admin message grants use 30 days and future coupon grants use 45 days, while historical rows remain unchanged. The `тест эксперт` campaign reserves two PostgreSQL-owned units per AI turn, caps each redemption at 100 visible units, and keeps deterministic qualification outside the trial ledger; this makes cost and replay behavior auditable without re-gating free V2 clients.
