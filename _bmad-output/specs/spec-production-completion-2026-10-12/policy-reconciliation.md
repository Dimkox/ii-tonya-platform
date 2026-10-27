# Source-policy reconciliation — 2026-10-12

This supplements the immutable all-tab audit. Resolving a source conflict does not prove its implementation or deployment. Do not alter the audit's original counts to manufacture progress.

## Current owner boundaries

Keep the real catalogue empty. Do not return written consent or electronic signing to the start route. Factory and Trust CI are excluded. Automated development checkpoints are delegated; human product acceptance is not.

## Decisions already available

Authority: `_bmad-output/specs/spec-owner-update-2026-09-16/decision-register.md`, the referenced accepted design, and the exact additional commit below.

| Subject                           | Controlling decision                     | Execution consequence                                                                               |
| --------------------------------- | ---------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Paid client term / intro          | DEC-FIN-002                              | 60calendar days;100intro units; retain historical grants                                            |
| Client price and coupon amount    | DEC-FIN-003                              | 4999/5999/7999/10990RUB; x2 rule, not a second fixed-grant system                                   |
| Coupon expiry                     | DEC-FIN-005                              | 45days for the new client policy                                                                    |
| Payment anchor / coupon cap       | bbad346a93ebd9d498550e9850d2d459d782a4b8 | Provider successful-payment time;20percent client service coupon cap; not expert credit             |
| Expert base tariffs               | DEC-FIN-007                              | Preserve V2 3900/5900/9990; do not revive weekly pricing                                            |
| Weekly / Early Birds              | DEC-FIN-008                              | Archived for new sales, not missing new-release features                                            |
| Energy windows                    | DEC-FIN-010                              | Half-open0–72h,72–144h,144–216h; full price afterwards                                              |
| Partner thresholds                | DEC-FIN-012                              | 6and10qualified experts; exact capacity basket, not next larger basket                              |
| Expert code visibility            | DEC-FIN-014                              | Created at registration, shown after first payment; reuse remains separately unresolved             |
| Expert referral qualification     | DEC-FIN-015                              | Questionnaire, setup fee and first month payment;30day reversal window                              |
| Bonus maturity / promotion lock   | DEC-FIN-016                              | 30day grant maturity and independent3month promotional spending ban                                 |
| Expert credit                     | DEC-FIN-017                              | 30percent post-discount; space10percent; historical snapshots unchanged                             |
| Landing palette                   | DEC-EXP-005                              | Keep current paper/terracotta/forest; brandbook variants are a separate choice                      |
| Proactive clinical rhythm         | DEC-EXP-006                              | No new post-visit silence/feedback/check-in rhythm in this increment; in-session scope retained     |
| Local reservation deadline        | DEC-PLT-001                              | Minimum of72hours and appointment start minus buffer; do not promise unconditional72hours           |
| Signing / detailed sensitive mode | DEC-PLT-011 plus current owner goal      | No signing or stored-special-category mode in this release                                          |
| Expert client lookup              | EXP-BOT-004/005,2026-08-13design         | Opaque owned-reservation callbacks; no arbitrary name search or client financial/history disclosure |
| Expert statistics                 | EXP-BOT-006,2026-08-13design             | Rolling30day nonfinancial aggregates, not calendar-month revenue                                    |

The payment amendment is present on `codex/client-paid-policy-20261010`, not merged into this worktree. `git show` verified it directly. Integration and migration lineage review remain required; historical open wording is not a reason to ask those settled questions again.

## Owner clarification received

DEC-FIN-011: owner answered2026-10-12 that the final price after all discounts must remain at least5000RUB. Apply `max(discountedPriceMinor,500000)` to new applicable expert quotes; do not rewrite paid snapshots or unrelated client package prices. At a5000basis and15percent discount, final price is5000, not4250. This resolves the ordering ambiguity; operational implementation is still required.

## Genuinely unresolved or inconsistent

- DEC-FIN-029 remains open: reusable expert codes versus existing single-redemption uniqueness.
- DEC-FIN-030 remains open: production partner absolute tariff approval; fixtures are not approval.
- DEC-FIN-031 remains open: paid/qualified partner-to-expert affiliation; hardcoded zero is not a working count.
- DEC-FIN-004 says reminder three calendar days before a **slot**, while TASK-FIN-004/REQ-FIN-003 targets **package expiry**. The task's referenced `fin-package-reminder-policy.md` is missing. Do not silently wire package reminders to appointment time.
- Image references are identical and featureless-faced; the detailed-face text is still inconsistent. This does not require changing the accepted landing palette.

## Implementation priority without financial guessing

Provider-confirmed calendar workflow is independent of partner prices and referral reuse. Its implementation contract is `docs/superpowers/implementation-artifacts/spec-planerka-booking-workflow.md`. The root defect is confirmed: domain expert_confirm becomes booked and repository emits client confirmation before provider completion; worker composition lacks the provider handler. Fix the whole transition, recovery and public-state projection before activation.

Next dependencies remain real Selarti composition, paid client policy integration, checkout/settlement, client and expert journeys, public-copy reconciliation and full exact-RC release evidence. This document does not defer them or redefine the goal as a calendar-only product.
