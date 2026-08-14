# MVP-CLIENT-PRINCIPAL-001 Progress Ledger

| Date | State | Evidence / decision | Owner |
| --- | --- | --- | --- |
| 2026-08-14 | scoped | Documentation-only branch from exact `origin/main` `b6763dde890f472c5ad0fcf5a5dbd4ebba2e8423` | Codex |
| 2026-08-14 | reconciled | Catalog docs read at `10819c8ea46de13ea58e8be9000ac4b11546b9e8`; its principal/booking deferrals are preserved | Catalog / Platform |
| 2026-08-14 | specified | CPS-001–016 including CPS-005A/CPS-006A, session contract, catalog amendment, architecture spine and plan written | Engineering |
| 2026-08-14 | independently reviewed | Initial review found one Critical and eight Important gaps; reconciliation and two re-reviews closed them with zero Critical and zero Important remaining | Reviewer / Engineering |
| 2026-08-14 | implementation blocked | Rebase after catalog merge and allocate the next actual migration after catalog; no `0030` reservation | DB / Platform |
| 2026-08-14 | activation blocked | Security-approved proof source, named approver and evidence are absent | Security |
| 2026-08-14 | safe posture | `CLIENT_SESSION_ENABLED=false`; no tests, Claw, network, provider, push, merge, Actions or production operation run | Platform |

## Expected rebase conflict surface

The final observed clean local catalog branch head is `4b88a2bcf3adaa8918bc2c1a082b5460f022a8e8` and owns
migration `0029`; it is not merged into this documentation base. The session implementation must
start only after the catalog merge and re-read the resulting journal. Likely semantic or textual
conflicts are `.env.example`, `apps/api/src/app.ts`, `apps/api/src/server.ts`,
`apps/api/src/client-principal-resolver.ts`, `apps/api/src/routes/client-catalog.ts`,
`packages/application/src/index.ts`, `packages/application/src/ports.ts`,
`packages/config/src/env.ts`, `packages/db/migrations/meta/_journal.json`,
`packages/db/src/index.ts`, and their app/server/env/catalog boundary tests. The catalog's current
resolver collapses exceptions to unauthenticated authority, so the typed
`resolved|denied|unavailable` amendment requires deliberate reconciliation rather than a mechanical
merge. New session-only schema, repository, routes, contract docs, and activation runbook should
otherwise remain separable.

This ledger records preparation only. It is not Security approval, activation permission, release
evidence, or authorization to modify any provider or environment.
