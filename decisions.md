# Decisions

Use authoritative source files and strip only known artifacts. This preserved the approved legal and landing copy while removing only chat prefaces, BOMs, and citation markers.

Treat approved analytics bootstrap code as a release-preserved asset and exercise it as executable HTML-shell behavior. This catches accidental removal or counter/config drift while allowing the rest of the landing to evolve independently.

- A2.1 settlement and maturity processing locks the shared financial prefix before sorted expert rows; this matches the architectural order and keeps reciprocal settlement/refund races deadlock-safe while retaining the legacy immediate-grant branch.

Use one canonical financial lock prefix everywhere: provider inbox when present, then separate order, payment, marker, maturity locks, UUID-sorted experts, expiry/grant/id grants, and id-sorted ledgers. Sequential statements make the order explicit instead of delegating it to the PostgreSQL join planner.

Release B1 keeps ingress and hybrid routing independently default-off and validates bot-scoped private identity before any durable effect; this preserves existing expert paths and makes provider activation reversible.

B2 retains a terminal Selarti request payload until either its proposal exists or its deadline passes; this preserves response convergence while still allowing bounded sensitive-data redaction.

B3 derives the live hard cap only from settled expert-residency cash and snapshots integer FX arithmetic with each reservation. This makes refunds and referral credits conservative automatically and prevents later policy/rate changes from rewriting historical cost authority.
