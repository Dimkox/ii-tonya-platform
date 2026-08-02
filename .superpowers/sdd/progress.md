# Subagent-Driven Development Progress

## Project

- Branch: `codex/task17-production-mvp`
- Design: `docs/superpowers/specs/2026-07-28-ii-tonya-platform-design.md`
- Requirements: `docs/spec/normalized-requirements.md`
- Threat model: `docs/security/threat-model-and-go-live-gates.md`

## Task ledger

| Task | Status | Implementer | Spec review | Quality review | Commit |
|---|---|---|---|---|---|
| 1. Workspace bootstrap | completed | complete | PASS | PASS after lint fix | `3122fa4`, `4fc6b37` |
| 2. Contracts and safe configuration | completed | complete | PASS | PASS after two validation fixes | `94e0713`, `c807b96`, `070c387` |
| 3. Reservation state machine | completed | complete | PASS | PASS after input/range fixes | `0cb1645`, `c6fdf78`, `dee7835` |
| 4. Message charging | completed | complete | PASS | PASS | `1d30c0c` |
| 5. Consent and safety | completed | complete | PASS | PASS after fail-closed fixes | `d0ab875`, `8413798`, `da98875` |
| 6. PostgreSQL schema and testkit | completed | complete | PASS | PASS after static fixes and GitHub PostgreSQL gate | `6b2f994`, `b182efb`, `e2e1a2d`; run `30439533458` |
| 7. Inbox and message concurrency | completed | complete | PASS | PASS after static fixes and 20x GitHub PostgreSQL gate | `bc12b70`, `bd14a42`, `78f4dd7`, `ddbb55b`, `06d55fa`; run `30444844801` |
| 8. Booking concurrency and callbacks | completed | complete | PASS | PASS after adversarial fixes and 20x GitHub PostgreSQL gate | `82add07`, `a882d0c`, `8c906f1`, `42e0afa`, `d3506f8`; run `30449363799` |
| 9. Transactional outbox | completed | complete | PASS | PASS after fencing fixes and 20x GitHub PostgreSQL gate | `0d3d351`, `2f9ebb3`, `86b0eb1`; run `30454609406` |
| 10. Selarti port | completed | complete | PASS | PASS after adversarial contract hardening | `55a72a9`, `57338cc`, `b796a49` |
| 11. Telegram expert port | completed | complete | PASS | PASS after authority, SQL typing, typed-conflict, proxy-containment, and deterministic teardown fixes; 20x GitHub PostgreSQL gate | `ecf9597`, `07fc7c9`, `a1b3fbf`, `1b80776`, `8323c8a`, `bd8a8f7`, `063e643`, `a16665f`, `48f6e6f`, `a098875`; run `30477479563` |
| 12. Planerka port | completed | complete | PASS | PASS after bounded-input, duplicate-poisoning, PostgreSQL-limit, control-character, and deterministic-sort fixes | `d75745c`, `722c25d` |
| 13. Disabled payment port | completed | complete | PASS | PASS after recursive source, manifest, DB, boundary-hash, and automation fail-closed guard remediation | `73d9a0f`, `2d81e07`, `abd7d14`, `2ccf8c1` |
| 14. Conversation orchestration | completed | complete | PASS | PASS after atomic persistence, authoritative outcome, package-grant race, teardown, and real PostgreSQL fixes; 20x GitHub gate | `06431d5`, `47e135a`, `b072429`, `1042b57`, `3267cd6`, `cd79397`, `74807ec`, `5a61c18`, `9faf96d`; run `30493079425` |
| 15. Booking orchestration | completed | complete | PASS | PASS after atomic callback, composition, consent projection, migration compatibility, and real PostgreSQL fixes; repeat gates 20x | `09896db`, `76c3d4b`, `04dad73`, `60f7603`, `31e2aea`; run `30502289472` |
| 16. Privacy lifecycle | blocked: disabled foundation published; production enablement pending | foundation complete | FAIL for production scope | PASS for disabled-foundation safety; PostgreSQL schema CI PASS | `3fefc44`..`3b14752`, `95ee4d3`; run `30523619894` |
| 17. Feedback, administration, and audit | completed: atomic feedback, IAM, workflows, and authenticated admin API | complete | PASS after adversarial review | PASS; full PostgreSQL/API CI | `45ae7c2`..`193e003`; runs `30531644028`, `30536766033`, `30698336816`, `30699514583` |
| 18. Make and Sheets projections | completed: outbound-only, runtime validated, semantic boundaries hardened | complete | PASS after two adversarial fix waves | PASS; 120/120 focused tests | `5f2a35a`, `655bf40`, `f7b8e2a` |
| 19. Worker jobs | completed: expiry, reconciliation, safety handoff, runnable bounded worker | complete | PASS after starvation/shutdown/batch-cap fixes | PASS; 154 non-container tests and full PostgreSQL CI | `f9833b7`, `fdfa17a`; run `30703519380` |
| 20. Hardened API | completed: runnable disabled composition, hardened ingress, observability, retry-safe webhook inbox | complete | PASS after two adversarial fix waves | PASS; 147/147 local and exact-SHA PostgreSQL CI | `85a103e`..`ce248bc`; run `30705734230` |
| 21. Docker, CI/CD, and release evidence | completed: non-root images, isolated smoke, exact-digest scanning/signing, run-bound release provenance | complete | PASS after executable CI fix loop | PASS; exact-SHA CI and PostgreSQL gates | `526601c`..`1a2f514`; runs `30714417342`, `30714431793` |
| 22. Deployment-readiness hardening | in progress: main-only provenance, strict image gate, provenance-bound SBOMs, runtime hardening, explicit local DB exception | remediation implemented | PASS after SBOM binding and local-database contract fixes; no remaining Critical/Important findings | local targeted verification PASS; hosted exact-SHA verification pending | pending |

## Cross-task findings

- Live payments stay disabled until a provider and legal rules are selected.
- Existing Telegram credentials belong to an unrelated bot and are not reusable.
- Live provider mutations remain disabled until contract fixtures and staging checks pass.
- Privacy mutations and workers are explicitly fail-closed by default. Production
  enablement requires real exact-four provider target capture, bound envelope
  encryption/KMS, provider reconciliation proof, crash-safe retention leases and
  retries, durable backup verification/audit/alerts, and behavioral PostgreSQL
  PRIV-01..05 evidence.
