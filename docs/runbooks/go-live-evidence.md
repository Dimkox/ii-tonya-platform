# Go-live evidence

Owner: Release owner. Independent reviewer: unassigned. Production deployment adapter: unavailable.

| Gate                                                              | Evidence URI/checksum                        | Date         | Owner            | Reviewer   | Status  |
| ----------------------------------------------------------------- | -------------------------------------------- | ------------ | ---------------- | ---------- | ------- |
| Frozen install, build, lint, typecheck, tests, production audit   | unavailable                                  | not executed | Engineering      | unassigned | pending |
| Exact local MVP acceptance chain                                  | unavailable                                  | not executed | Engineering      | unassigned | pending |
| Built API/worker image smoke, non-root, read-only, disabled flags | unavailable                                  | not executed | Platform         | unassigned | pending |
| HIGH/CRITICAL image scan by tested digest                         | unavailable                                  | not executed | Security         | unassigned | pending |
| Signed immutable image digests                                    | unavailable                                  | not executed | Release          | unassigned | blocked |
| PostgreSQL migration preflight and restore drill                  | unavailable                                  | not executed | Platform         | unassigned | blocked |
| Daily and release reconciliation                                  | unavailable                                  | not executed | Operations       | unassigned | pending |
| Retention/legal/minor-data approval                               | unavailable                                  | not executed | Privacy          | unassigned | blocked |
| Clinical safety directory and outage drill                        | unavailable                                  | not executed | Clinical safety  | unassigned | blocked |
| Provider-connected staging record                                 | `docs/runbooks/provider-staging-evidence.md` | not executed | Integrations     | unassigned | blocked |
| Rollback drill using prior immutable digest                       | unavailable                                  | not executed | Incident command | unassigned | blocked |
| Manual production environment approval                            | unavailable                                  | not executed | Release          | unassigned | blocked |

Live payments: disabled

Release status: NO-GO
