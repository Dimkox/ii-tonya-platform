# Expert Telegram Queries Traceability

Status: implementation verified in the constrained Claw test profile. The capability
and live Telegram remain disabled. Hosted CI, independent review, Draft PR publication,
staging, merge, and deployment are not authorized by this document.

Source design: `docs/superpowers/specs/2026-08-13-expert-telegram-queries-design.md`.

| Requirement | Implementation                                                                       | Focused verification                                                           | Mandatory CI                           | Telemetry                                     | Recovery / rollback                                    | Approval owner        |
| ----------- | ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------ | -------------------------------------- | --------------------------------------------- | ------------------------------------------------------ | --------------------- |
| EXP-BOT-001 | `telegram-webhook.ts`, `expert-command-processor.ts`                                 | private identity, exact command, dedupe, rate-limit, malformed/oversized tests | Main CI `pnpm verify`                  | bounded outcome only                          | keep query flag false                                  | Security + Operations |
| EXP-BOT-002 | `env.ts`, `app.ts`, disabled webhook branch                                          | config/app/webhook default-off and missing-capability tests                    | Main CI security/full regression       | startup error without payload facts           | revert composition; defaults remain false              | Operations            |
| EXP-BOT-003 | `expert-telegram-query-service.ts`, existing authorized schedule repository, adapter | seven-day application boundary and booked-only URL rendering tests             | Main CI full regression; Database Gate | no schedule facts in logs                     | disable query capability                               | Operations            |
| EXP-BOT-004 | query repository selector, `cv1` issuer, non-identifying keyboard                    | max-20 PostgreSQL case; callback size/expiry/domain tests                      | Main CI; Database Gate integration     | no choice/query results                       | disable query capability; outstanding tokens expire    | Security              |
| EXP-BOT-005 | atomic `consumeClientView`, consent SQL, minimal adapter view                        | real-PostgreSQL foreign/stale/revoked/replay/minimization tests                | Main CI; Database Gate integration     | content-free sensitive-read audit             | transaction rollback; disable query capability         | Security + Privacy    |
| EXP-BOT-006 | fixed-window aggregate SQL and application clock                                     | preceding-30-day/future-count and safe-overflow tests                          | Main CI; Database Gate integration     | bounded aggregate outcome only                | fail closed; disable query capability                  | Product + Operations  |
| EXP-BOT-007 | notification consume CTE and `audit_events` insert in one transaction                | content-free audit and injected audit-failure rollback on PostgreSQL           | Main CI; Database Gate integration     | SHA-256 metadata only                         | atomic rollback; investigate DB/audit fault            | Security + DB owner   |
| EXP-BOT-008 | bounded Telegram adapter, disabled request logging, separate `cv1` dispatch          | adapter transport/leakage and webhook isolation tests                          | Main CI security/full regression       | redacted URL and bounded transport error only | disable query capability; preserve `ct2` callback path | Security + Operations |

## Evidence and release boundary

Focused evidence is recorded in
`docs/test-evidence/claw/5d13cd80-expert-telegram-queries/verification.md`.
Registration in this matrix is not release approval. A named independent review, green
mandatory CI at the final commit, Draft PR publication, and explicit human approval are
still required. Live Telegram credentials, provider staging, merge, and deployment are
separate gates.
