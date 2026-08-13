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
| 22. Deployment-readiness hardening | completed: main-only provenance, strict image gate, provenance-bound SBOMs, runtime hardening, explicit local DB exception | complete | PASS after SBOM binding and local-database contract fixes; no remaining Critical/Important findings | PASS; exact-SHA CI and PostgreSQL gates | `dd3e03a`; runs `30728347265`, `30728347271` |
| 23. Remote Compose deployment adapter | completed as code: immutable remote deploy, authenticated migration approval, health/reconciliation, provenance-bound rollback, main-only environments | complete; live target activation remains blocked | PASS; independent CI/security re-review found no Critical/Important issues | PASS; focused 18/18, scope 97/97, exact-SHA CI and PostgreSQL gates | `5077a7f`; runs `30731968837`, `30731968836` |

## Cross-task findings

- Live payments stay disabled until a provider and legal rules are selected.
- Existing Telegram credentials belong to an unrelated bot and are not reusable.
- Live provider mutations remain disabled until contract fixtures and staging checks pass.
- Privacy mutations and workers are explicitly fail-closed by default. Production
  enablement requires real exact-four provider target capture, bound envelope
  encryption/KMS, provider reconciliation proof, crash-safe retention leases and
  retries, durable backup verification/audit/alerts, and behavioral PostgreSQL
  PRIV-01..05 evidence.

## Expert residency referrals extension

- Plan: `docs/superpowers/plans/2026-08-03-expert-residency-referrals.md`
- Branch: `codex/task25-expert-referral-implementation`
- Baseline commit: `1bfae356abd0ce9921ec177ae619023a6ef2129d`
- Claw baseline: [run 30777986527](https://github.com/Dimkox/openclaw-airgap-farm/actions/runs/30777986527) — build; unit 266/266; property 1/1; contract 98/98; security 140/140; PostgreSQL integration 124/124; E2E 3/3; isolated cleanup passed.

| Task | Status | Base | Implementer report | Spec review | Quality review | Verification |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | complete | `1bfae356` | `3d21f51`, PASS, 106/106 | PASS | PASS, no findings | focused Vitest 106/106; Prettier; diff check; Claw run `30778931988` PASS |
| 2 | complete | `9e99e2e` | `ec2bc33`, manifest-pin fix `5b7e53c` | PASS | PASS after Claw finding and re-review | 112/112; domain typecheck; deploy check; ESLint; Claw run `30780330798` PASS |
| 3 | complete | `0c78535` | `d4806c3`, fixes `989503b`, `4d5b984`, Claw fixture fixes `de4ab79`, `b6ff90f` | PASS | PASS after four fix loops; no findings | 116 static tests; Drizzle/build/typecheck/lint; `MIGRATION-COMPATIBILITY: 4d5b984`; Claw run `30787129883` PASS; `EXPERT-IDENTITY-PREFLIGHT: duplicate_groups=0`; non-container 525/525, PostgreSQL 137/137, E2E 3/3, cleanup PASS |
| 4 | complete | `d1dd18d` | `e41fec7`, hardening `664af58`, timestamp/action fixes `b38d95b`, `cf09972`, `f048423`, exact timestamp remediation `32226e7`, `8058407`, `7d121f1` | PASS | PASS after adversarial and two Claw-discovered SQL fixes; no Critical/Important/Minor findings | focused tests/build/typecheck/lint; final Claw run `30799312263` PASS; exact source `581cc1d`; PostgreSQL 148/148; redemption concurrency 20/20; E2E 3/3; cleanup PASS |
| 5 | complete | `7af5426` | `8ca7fe5`, accounting remediation `070e23f`, raw-PG money fix `7409a14`, exact scope approval `581cc1d` | PASS | PASS after adversarial and Claw fix loops; no Critical/Important/Minor findings | 24 focused boundary/parity tests and 108 scope guards; final Claw run `30799312263` PASS; non-container 342+6+98+143; PostgreSQL 148/148; checkout concurrency 20/20; E2E 3/3; cleanup PASS |
| 6 | complete | `6385271` | `e20ab30`, export fix `6cf0fd0`, invariant/replay/migration/debt hardening `8a00f9b`, `cc5351b`, `d4a3a42`, `6a75c01`, Claw fixture fixes `fdf2cd7`, `956afc6` | PASS | PASS after adversarial trust-boundary, deadlock, FIFO, provenance, replay, and Claw module-identity fix loops; no Critical/Important/Minor findings | exact-SHA CI `30807553852` PASS; Database Gate `30807553857` PASS; final Claw run `30808412088` PASS on source `956afc6`; migration preflight, non-container baseline, PostgreSQL baseline, redemption/checkout/settlement concurrency 20/20 each, E2E, isolated cleanup PASS; failed precursor runs `30805282490`, `30806747582`, `30807842701` retained as diagnostic evidence |
| 7 | complete | `83ff32e` | `4060f67`, financial hardening/migration `2db0b71`, `b03d6ef`, `04db293`, Claw fixture fixes `95d391a`, SQL NULL hardening `d926293` | PASS | `FINANCIAL-STATE-MACHINE: 04db293707bd9a536fc331228aa72d388f814a47`; final `d926293` review PASS, no findings | exact-SHA CI `30815831542` PASS; Database Gate `30815832008` PASS; final Claw run `30816072163` PASS on source `d926293`; migration preflight, non-container baseline, PostgreSQL 163/163, redemption/checkout/settlement/hold-refund-replay concurrency 20/20 each, E2E, isolated cleanup PASS; failed precursor runs `30813762727`, `30814885152` retained as diagnostic evidence |
| 8 | complete | `1569fac` | services/flags `74c2618`, keyring/YAML hardening `fd56d94`, integration fixture fixes `545c6c0`, `68743bc`, supply-chain remediation `4745874`, `ebee01e` | PASS | PASS after YAML, retained-key, runtime-keyring, fixture-isolation, and major-bounded dependency override fix loops; no findings | exact-SHA CI `30853902210` PASS; Database Gate `30853902195` PASS; final Claw run `30855476532` PASS on source `ebee01e`; Task 8 focused gate, migration preflight, non-container baseline, PostgreSQL baseline, redemption/checkout/settlement/hold-refund-replay concurrency 20/20 each, E2E, isolated cleanup PASS; immutable asset `500564058`, SHA-256 `edb1625e425d9b306284abb3f044fee1e75d698025953bdb922e9bce32742d89`; failed precursor CI runs `30819003633`, `30819595217`, `30852063573`, `30852771172` retained as diagnostic evidence |
| 9 | complete | `ebee01e` | admin workflows `7fbce4d`; approval/replay hardening `9d93a62`..`a121e21` | PASS | PASS after approval ownership, immutable replay, semantic result, deadlock-ordering, and Drizzle error-unwrapping fix loops; no findings | exact-SHA CI `30865251809` PASS; Database Gate `30865251814` PASS; focused tests/typecheck/lint and independent review PASS |
| 10–12 | pending | — | — | — | — | — |

## Expert Bearer principal boundary

- Plan: `docs/superpowers/plans/2026-08-12-expert-bearer-principal.md`
- Branch: `codex/expert-bearer-principal`
- Baseline commit: `80bcfbf07188f8f53e3dd8d6e219a884f866829d`
- Test target: existing `ii-tonya-test` profile on Claw; focused runs only; production and Compose stay unchanged.

| Task | Status | Base | Implementer report | Spec review | Quality review | Verification |
| --- | --- | --- | --- | --- | --- | --- |
| 1. Provider-neutral resolver | complete | `80bcfbf` | `8efb458`; report PASS with missing planned tsconfig noted | PASS | PASS; no findings | Claw RED expected missing module; GREEN 16/16; ESLint, Prettier, diff check PASS; remote restored and cleanup 0/0 |
| 2. Composed API failure semantics | complete | `8efb458` | `93334aa`; report PASS with known tsconfig/legacy Prettier limitations | PASS | PASS; no findings | Claw valid RED 20/21; GREEN 37/37; ESLint/diff check PASS; remote restored and cleanup 0/0 |
| 3. Traceability and evidence | complete | `93334aa` | `4eb2d40`, remediation `0eea9bf`, durable gate `1a93419` | PASS after three evidence fixes | PASS; no Critical/Important findings | exact source `93334aa`; image `7d71646347d560ff2b5d8ebc4c0aad5b48230254`; Claw 37/37 in 5.00s; restored base; cleanup 0/0 |

- Whole-branch review of `83e20da..9753770`: PASS with no Critical, Important, or Minor findings.
- ERR-AUTH-008 follow-up: exact source `b1777bd`, image `7d71646347d560ff2b5d8ebc4c0aad5b48230254`; focused Claw logger test 2/2 in 719ms; restored base; cleanup 0/0.
- Publication: Draft PR #9; CI and Database Gate are migrated to the repository-scoped self-hosted Claw runner and no longer depend on hosted Actions minutes. Release/deploy remains NO-GO pending exact-SHA workflow evidence and human approval.
- Repeat-policy remediation: hard maximum is now three in every environment; all Database Gate repeats are 3x and 20x is prohibited. Exact Claw source `ce72fa3`; frozen install, build, format, deploy contract, lint, typecheck and audit PASS; full corpus 120 files / 983 tests PASS three times in 310.94s, 316.30s and 314.17s. Source restored to `83e20da`; cleanup 0 containers / 0 processes.
- GitHub Free branch-control compensation: hosted-runner dependency removed; legacy native deployment reduced to an explicit refusal; gated release moved to `ii-tonya-release` on Claw; squash-only repository merges and main-only deployment environments configured. Exact-SHA CI evidence pending this commit.
- Release-control remediation: `server-control.yml` is now refusal-only; migration approval binds the exact main CI SHA, squash merge commit, PR-head review commit, exact marker, and write-capable reviewer. Test and release runner identities are separated (`ii-tonya-test` versus `ii-tonya-release`), and transient SSH/provenance/evidence material is removed with `always()` cleanup. Claw TDD RED was 3 expected failures; focused GREEN 10/10; workflow plus recursive scope 113/113; actionlint 5/5; Prettier PASS; independent Critical/Important re-review PASS. Commit and exact-SHA CI evidence remain pending.

## Sandbox payment provider

- Design: `docs/superpowers/specs/2026-08-13-sandbox-payment-provider-design.md`
- Plan: `docs/superpowers/plans/2026-08-13-sandbox-payment-provider.md`
- Branch: `codex/sandbox-payment-provider`
- Baseline: `120368d5b3b439df44d16525f59f4d008b4cffff`
- Test target: constrained `ii-tonya-test` profile on Claw; maximum three repeats; production smoke once.

| Task | Status | Base | Implementer | Spec review | Quality review | Verification |
| --- | --- | --- | --- | --- | --- | --- |
| 1. Contracts and database boundary | complete | `5e21170` | `520ad39`..`89dfe66` | PASS after two guard remediations | PASS; no findings | Claw repository 15/15, repeat 45/45, schema 2/2, scope 113/113; build/typecheck/lint/format; cleanup 0 |
| 2. Verifier, adapter, reconciliation | complete | `c7e8a68` | `73c6379`..`e5ef5f1` | PASS | PASS; one cross-task architecture guard recorded | Claw focused 8/8, repository 15/15; build/typecheck/lint/format; cleanup 0 |
| 3. Approved admin transitions | complete | `7b8f9de` | `55430cd`..`4a2cc3e` | PASS after remediation | PASS; no findings | Claw focused 25/25, workflow repeat 3x 36/36; static checks; cleanup 0 |
| 4. Separate sandbox API | complete | `7f9ec00` | `69998e2`..`dc44e42` | PASS after runtime and packaging remediation | PASS; no findings | Claw focused 41/41, isolation 5/5, bounded ESM/DTS build + artifact smoke; cleanup 0 |
| 5. Settlement/refund E2E | conditional: Task 6 SBX-TST-009 pending | `e64858a` | `3323d1e`..`f4afb8f` | PASS after remediation | PASS conditional; no Critical/Important, one interval assertion Minor | Claw 48/48, reconciliation repeat 3x 6/6; builds/static; cleanup 0 |
| 6. Container and image isolation | pending | — | — | — | — | — |
| 7. Evidence and final gates | pending | — | — | — | — | — |

Cross-task gate: Task 6 must inspect the built production image dependency inventory and
prove `@ii-tonya/sandbox-payments` is absent. The current Dockerfile deploys only the
`@ii-tonya/api` production closure, and `apps/api/package.json` has no sandbox dependency.

Cross-task gate: Task 4 isolation tests must reject imports or instantiation of
`createCanonicalExpertResidencyPaymentEventVerifier` from production composition. Its
root export is a privileged minting capability reserved for sandbox composition/tests.

Cross-task gate: SBX-TST-009 sandbox-container checkout-to-refund smoke is owned by
Task 6. Task 5 cannot be marked complete until that exact built-container evidence passes.
