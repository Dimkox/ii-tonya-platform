# Authenticated saved-quote expert API Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Route authenticated expert quote/checkout commands through existing saved campaign authority in the ordinary server.

**Architecture:** One campaign application service with typed ports, a thin database composition adapter and the existing expert routes. Keep legacy injected services discriminated; default production construction selects saved-quote semantics. Missing provider is an explicit closed capability, not an order or payment success.

**Tech Stack:** Existing Node24/pnpm11.9.0, TypeScript, Fastify, Zod, Drizzle and PostgreSQL17.5. No new dependency.

**Spec:** docs/superpowers/implementation-artifacts/spec-expert-campaign-api.md

## Global Constraints

- Canonical codex/planerka-api worktree; preserve shared dirty changes.
- Reuse existing repositories unchanged; no new migration or pricing policy.
- No provider/production request, commit/push, nested agent or exhausted-suite run.
- New focused files only: author runs1/2, coordinator3. No full/multi-path tests.
- This increment does not close receipt, Telegram, browser, provider or release gates.

## Review Focus

1. Same-key terminal replay must not initiate payment again: service status matrix.
2. Caller-controlled body IDs/price must not replace authenticated identity: HTTP forged-body matrix.
3. Missing provider must not strand reserved credit: composed503 with zero order count.
4. Client/revoked/duplicate bearer must not gain financial authority: composed authentication matrix.
5. Stored price versus cash must remain distinct: recording provider sees saved cash only.

## Task 1: One coupled authenticated quote/order API slice

**Files:** Exact owned files and two test paths are in the spec's Code Map.

**Interfaces:** createExpertCampaignService returns a discriminated campaign service;
quote accepts ExpertCampaignQuoteRequest, checkout accepts ExpertCampaignCheckoutRequest.
The database adapter uses PostgresExpertCampaignQuoteRepository.createQuote and
PostgresExpertCampaignOrderRepository.createCheckoutOrder. The existing expert
bearer resolver supplies userId/expertId. A trusted optional ResidencyCheckoutProvider
receives orderId, amountMinor, currency and the original command key.

- [ ] Read spec/context; run `pwsh -File scripts/check-development-environment.ps1 -RequireDocker`.
- [ ] Write service tests before behavior: owner rejection; forbidden unknown request
      fields; quote replay; unavailable provider before writes; terminal status matrix;
      stored599400 price versus419580 cash passed to provider; provider failure/retry.
- [ ] Write real PG API tests before behavior: ordinary lifecycle with signed expert
      proof; active owner quote request stores one quote and returns its id; repeat
      preserves id; no-provider checkout returns503 and creates0 orders; legacy body,
      duplicate/client/revoked bearer and forged fields have0 side effects.
- [ ] Run each new test file separately once, recording actual RED and allocation.
- [ ] Implement application ports/service and public safe result mapping. Do not
      type-cast legacy reconciliation or introduce a dummy payment implementation.
- [ ] Compose real DB ownership/referral/quote/order ports in the new API composition
      module; call it from ordinary server dependencies. Retain provider startup
      guards and require real session principal lookup whenever billing is enabled.
- [ ] Update existing routes using committed strict schemas for campaign variant;
      keep explicit legacy discrimination for old injected consumers. Add bounded
      body/duplicate-header/no-store/rate controls without logging credentials.
- [ ] Build affected packages and run test typecheck, scoped ESLint/Prettier and
      `git diff --check`. Run each new focused file once more only (GREEN2).
- [ ] Stop with stable diff and evidence for independent review; main owns final3.
      Do not commit the shared dirty candidate or mark release ready.

The owner delegated technical implementation choices; this contract records those
choices, not fabricated human acceptance. BMad story_key is unset; sprint sync skips.
One implementer owns the coupled interface change to prevent competing barrel/server
edits. Reviewer may reject any part; no second implementer edits the same paths.
