# Go-live evidence

Owner: Release owner. Independent reviewer: unassigned. Production deployment adapter: implemented but target unconfigured.

| Gate                                                            | Evidence URI/checksum                                                          | Date         | Owner            | Reviewer           | Status               |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------ | ------------ | ---------------- | ------------------ | -------------------- |
| Frozen install, build, lint, typecheck, tests, production audit | `docs/test-evidence/claw/87e49af2822dfcea96084dafc2708b29c08615a7/ci.md`       | 2026-08-13   | Engineering      | unassigned         | PASS at recorded SHA |
| Direct Claw Database Gate                                       | `docs/test-evidence/claw/a0ee5f6f5b347c64ab185e5ed871ce46381061c9/database.md` | 2026-08-13   | Platform         | unassigned         | PASS at recorded SHA |
| Native API/worker bundle, SBOM, provenance, import smoke        | `docs/test-evidence/claw/887c462065bc8d4f480b5474135638a5bc063b8c/release.md`  | 2026-08-13   | Platform         | unassigned         | PASS at recorded SHA |
| Native API readiness and worker heartbeat against one Claw DB   | same release record                                                            | 2026-08-13   | Platform         | unassigned         | PASS at recorded SHA |
| Signed immutable native bundle                                  | unavailable                                                                    | not executed | Release          | unassigned         | blocked              |
| PostgreSQL migration preflight and restore drill                | unavailable                                                                    | not executed | Platform         | unassigned         | blocked              |
| Daily and release reconciliation                                | unavailable                                                                    | not executed | Operations       | unassigned         | pending              |
| Retention/legal/minor-data approval                             | unavailable                                                                    | not executed | Privacy          | unassigned         | blocked              |
| Clinical safety directory and outage drill                      | unavailable                                                                    | not executed | Clinical safety  | unassigned         | blocked              |
| Provider-connected staging record                               | `docs/runbooks/provider-staging-evidence.md`                                   | not executed | Integrations     | unassigned         | blocked              |
| Rollback drill using prior immutable release directory          | unavailable                                                                    | not executed | Incident command | unassigned         | blocked              |
| Manual production environment approval                          | unavailable                                                                    | not executed | Release          | unassigned         | blocked              |
| Sandbox payment container lifecycle (`SBX-TST-009`)             | `docs/test-evidence/claw/sandbox-payment-provider-20260813/verification.md`    | not executed | Platform         | independent review | blocked: no image    |
| Sandbox/native-production closure inventory and security scan   | same record                                                                    | not executed | Security/Release | unassigned         | blocked              |

Live payments: disabled

Release status: NO-GO

The sandbox payment implementation does not change this decision. Its code review is not provider-connected staging evidence and its packaged-runtime gates remain incomplete. Production has no application image: its release candidate is the signed native API/worker bundle described in `docs/runbooks/native-production-deployment.md`.
