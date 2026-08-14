# MVP-CLIENT-BOOKING-001 Progress Ledger

| Date | State | Evidence / decision | Owner |
| --- | --- | --- | --- |
| 2026-08-14 | isolated | Clean worktree `codex/mvp-client-booking-001` created from exact `origin/main` `3db7ad1f3c76a58ebe6478863226c12e83ce306c` | Codex |
| 2026-08-14 | reconciled | Merged catalog spec/code and existing BookingService/repository/schema/outbox read at the exact base | Catalog / Booking / DB |
| 2026-08-14 | principal input | Approved docs read at `94ad64c922db1278fa78d3823a8959e5cfe90f95`, a rebase of `c2db85c` onto catalog base | Security / Platform |
| 2026-08-14 | specified | CBK-001–018, CBK-AC-01–12, HTTP/payload contracts, architecture, design, plan, traceability and activation boundary written | Engineering |
| 2026-08-14 | adversarial review | Good-spine review first found 1 Critical/2 Important; interface/security review found 5 Important/5 Minor | Independent reviewer |
| 2026-08-14 | review reconciled | Lock topology, local principal grammar, active erasure, byte framing, error/cancel projection, durable privacy resumption, provider non-dispatch and all Minor findings closed; closure verdict 0 Critical/0 Important | Independent reviewer / Engineering |
| 2026-08-14 | technology review reconciled | Claw adapter executability, PostgreSQL 16/17.5 evidence boundary and new-file classifications corrected; technology closure verdict 0 Critical/0 Important | Independent reviewer / Engineering |
| 2026-08-14 | documentation gate passed | Good-spine, interface/security and technology-reality review records all end with zero unresolved Critical/Important; activation approvals remain separate and absent | Independent reviewer |
| 2026-08-14 | implementation blocked | Principal is not merged; migration remains next actual after principal and no number is reserved | Platform / DB |
| 2026-08-14 | activation blocked | Product/Security/deployment approvals and live provider contracts are absent | Product / Security / Deployment |
| 2026-08-14 | safe posture | Docs only; no code, migration, tests, Claw, network, push, merge, Actions, provider, production or Obsidian operation | Codex |

## Expected rebase and implementation conflict surface

The base already contains catalog migration `0029`. Principal docs at `94ad64c` deliberately plan
the next actual post-catalog migration and overlap catalog principal seams, but are not merged.
Booking implementation MUST first rebase after principal and re-read the journal. Expected
semantic/textual conflicts are:

- `.env.example`, `packages/config/src/env.ts`, and config tests for session/catalog/booking flag
  preflight;
- `apps/api/src/app.ts`, `apps/api/src/server.ts`, principal resolver, catalog routes, new booking
  routes, and their raw-header/startup tests;
- `packages/application/src/ports.ts`, `packages/application/src/index.ts`,
  `booking-service.ts`, `client-catalog-service.ts`, and their tests;
- `apps/worker/src/client-catalog-outbox.ts`, worker composition/registry, catalog payload union,
  source reader, and compatibility tests;
- `packages/db/migrations/meta/_journal.json`, identity/catalog/booking/integration schema exports,
  DB package exports, privacy repository, client catalog repository, booking repository, migration
  parity and real-PG tests;
- observability metrics/logger and retention/erasure workers.

Principal's typed `resolved|denied|unavailable` outcome MUST win over the merged catalog's current
`ClientPrincipal | null` seam. Catalog v1 compatibility and worker joint gate MUST survive.
Booking adds a separate resolver capability and MUST NOT widen the principal's catalog-read scope.
New booking contract/design/spec/runbook files should otherwise merge cleanly. No conflicts are
expected with Claw, expert/principal worktrees, production files outside the named shared seams, or
the Obsidian mirror because none are touched.
