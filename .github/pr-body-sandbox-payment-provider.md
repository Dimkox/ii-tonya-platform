## Summary

Adds a strictly test-only expert-residency sandbox payment runtime: isolated PostgreSQL tables, durable checkout/idempotency, exact two-admin settled/refunded transitions, canonical event verification, and delivery through the existing settlement/reversal authority. Production API and worker have no dependency on the sandbox applications.

Requirements: `SBX-RUN-001..005`, `SBX-PAY-001..006`, `SBX-DATA-001..007`, `SBX-ADM-001..005`, `SBX-EVT-001..005`, and `SBX-TST-001..010`.

## Evidence and status

- Traceability: `docs/spec/expert-residency-referrals-traceability.md`
- Runbook/rollback: `docs/runbooks/sandbox-payment-provider.md`
- Claw record: `docs/test-evidence/claw/sandbox-payment-provider-20260813/verification.md`
- Detailed task reports: `.superpowers/sdd/task-1-report.md` through `.superpowers/sdd/task-6-report.md`

Tasks 1–4 are approved. Task 5 is conditional. Task 6 code/config passed independent review, but the image build is blocked: offline pnpm hydration timed out after 480s and 240s under 1 CPU/1 GiB. Cleanup was zero. No sandbox image exists; `SBX-TST-009`, production packaged-image inventory/smoke, vulnerability scans, SBOM, signing, provenance, and final exact-head gates are unrun.

**Provider staging: BLOCKED. Production: NO-GO. Do not merge or deploy from this evidence state.**

## Reviewer checklist

- [ ] Exact PR head SHA matches all final evidence.
- [ ] Full Claw CI and Database Gate pass at that exact SHA.
- [ ] Sandbox lifecycle and one-time production packaged-image smoke pass with zero cleanup residue.
- [ ] Production image contains no sandbox package, route, migration, or verifier factory.
- [ ] Marker/mode/live-flag/empty-credential guards fail closed.
- [ ] Approval consumption and transition are atomic; replay and concurrent delivery are conflict-safe.
- [ ] Only existing settlement/reversal paths mutate financial state.
- [ ] No external call, real provider credential, raw payload, or approval secret is present.
- [ ] Both immutable images pass scan; SBOM, signing, and provenance are verified.
- [ ] Independent review has no unresolved Critical or Important finding.
- [ ] Named owners separately approve provider staging and production; neither approval is implied here.

