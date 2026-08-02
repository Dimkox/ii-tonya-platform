# Task 17 implementer report

## TDD evidence

- RED command: `pnpm exec vitest run packages/application/src/feedback-service.test.ts packages/application/src/admin-service.test.ts apps/api/src/routes/admin.test.ts tests/integration/admin-ledger.test.ts`
- RED result: expected failures because `feedback-service.ts` and `admin-service.ts` did not exist.
- GREEN: feedback duplicate/escalation, bounded redacted payload handling, scoped recent-MFA authorization, approval binding checks, package grants and append-only revocation are covered by 18 focused unit assertions.

## Implementation

- Added source-event feedback dedupe fields and a deterministic `negative-v1` explicit-negative policy. Stored text is capped at 2,000 characters; audit/outbox contain only feedback ID, content hash, and policy version.
- Added scoped authorization and immutable audit facts. MFA is accepted only when not in the future and no older than 15 minutes.
- Added normal package sizes (500/1000/1500/2000) with exactly 60-day expiry and separate 100-unit `package.intro_grant` with no expiry.
- Added PostgreSQL `executeApprovedGrant`: one transaction conditionally consumes the bound approval then appends package metadata, grant fact, and allow audit. A replay/invalid approval writes a deny audit only.
- Added additive Drizzle migrations `0013`/`0014`, including approval session/payload/role/MFA binding and feedback source-event uniqueness/status fields. Existing ledger and audit append-only triggers are unchanged.
- Added behavioural PostgreSQL integration coverage and wired it into the DB gate.

## Verification

- Focused unit run: 18 passed.
- `pnpm typecheck`: passed.
- `pnpm lint`: passed.
- `pnpm build`: passed.
- `pnpm exec drizzle-kit check --config packages/db/drizzle.config.ts`: passed.
- `git diff --check`: passed.
- PostgreSQL integration attempt: blocked before tests by Testcontainers error `Could not find a working container runtime strategy`; no test was silently skipped or marked passing.

## Boundary

The local workstation has no Docker/Testcontainers runtime. CI DB gate must execute `tests/integration/admin-ledger.test.ts` against PostgreSQL to validate the new SQL transaction path.

## Required self-review gaps (BLOCKED)

- `createFeedbackService` currently composes separate feedback/outbox/audit ports. There is no production PostgreSQL workflow that inserts source-event feedback, sets escalation status, enqueues the free effect, and appends audit in one database transaction. This does not meet the required feedback atomicity guarantee.
- `apps/api/src/routes/admin.ts` currently supplies authorization primitives rather than registered HTTP routes which resolve principals and MFA exclusively from platform sessions. Consequently the request-body actor/approver trust boundary is not yet demonstrably wired.
- `AdminApprovalRepository` is specified and the PostgreSQL approved-grant consume query is implemented, but production request/approve persistence methods and stored assignment checks for safety/feedback reads are not wired end-to-end.
- The service exposes the named lifecycle, expert, service, integration-error, and alert operations, but the concrete PostgreSQL transaction workflow currently covers only package grant. Revoke and the other high-risk operations still need equivalent approval-consume/domain/audit transaction commands.

Because these are Task 17 requirements, this implementation is reported as `BLOCKED`, not complete.
