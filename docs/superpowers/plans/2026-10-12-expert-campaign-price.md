# Expert campaign price Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Establish the exact expert campaign price calculation as the first phase of binding displayed quotes to checkout and settlement.

**Architecture:** A pure domain calculator consumes server-authoritative base price, first-calculation timestamp, current timestamp and selected term. Persistence, authentication and provider settlement remain separate required integration phases; this calculator grants no billing authority and does not activate a campaign.

**Tech Stack:** TypeScript, bigint minor-unit arithmetic, Vitest, existing domain package.

**Spec:** DEC-FIN-010 and DEC-FIN-011 in `_bmad-output/specs/spec-owner-update-2026-09-16/decision-register.md`; monthly-floor clarification and evidence in `docs/operations/2026-10-12-expert-quote-composition-gap.md`.

## Global constraints and calculation contract

- Historical V2 tariffs and paid orders remain unchanged. No SQL migration, provider call, live flag or financial mutation in this phase. Client packages and partner/space tariffs are not inputs to this calculator.
- Caller must eventually supply persisted server-owned timestamps, never prompt/client authority. This function does not establish first-calculation persistence or quote validity by itself.
- Function `calculateExpertCampaignPrice(input)` accepts `baseMonthlyMinor: bigint`, `calculationTimestampMs: number`, `quotedAtMs: number`, `termMonths: 1 | 3`.
- Timestamps are nonnegative safe-integer milliseconds within JavaScript Date range. Reject a future calculation timestamp and malformed values. Base price must be positive and fit signed PostgreSQL bigint.
- Energy discount:40% for elapsed `[0,72h)`,30% for `[72h,144h)`,20% for `[144h,216h)`,0% thereafter.
- Three-month Start gives an additional15% in the first stage or10% in the second. Reject three-month requests at/after144h. Do not silently convert the term. The tariff key START is unrelated to this term.
- Engineering rounding choice, explicit and versioned: multiply both discount factors at full integer precision; round once to the nearest kopek, half up, after both discounts. Do not round intermediate discounts. Monthly floor is500000minor after rounding; multiply the final monthly amount by the term even when the floor eliminates the discount.
- Result is frozen and includes `ruleVersion: expert_energy_start_v1`, RUB currency, both discount rates in basis points, `discountedMonthlyMinor`, `monthlyPriceMinor`, `priceMinor`, `floorApplied`, term and duration. Existing V2 duration30×24h is the unit; three units equal90×24h. Settlement-start timing remains owned by settlement, not this calculator.
- Reject a result outside signed PostgreSQL bigint. Referral credit is not a discount input; downstream must retain cash+credit=price without a new minimum-cash requirement.

## Review focus

1. Exact stage endpoints including millisecond-before boundaries.
2. Floor applies after both discounts and to each month, not once to the whole order.
3. Floor must never erase the chosen three-month duration/multiplier.
4. Half-kopeck rounding and bigint overflow must not use floating-point money.
5. Wrong terms, future clocks and invalid inputs must reject without coercion.

## Task1 — Domain calculation

Files: new `packages/domain/src/expert-campaign-price.ts` and matching `.test.ts`; domain barrel export after reviewed calculation.

- [x] Write all independent literal boundary/rounding/floor/invalid-input assertions with a compileable unavailable scaffold. Run focused RED once. Run1 collection failed on bigint test naming; run2 demonstrated35 behavioral failures.
- [x] Implement the exact contract. Run focused GREEN once; reserve third invocation for review corrections. Source review preceded run3;37/37 passed with review boundary additions.
- [ ] Independently review, run relevant types/lint/format/diff checks and record evidence. No full/multi-path suite.

## Subsequent required phases, not completed by Task1

- Persist the first server-owned calculation anchor and immutable quote, including price breakdown, version, selected term and explicit expiry.
- Bind promo display and authenticated quote acceptance to that same quote identity. Preserve ordinary consent and an empty real catalogue.
- Add a new constrained campaign order branch through a new reviewed migration; old V2/legacy constraints and paid snapshots must stay intact.
- Consume the exact quote once at checkout, reserve credit atomically and pass stored cash amount to the provider. Verify settlement uses the same stored term and amount.
- Verify authenticated API, rendered promo and payment/settlement journey, then exact RC release and rollback. A green pure calculator is not commercial readiness.

Execution is inline by coordinator under the owner's delegated development workflow. No external activation or human acceptance is inferred.
