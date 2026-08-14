# ER-AI-003 Durable Receipt Store Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Back the ER-AI-002 request-ledger port with a fenced, replayable PostgreSQL receipt store while keeping expert AI disabled without an injected source.

**Architecture:** Add journaled migration 0027 and an exact Drizzle table containing only hashes, state/fence/version, bounded replay outcome and expiry. A repository atomically claims across workers, fences completion/failure, and cleans terminal receipts in bounded batches; default lifecycle composes it only beside an explicitly injected ingress/principal capability.

**Tech Stack:** TypeScript, PostgreSQL, Drizzle, Vitest.

## Global Constraints

- Exact base `3340fc7e706c64ad0a2de185cd9088f2152ebf44`.
- No raw text, prompt, context, proposal payload, referral code, identifiers, payment URL or model output in receipts.
- Feature remains default-off; named human sign-off remains BLOCKED.
- No live model, YooKassa activation, production, Actions, image build or prune.

### Task 1: Durable schema and repository

- [ ] Add migration/schema tests for hashes, state, fence/version, bounded outcome and retention.
- [ ] Observe RED before migration/repository exists.
- [ ] Implement migration 0027 plus atomic repository claim/complete/fail/cleanup.
- [ ] Prove real-PostgreSQL multi-worker claim, replay, conflict, stale-fence rejection and cleanup.

### Task 2: Default-off composition and release evidence

- [ ] Test source-absent default lifecycle and injected-source durable composition.
- [ ] Compose the PostgreSQL store only with the complete injected expert-AI capability.
- [ ] Run one focused Claw gate at the committed code SHA and record evidence.
- [ ] Obtain independent review; keep human approval BLOCKED and do not push or merge.
