# MVP-CLIENT-PRINCIPAL-001 Progress Ledger

| Date | State | Evidence / decision | Owner |
| --- | --- | --- | --- |
| 2026-08-14 | scoped | Documentation-only branch from exact `origin/main` `b6763dde890f472c5ad0fcf5a5dbd4ebba2e8423` | Codex |
| 2026-08-14 | reconciled | Catalog docs read at `10819c8ea46de13ea58e8be9000ac4b11546b9e8`; its principal/booking deferrals are preserved | Catalog / Platform |
| 2026-08-14 | specified | CPS-001–016 including CPS-005A/CPS-006A, session contract, catalog amendment, architecture spine and plan written | Engineering |
| 2026-08-14 | independently reviewed | Initial review found one Critical and eight Important gaps; reconciliation and two re-reviews closed them with zero Critical and zero Important remaining | Reviewer / Engineering |
| 2026-08-14 | unblocked | Rebased onto exact merged catalog base `3db7ad1`; catalog migration `0029` remained authoritative | DB / Platform |
| 2026-08-14 | activation blocked | Security-approved proof source, named approver and evidence are absent | Security |
| 2026-08-14 | safe posture | `CLIENT_SESSION_ENABLED=false`; no tests, Claw, network, provider, push, merge, Actions or production operation run | Platform |
| 2026-08-14 | migration allocated | Rebased implementation base contains catalog migration `0029`; the next actual journal entry is `0030_client_sessions` | DB / Platform |
| 2026-08-14 | implemented | Opaque session token/verifier/service boundaries and strict request/auth parsing completed with focused 26/26 | Application / API |
| 2026-08-14 | implemented | `0030_client_sessions`, replay receipts, database-clock issuance, fresh resolution, revoke and cleanup completed; parity 11/11 and real-PostgreSQL 12/12 | Database |
| 2026-08-14 | implemented | Default-off preflight/composition, session-to-owned-catalog authorization, privacy erasure, retention, safe telemetry and zero unrelated side effects completed | Platform / Privacy |
| 2026-08-14 | remediated | Initial 0C/5I/1M and closure 0C/2I/0M adversarial findings received distinct RED coverage and focused GREEN fixes | Engineering |
| 2026-08-14 | verified | Final independent and nested reviews both returned 0 Critical / 0 Important / 0 Minor; the new one-time Claw/PostgreSQL gate passed 1/1 at `5772762`; retained source restored, test DB/session counts zero, container left Up | Engineering + independent reviewers |

## Observed rebase and implementation boundary

The documentation commit was rebased after catalog merge onto exact `origin/main`
`3db7ad1f3c76a58ebe6478863226c12e83ce306c`. Catalog code and migration `0029`
remained authoritative; the principal amendments were reconciled deliberately and
the session schema was allocated as the next actual migration, `0030_client_sessions`.
Verification evidence is recorded in
`docs/test-evidence/claw/5772762-mvp-client-principal-001/verification.md`.

Implementation and verification do not constitute Security proof-source approval,
activation permission, deployment authorization, or permission to modify a provider
or environment. Live activation remains `NO-GO` and the feature remains false by
default.
