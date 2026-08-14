# MVP-CLIENT-CONVERSATION-001 Progress

| Stage | Result | Evidence |
| --- | --- | --- |
| Exact base | complete | branch `codex/mvp-client-conversation-001` at `dad7e3a867e0ee4e262c5da28fd7a1f7c03449b9` |
| Principal/catalog inspection | complete | merged contracts/code and migration `0030_client_sessions.sql` inspected read-only |
| Booking input | complete | latest worktree commit `e5efdb23a8bd80119aa2a28a533949d8a399d99a` and implemented protected service/repository/migration `0031_client_booking_references.sql` inspected read-only; not merged into this base |
| Conversation/Selarti/inbox/outbox inspection | complete | existing direct external-ID handoff, disabled adapter, mappings, inbox and worker registry recorded |
| Canonical contract/spec/architecture/design/plan/runbook | complete | this branch's documentation set |
| Independent docs/security review | APPROVED FOR IMPLEMENTATION PLANNING: final 0/0/0; newer booking delta found 0C/1I/0M and closure returned 0/0/0; live remains NO-GO | `reviews/review-final.md`; `reviews/review-booking-delta.md`; `reviews/review-booking-delta-closure.md` under the architecture workspace |
| Code, migration, tests, Claw/PG | not run by instruction | docs-only task |
| Provider/network/Actions/push/merge/deploy/prod/Obsidian | not run by instruction | prohibited scope |
| Live activation | NO-GO | provider, identity, privacy, AI, Product, Security and deployment gates absent |

Conflict status after reconciliation: HTTP Bearer authority remains unchanged. Conversation
identity or a runtime claim is not booking authority. The protected booking transaction must lock
and freshly recheck the separate exact channel booking-write grant/fence; lifecycle and mutation
preserve the existing protected-choice advisory prelock before the shared lifecycle row order.
Booking implementation must merge/be reviewed before the one next-actual
migration and combined interface receives Booking/Security approval.
