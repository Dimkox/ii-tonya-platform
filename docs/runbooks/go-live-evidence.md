# Go-live evidence

Owner: Release owner. Independent reviewer: unassigned. Production deployment adapter: implemented; host SSH configured 2026-09-17 (live deploy/rollback not run).

| Gate                                                               | Evidence URI/checksum                                                          | Date         | Owner            | Reviewer           | Status               |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------------ | ------------ | ---------------- | ------------------ | -------------------- |
| Frozen install, build, lint, typecheck, tests, production audit    | `docs/test-evidence/claw/cb07bd1821d8106b0b0088b17bcf305662a1b792/ci.md`       | 2026-09-18   | Engineering      | unassigned         | FAIL gitleaks at `cb07bd18`; other CI steps PASS |
| Direct Claw Database Gate                                          | `docs/test-evidence/claw/cb07bd1821d8106b0b0088b17bcf305662a1b792/database.md` | 2026-09-18   | Platform         | unassigned         | PASS at `cb07bd18` |
| Native API/worker bundle, SBOM, provenance, import smoke           | `docs/test-evidence/claw/cb07bd1821d8106b0b0088b17bcf305662a1b792/release.md`  | 2026-09-17   | Platform         | unassigned         | PASS at `cb07bd18` |
| Native API readiness and worker heartbeat against one Claw DB      | `docs/test-evidence/releases/cb07bd1821d8106b0b0088b17bcf305662a1b792/native-smoke.md` | 2026-09-18   | Platform         | unassigned         | PASS at `cb07bd18` |
| Signed immutable native bundle                                     | `docs/test-evidence/releases/cb07bd1821d8106b0b0088b17bcf305662a1b792/artifacts.md` | 2026-09-17   | Platform         | unassigned         | PASS for `origin/main` `cb07bd18` (not deployed) |
| PostgreSQL migration preflight and restore drill                   | unavailable                                                                    | not executed | Platform         | unassigned         | blocked              |
| Daily and release reconciliation                                   | unavailable                                                                    | not executed | Operations       | unassigned         | pending              |
| Retention/legal/minor-data approval                                | `docs/legal/owner-update-legal-review.md`                                      | 2026-09-17   | Privacy/legal-agent | owner           | PASS (152-FZ/156-FZ texts; owner attested RKN art.22 notice; registry number not supplied) |
| Clinical safety directory and outage drill                         | unavailable                                                                    | not executed | Clinical safety  | unassigned         | blocked              |
| Provider-connected staging record                                  | `docs/runbooks/provider-staging-evidence.md`                                   | not executed | Integrations     | unassigned         | blocked              |
| YooKassa test-shop, legal/fiscal, registry and activation approval | `docs/runbooks/yookassa-provider.md`                                           | not executed | Payments/Legal   | unassigned         | blocked              |
| Production host identity and BatchMode deploy SSH                  | `docs/test-evidence/production/host-identity-2026-09-17.md`                    | 2026-09-17   | Platform         | unassigned         | PASS (ED25519 pin; `ii_tonya` key; live rollback not run) |
| Rollback drill using prior immutable release directory             | `docs/test-evidence/rollback-drill-2026-09-17.md`                              | 2026-09-17   | Incident command | unassigned         | PASS rehearsal (exact adapter body). Host SSH now configured; live rollback not executed |
| Manual production environment approval                             | unavailable                                                                    | not executed | Release          | unassigned         | blocked              |
| Sandbox payment container lifecycle (`SBX-TST-009`)                | `docs/test-evidence/claw/sandbox-payment-provider-20260813/verification.md`    | not executed | Platform         | independent review | blocked: no image    |
| Sandbox/native-production closure inventory and security scan      | same record                                                                    | not executed | Security/Release | unassigned         | blocked              |

Live payments: disabled

YooKassa status: BLOCKED. Direct Claw checks are repository gates, not provider evidence;
GitHub Actions are not used. Hoster maintenance defers production deployment, and empty
credential placeholders must remain empty until the separate activation approval.

Release status: NO-GO

The sandbox payment implementation does not change this decision. Its code review is not provider-connected staging evidence and its packaged-runtime gates remain incomplete. Production has no application image: its release candidate is the signed native API/worker bundle described in `docs/runbooks/native-production-deployment.md`.
