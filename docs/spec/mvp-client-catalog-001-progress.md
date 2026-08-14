# MVP-CLIENT-CATALOG-001 Progress Ledger

| Date | State | Evidence / decision | Owner |
| --- | --- | --- | --- |
| 2026-08-14 | scoped | Frozen as documentation-only from `origin/main` `0bfb6efc4b2145dfc5f4ba4763fa6264f422f842` | Codex |
| 2026-08-14 | blocked | `MVP-WORKER-OUTBOX-001` must merge before any implementation | Platform |
| 2026-08-14 | blocked | Client active-session issuer/resolver is absent | Security |
| 2026-08-14 | blocked | Selarti and Planerka contracts are `NO-GO` in `docs/contracts/provider-activation.md` | Integrations |
| 2026-08-14 | pending | Implement, independently review, and run one focused Claw gate after prerequisites | Engineering |
| 2026-08-14 | unblocked | `MVP-WORKER-OUTBOX-001` is present in exact `main` base `b6763dd`; isolated branch `codex/mvp-client-catalog-001` was created from that base | Platform |
| 2026-08-14 | implemented | Task 1 durable schema/repository: `21e2cca`; focused repository 2/2 and real PostgreSQL 3/3 | Database |
| 2026-08-14 | implemented | Task 2 authority/application boundary: `85e7809`; focused 21/21 | Application |
| 2026-08-14 | implemented | Task 3 HTTP/config/default-off composition: `76b4872`; server 10/10 and route/config 33/33 | API |
| 2026-08-14 | implemented | Task 4 strict composite outbox/public reader: `4b88a2b`; focused worker/allowlist/real-PostgreSQL 23/23 and affected builds passed | Worker |
| 2026-08-14 | review-pending | Task 5 retention, privacy export/erasure races and two-label metrics are focused GREEN 9/9 with affected builds passed; commit/review/final focused gate remain | Privacy |
| 2026-08-14 | review-pending | First adversarial review found 1 Critical and 7 Important lifecycle/privacy/composition issues; remediation is focused GREEN 11/11 (including 5 real PostgreSQL) and all six affected builds pass; closure review remains | Engineering + independent reviewer |
| 2026-08-14 | review-pending | Closure review found 3 Important gaps in retention-first erasure, GET auth precedence and cleanup fairness; a separate remediation gate is GREEN 5/5 (including 2 real PostgreSQL) and DB/API/app-worker builds pass; final closure review remains | Engineering + independent reviewer |
| 2026-08-14 | review-pending | Final closure pass found 1 Important missing-outbox tombstone lifecycle gap; separate real-PostgreSQL remediation is GREEN 1/1 and DB/app-worker builds pass; reviewer confirmation remains | Engineering + independent reviewer |

This ledger is not activation approval. The only current safe runtime posture is both
catalog-related flags false.
