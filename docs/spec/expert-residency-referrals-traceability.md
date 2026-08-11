# Expert Residency Referrals Traceability

Status: release-readiness evidence in progress. Feature remains disabled by default. Staging and production are not authorized by this document.

Source design: `docs/superpowers/specs/2026-08-02-expert-residency-referrals-design.md`.

| Requirement | Implementation | Focused verification | Mandatory CI | Telemetry | Recovery / rollback | Approval owner |
|---|---|---|---|---|---|---|
| ERR-FR-001 | `expert-referral-repository.ts`, admin service/API | repository/admin tests | Main CI + DB Gate pending registration | code lifecycle | revoke unused batch/code; disable new commands | Security admin |
| ERR-FR-002 | code crypto + referral repository | crypto/repository/admin tests | Main CI pending registration | code lifecycle | rotate HMAC key version; never reconstruct plaintext | Security admin |
| ERR-FR-003 | referral repository + admin replay | repository/admin tests | Main CI pending registration | code lifecycle | audited revoke; kill switch | Security admin |
| ERR-FR-004 | expert namespace/schema + scope guard | domain/schema/scope tests | Main CI security suite | code lifecycle | disable expert feature; client model unchanged | Product + Security |
| ERR-FR-005 | referral repository transaction | redemption + concurrency tests | DB Gate pending registration | redemption | reject command; investigate expert eligibility | Operations |
| ERR-FR-006 | referral repository constraints/locks | redemption concurrency | DB Gate pending registration | redemption | no repair unless audited data incident | Security |
| ERR-FR-007 | referral repository serializable mutation | redemption tests | DB Gate pending registration | redemption | immutable binding; restore DB only from approved recovery | DB owner |
| ERR-FR-008 | issuance/reward rules | repository/domain tests | Main CI pending registration | reward outcome | revoke unused code only; never claw back valid grant for inviter expiry | Product |
| ERR-FR-009 | tariff version repository + migrations | residency repository/schema tests | DB Gate schema gate pending registration | residency operation | retire version; forward-fix tariff | Finance admin |
| ERR-FR-010 | residency order snapshot | checkout/settlement tests | DB Gate pending registration | residency operation | preserve historical snapshot; create new tariff version | Finance admin |
| ERR-FR-011 | bigint/minor-unit domain + DB checks | domain/repository/property tests | Main CI property suite | credit spend | reject malformed amount | Finance reviewer |
| ERR-FR-012 | `quoteResidency` + residency repository | domain/residency tests | Main CI property suite | credit spend | disable checkout; recompute fresh quote | Finance reviewer |
| ERR-FR-013 | quote/checkout repository | checkout tests | DB Gate pending registration | credit spend | release pending reservation and requote | Finance reviewer |
| ERR-FR-014 | provider inbox settlement + first-settlement marker | settlement tests | DB Gate pending registration | reward outcome | refund/reversal path; no retroactive reward | Finance + Security |
| ERR-FR-015 | verified-event boundary + provider inbox | contract/settlement tests | Main CI contract suite | reward outcome | reject/unprocessed provider event | Security |
| ERR-FR-016 | unique constraints + provider inbox | settlement concurrency | DB Gate pending registration | duplicate events | idempotent replay only | DB owner |
| ERR-FR-017 | reward grants + ledger allocations | domain/property/deadline tests | DB Gate pending registration | credit spend/expiry | expiry worker; allocation audit | Finance reviewer |
| ERR-FR-018 | append-only ledger + DB triggers/checks | schema/refund tests | DB Gate schema gate pending registration | credit expiry/reversal | compensating fact only | DB owner |
| ERR-FR-019 | checkout reservation + expiry release | checkout/deadline tests | DB Gate pending registration | credit spend/expiry | expiry worker/release exactly once | Operations |
| ERR-FR-020 | derived balances/views | balance/repository tests | Main CI pending registration | debt/credit spend | rebuild projection from ledger facts | DB owner |
| ERR-FR-021 | provider reversal transaction | refund/reversal tests | DB Gate pending registration | refund/reversal | replay verified event; escalation on mismatch | Finance |
| ERR-FR-022 | reversal/debt ledger | refund/reversal tests | DB Gate pending registration | debt | debt investigation runbook | Finance |
| ERR-FR-023 | debt-first reward allocation | refund/reversal + hold replay tests | DB Gate pending registration | debt/reward | replay held reward after control approval | Finance |
| ERR-FR-024 | provider inbox owns residency transition | provider inbox tests | Main CI contract + DB Gate pending | refund/reversal | provider reconciliation; no referral-side residency invention | Finance |
| ERR-FR-025 | expert HTTP + Telegram views | Task 10 focused tests | Main CI pending registration | redemption/residency | disable new commands | Operations |
| ERR-FR-026 | admin referral API/service/repository | admin tests | Main CI pending registration | code lifecycle/replay | two-person/admin rollback procedures | Security admin |
| ERR-FR-027 | `expert-prompt-context.ts` | prompt context/safety tests | Main CI security suite pending registration | none with high-cardinality facts | remove prompt context; server remains authority | AI owner |
| ERR-FR-028 | typed expert proposal validator + service principal | prompt safety/API tests | Main CI security suite pending registration | rejected proposal outcome | disable model proposal path | AI owner |
| ERR-FR-029 | batch table/audit metadata | referral repository/schema tests | DB Gate schema gate pending registration | code lifecycle | revoke unused codes; preserve batch audit | Security admin |
| ERR-FR-030 | provider inbox residency interval serialization | settlement concurrency tests | DB Gate pending registration | settlement outcome | reconcile order/residency facts | DB owner |
| ERR-FR-031 | DB deadline + expiry worker | deadline + worker expiry tests | DB Gate pending registration | credit expiry/job duration | release expired order; fresh quote required | Operations |
| ERR-FR-032 | first-settlement marker/sequence | settlement concurrency tests | DB Gate pending registration | duplicate/reward | DB incident recovery only | DB owner |
| ERR-FR-033 | refund cash cap; no credit restoration | refund/reversal tests | DB Gate pending registration | refund | reconcile cash captures/refunds | Finance |
| ERR-FR-034 | allocation-derived reversal/debt | refund/reversal tests | DB Gate pending registration | reversal/debt | idempotent provider reversal replay | Finance |
| ERR-FR-035 | durable provider event inbox + verified evidence | contract/provider inbox tests | Main CI contract suite | duplicate events/reconciliation | replay authenticated event; never use raw payload as authority | Security |
| ERR-FR-036 | settlement eligibility snapshot/terminal marker | settlement + abuse tests | DB Gate pending registration | reward outcome | no retroactive award; incident review only | Security |
| ERR-FR-037 | scope guard + disabled provider adapter/reader | scope/contract/worker tests | Main CI security suite | provider disabled | keep provider composition disabled | Security |
| ERR-FR-038 | issuance quota locks/window | repository quota tests | DB Gate pending registration | code lifecycle | bounded override only | Security admin |
| ERR-FR-039 | dual-approved issuance override | approval/admin repository tests | Main CI admin/security suite | code lifecycle | expire/revoke override; immutable audit | Two security admins |
| ERR-FR-040 | expert uniqueness/abuse hold checks | settlement/hold tests | DB Gate pending registration | reward outcome | human review; no retroactive failed reward | Security |
| ERR-FR-041 | feature control/kill switch + existing-state worker paths | control, settlement, worker tests | Main CI + DB Gate pending registration | disabled/job outcomes | disable new commands; continue reconciliation/expiry/reversal | Incident commander |
| ERR-FR-042 | pending hold marker + controlled replay | hold replay integration + worker tests | DB Gate pending registration | held replay/reward/debt | replay bounded batch after approved re-enable; refund cancellation terminal | Finance + Security |

## Release gate

No requirement is considered production-approved merely because its row is populated. Release requires all focused tests to pass at one exact SHA, mandatory hosted CI and Database Gate to pass at that SHA, independent migration and financial review, authenticated sandbox settlement/refund/replay evidence, a named AI spot-check for ERR-FR-027/028, and explicit staging authorization. Production requires a separate explicit authorization.
