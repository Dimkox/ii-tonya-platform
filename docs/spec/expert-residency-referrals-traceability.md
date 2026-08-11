# Expert Residency Referrals Traceability

Status: release-readiness evidence in progress. Feature remains disabled by default. Staging and production are not authorized by this document.

Source design: `docs/superpowers/specs/2026-08-02-expert-residency-referrals-design.md`.

| Requirement | Implementation | Focused verification | Mandatory CI | Telemetry | Recovery / rollback | Approval owner |
|---|---|---|---|---|---|---|
| ERR-FR-001 | `expert-referral-repository.ts`, admin service/API | repository/admin tests | Main CI `pnpm verify`; Database Gate schema/redemption gates | code lifecycle | revoke unused batch/code; disable new commands | Security admin |
| ERR-FR-002 | code crypto + referral repository | crypto/repository/admin tests | Main CI `pnpm verify` | code lifecycle | rotate HMAC key version; never reconstruct plaintext | Security admin |
| ERR-FR-003 | referral repository + admin replay | repository/admin tests | Main CI `pnpm verify` | code lifecycle | audited revoke; kill switch | Security admin |
| ERR-FR-004 | expert namespace/schema + scope guard | domain/schema/scope tests | Main CI security/full regression; Database Gate schema parity | code lifecycle | disable expert feature; client model unchanged | Product + Security |
| ERR-FR-005 | referral repository transaction | redemption + concurrency tests | Main CI; Database Gate 20x redemption concurrency | redemption | reject command; investigate expert eligibility | Operations |
| ERR-FR-006 | referral repository constraints/locks | redemption concurrency | Database Gate 20x redemption concurrency | redemption | no repair unless audited data incident | Security |
| ERR-FR-007 | referral repository serializable mutation | redemption tests | Main CI; Database Gate 20x redemption concurrency | redemption | immutable binding; restore DB only from approved recovery | DB owner |
| ERR-FR-008 | issuance/reward rules | repository/domain tests | Main CI `pnpm verify` | reward outcome | revoke unused code only; never claw back valid grant for inviter expiry | Product |
| ERR-FR-009 | tariff version repository + migrations | residency repository/schema tests | Main CI; Database Gate schema parity | residency operation | retire version; forward-fix tariff | Finance admin |
| ERR-FR-010 | residency order snapshot | checkout/settlement tests | Main CI; Database Gate checkout/settlement gates | residency operation | preserve historical snapshot; create new tariff version | Finance admin |
| ERR-FR-011 | bigint/minor-unit domain + DB checks | domain/repository/property tests | Main CI property/full regression | credit spend | reject malformed amount | Finance reviewer |
| ERR-FR-012 | `quoteResidency` + residency repository | domain/residency tests | Main CI property/full regression | credit spend | disable checkout; recompute fresh quote | Finance reviewer |
| ERR-FR-013 | quote/checkout repository | checkout tests | Main CI; Database Gate 20x checkout concurrency | credit spend | release pending reservation and requote | Finance reviewer |
| ERR-FR-014 | provider inbox settlement + first-settlement marker | settlement tests | Main CI; Database Gate 20x settlement concurrency | reward outcome | refund/reversal path; no retroactive reward | Finance + Security |
| ERR-FR-015 | verified-event boundary + provider inbox | contract/settlement tests | Main CI contract/full regression | reward outcome | reject/unprocessed provider event | Security |
| ERR-FR-016 | unique constraints + provider inbox | settlement concurrency | Database Gate 20x settlement concurrency | duplicate events | idempotent replay only | DB owner |
| ERR-FR-017 | reward grants + ledger allocations | domain/property/deadline tests | Main CI; Database Gate deadline/settlement gates | credit spend/expiry | expiry worker; allocation audit | Finance reviewer |
| ERR-FR-018 | append-only ledger + DB triggers/checks | schema/refund tests | Main CI; Database Gate schema parity | credit expiry/reversal | compensating fact only | DB owner |
| ERR-FR-019 | checkout reservation + expiry release | checkout/deadline tests | Database Gate 20x checkout + deadline gates | credit spend/expiry | expiry worker/release exactly once | Operations |
| ERR-FR-020 | derived balances/views | balance/repository tests | Main CI full regression | debt/credit spend | rebuild projection from ledger facts | DB owner |
| ERR-FR-021 | provider reversal transaction | refund/reversal tests | Main CI full regression; Database Gate settlement gate | refund/reversal | replay verified event; escalation on mismatch | Finance |
| ERR-FR-022 | reversal/debt ledger | refund/reversal tests | Main CI full regression | debt | debt investigation runbook | Finance |
| ERR-FR-023 | debt-first reward allocation | refund/reversal + hold replay tests | Main CI; Database Gate 20x held-reward gate | debt/reward | replay held reward after control approval | Finance |
| ERR-FR-024 | provider inbox owns residency transition | provider inbox tests | Main CI contract/full regression; Database Gate settlement gate | refund/reversal | provider reconciliation; no referral-side residency invention | Finance |
| ERR-FR-025 | expert HTTP + Telegram views | Task 10 focused tests | Main CI `pnpm verify` | redemption/residency | disable new commands | Operations |
| ERR-FR-026 | admin referral API/service/repository | admin tests | Main CI `pnpm verify` | code lifecycle/replay | two-person/admin rollback procedures | Security admin |
| ERR-FR-027 | `expert-prompt-context.ts` | prompt context/safety tests | Main CI security/full regression | none with high-cardinality facts | remove prompt context; server remains authority | AI owner |
| ERR-FR-028 | typed expert proposal validator + service principal | prompt safety/API tests | Main CI security/full regression | rejected proposal outcome | disable model proposal path | AI owner |
| ERR-FR-029 | batch table/audit metadata | referral repository/schema tests | Main CI; Database Gate schema parity | code lifecycle | revoke unused codes; preserve batch audit | Security admin |
| ERR-FR-030 | provider inbox residency interval serialization | settlement concurrency tests | Database Gate 20x settlement concurrency | settlement outcome | reconcile order/residency facts | DB owner |
| ERR-FR-031 | DB deadline + expiry worker | deadline + worker expiry tests | Main CI; Database Gate 20x deadline gate | credit expiry/job duration | release expired order; fresh quote required | Operations |
| ERR-FR-032 | first-settlement marker/sequence | settlement concurrency tests | Database Gate 20x settlement concurrency | duplicate/reward | DB incident recovery only | DB owner |
| ERR-FR-033 | refund cash cap; no credit restoration | refund/reversal tests | Main CI full regression | refund | reconcile cash captures/refunds | Finance |
| ERR-FR-034 | allocation-derived reversal/debt | refund/reversal tests | Main CI full regression | reversal/debt | idempotent provider reversal replay | Finance |
| ERR-FR-035 | durable provider event inbox + verified evidence | contract/provider inbox tests | Main CI contract/full regression | duplicate events/reconciliation | replay authenticated event; never use raw payload as authority | Security |
| ERR-FR-036 | settlement eligibility snapshot/terminal marker | settlement + abuse tests | Main CI; Database Gate settlement/held-reward gates | reward outcome | no retroactive award; incident review only | Security |
| ERR-FR-037 | scope guard + disabled provider adapter/reader | scope/contract/worker tests | Main CI security/full regression | provider disabled | keep provider composition disabled | Security |
| ERR-FR-038 | issuance quota locks/window | repository quota tests | Main CI full regression; Database Gate schema/redemption gates | code lifecycle | bounded override only | Security admin |
| ERR-FR-039 | dual-approved issuance override | approval/admin repository tests | Main CI admin/security/full regression | code lifecycle | expire/revoke override; immutable audit | Two security admins |
| ERR-FR-040 | expert uniqueness/abuse hold checks | settlement/hold tests | Main CI; Database Gate settlement/held-reward gates | reward outcome | human review; no retroactive failed reward | Security |
| ERR-FR-041 | feature control/kill switch + existing-state worker paths | control, settlement, worker tests | Main CI; Database Gate settlement/deadline/held-reward gates | disabled/job outcomes | disable new commands; continue reconciliation/expiry/reversal | Incident commander |
| ERR-FR-042 | pending hold marker + controlled replay | hold replay integration + worker tests | Main CI; Database Gate 20x held-reward gate | held replay/reward/debt | replay bounded batch after approved re-enable; refund cancellation terminal | Finance + Security |

## Release gate

Registration in CI is not a pass result. No requirement is production-approved merely because its row is populated. Release requires all focused tests to pass at one exact SHA, mandatory hosted CI and Database Gate to pass at that SHA, independent migration and financial review, authenticated sandbox settlement/refund/replay evidence, a named AI spot-check for ERR-FR-027/028, and explicit staging authorization. Production requires a separate explicit authorization.
