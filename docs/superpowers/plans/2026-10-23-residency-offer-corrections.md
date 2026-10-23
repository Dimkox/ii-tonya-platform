# Residency Offer Corrections Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Apply the owner's final payment, parallel onboarding and automatic offer rules to the existing residency funnel.

**Architecture:** Add a versioned pricing policy and durable owner-bound offer lifecycle without rewriting v1 history. Keep distinct onboarding/main settlement, reuse checkout/GET/consent barriers, and separate generic onboarding materials/proof from card revisions.

**Tech Stack:** Node24, pnpm11.9.0, TypeScript, PostgreSQL17.5, hand-authored SQL, Fastify, existing worker/Telegram adapters.

**Spec:** `docs/superpowers/implementation-artifacts/spec-residency-offer-corrections.md`

## Global Constraints

Use the existing isolated branch from0d004a71689393f65605703193e728ebdfa44057.
No push/deploy/provider activation or secret copying. Preserve frozen legacy SQL
and quote/order history; add migrations plus journal and actual supported state.
The owner waived repeated approval cycles and focused run-count limits. Diagnose
failures before corrections; never weaken assertions or repeat unchanged suites.
Parallel ownership is permitted only for independent files within this block.

## Review Focus

- A repeated quote, profile edit or policy upgrade must not restart discount time.
- A late/unknown provider result must not pay the new quote or activate an expired one.
- No manager decision, prompt or missing asset may fabricate owner acceptance/delivery.
- Proof confirmation must proceed in parallel without enabling unapproved publication.
- Archive and current offer bounds must be checked after relevant lock waits.

---

### Task1: Versioned calculator and prompt rules

**Files:** `packages/domain/src/expert-campaign-price.ts`, its tests and domain barrel;
new working `docs/prompts/demo_access_test_expert.md` and work-bot prompt asset,
versioned working manifest; `packages/application/src/expert-prompt-context.ts`
and actual demo/expert proposal context composition.

**Interfaces:** Add a v2 pure calculator accepting approved category minor units,
structured qualification facts, subject kind, immutable offer-start and current
timestamps. Return separate one-month/package totals, discounts, floor flags and
next boundary. Existing v1 function/outputs remain available for historical use.
Use stage0 before offer,1=40%,2=30%,3=20%,4=standard for the new owned projection.

- [ ] Write and run RED boundaries at96/168/240h±1ms, modifiers, expert/space package,
      independent floors, total-only rounding and bigint/invalid input tests.
- [ ] Implement and run focused GREEN; build domain before dependent consumers.
- [ ] Add mandatory Russian first-offer explanation and payment/material ordering
      to new working prompt assets/runtime instructions. Preserve archive/hash@1.
- [ ] Test actual prompt composition, absence of annual/manual-recalculate claims,
      and absence of LLM price authority; review and commit the tested deliverable.

### Task2: First-offer authority and parallel paid workflow

**Files:** campaign quote repository/schema and a new hand-authored migration;
expert promo/verification/card repositories and services; manager queue/Telegram
composition; client catalog/discovery/booking predicates and focused tests.

**Interfaces:** A persisted qualified profile revision and one first-issued-offer
anchor produce immutable v2 price snapshots. Fee proof produces an application
materials job and interview access. Independent application promo proof/confirmation
feeds the main gate alongside approved card and owned schedule evidence. Manager
Telegram actions delegate to the existing fresh-MFA decision transaction.

- [ ] Add RED tests for fixed fee despite all discounts, actual fee/main purpose
      separation, old anchor reuse, qualifier ownership and profile-revision changes.
- [ ] Implement additive normalized storage, preserving integer money and source
      constraints. Do not convert unapproved archival tariffs into published rates.
- [ ] Add generic application-bound materials at verified fee success, using the
      real original promo identity when available. Missing content retains honest
      AWAITING_MATERIALS while sending the exact placeholder; no inferred work identity.
- [ ] Accept protected raw text/photo/files and promo proof independently; keep
      explicit TODO: Wait for Prompt Spec, TODO: Wait for PDF and one durable masked
      Ready to send event after two unique referrals. No fake files or sent state.
- [ ] Add trusted staff pairing, scoped expiring approve/reject callbacks and real
      notification worker using current admin/MFA authority and existing fee checkout.
- [ ] Add read/admission-time archive filters and demonstrate exclusion before
      the lifecycle worker runs. Preserve current paid coverage and refund behavior.

### Task3: Automatic offer renewal, reminders and bot menu

**Files:** new offer lifecycle repository/worker, existing worker runtime/main,
promo/work services and API composition/config, current tariff callback/menu;
new integrated acceptance files and evidence.

**Interfaces:** Scheduled internal commands use durable job IDs and stored original
owner selection/schedule evidence, never fabricated Telegram events. Due notices
are unique per offer/stage/type and use current consent/target/attempt fences.
The current-offer projection exposes the owner-requested fields and permitted link.

- [ ] RED test early quotes without a main link;24h/3h uniqueness/catch-up; stage
      transition expiry plus a new exact-price invoice/link; unknown send quarantine.
- [ ] Implement a15min bounded scheduled cycle using DB time after locks, gate-aware
      link creation and existing strict checkout/GET recovery. Stop on paid/erased/revoked.
- [ ] Preserve old payment facts on expiry. Mark local expiry honestly; pending
      provider payments cannot be claimed remotely cancelled. No autocharge.
- [ ] Handle loss of quarterly availability with explicit monthly selection;
      use declared24h operational TTL after the final stage without false price alerts.
- [ ] Wire “Мой актуальный тариф” in the real promo-bot keyboard/callback and return
      first-offer date, current prices/TTL/readiness/link. No manual recalculation action.
- [ ] Run meaningful focused PG scenarios with heavy setup in bounded hooks and
      purpose/owner/replay/expiry/consent/manager/parallelism coverage; review source
      before the first integrated run and diagnose any failure comprehensively.

### Task4: Compatibility and final delivery

- [ ] Reconstruct only new SQL metadata on an isolated task-owned PG17.5 instance;
      never drizzle-kit generate. Reuse the protected rotated local config in memory,
      never print it or read obsolete Docker credentials.
- [ ] Update exact guard inventories/hashes with grouped provenance, independently
      reviewed additions only; preserve all prior financial/privacy denial probes.
- [ ] Run relevant builds/types/lint/format/diff and independent adversarial review.
- [ ] Commit local tested checkpoints and final coverage/status, then one final
      branch gate over the correction range. No remote activation/prompt publication claim.
