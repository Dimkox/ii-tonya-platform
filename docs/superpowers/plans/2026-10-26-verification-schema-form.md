# Resident Verification Schema and Form Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Deliver the owner's first Schema+Form Logic PR for pre-price resident intake.

**Architecture:** Add a separate owned intake alongside legacy quote-bound onboarding. A pure conditional form drives durable draft mutations through private Telegram identity and original consent. Default-off routing denies new-cohort pricing, while legacy financial facts remain intact.

**Tech Stack:** Existing TypeScript/Node24, pnpm11.9.0, Fastify, PostgreSQL17.5 and hand-authored SQL.

**Spec:** `docs/superpowers/implementation-artifacts/spec-verification-schema-form.md`

## Global Constraints

Base1a006fff4e2985fd83b72f3c67a66823fab87078; branch codex/verification-schema-form-20261026 in the existing isolated worktree. No new runtime dependency, Python stack, live provider action or deployment. Form flag defaults false. Do not call the old invoice-producing manager decision. Missing regulatory/category policy is explicitly unknown. Owner authorized a first-part PR, not full OCR/social/LLM implementation. Preserve original financial and consent authority.

## Review Focus

- Alternate tariff/read/API paths must not bypass the pre-price gate.
- Multiple roles and role changes must not erase answers or waive another role's requirements.
- Replay, stale callbacks and concurrent submission must never write the wrong revision or owner.
- Private file references and follow-up answers must be erased through actual privacy processing.
- Legacy issued offers and paid periods must retain their original clock and access.

### Task1: Pure form contract

**Files:** Create `packages/domain/src/resident-verification-form.ts` and `.test.ts`; modify domain barrel.

**Interfaces:** A versioned draft plus trusted field-policy input yields visible/required fields, validation errors and next question. Mutations accept only bounded applicant fields, never status/checks/prices. Use bigint/string money and typed private document references.

- [ ] RED tests for all six roles, union rules, primary membership, tax for all, unknown/required/optional education policy, role changes and incomplete submission.
- [ ] Implement deterministic validation and question generation; preserve raw answers while ignoring inapplicable fields for requirements.
- [ ] GREEN tests; domain build before importer tests; commit.

### Task2: Owned persistence and privacy

**Files:** Add migration0057+contiguous journal, `packages/db/src/schema/resident-verification.ts`, `packages/db/src/repositories/resident-verification-repository.ts`, exports, focused `tests/integration/resident-verification-form.test.ts`; modify actual privacy repository.

**Interfaces:** Private promo scope plus request key/digest and expected revision starts, reads, patches and submits an owned application. A complete submission atomically records revision/update and pending check work, not a verified outcome. Progress is derived/updated transactionally. Existing user identity/tombstone authority remains canonical.

- [ ] RED ownership, consent, replay/conflict, stale/concurrent submit, SQL NULL/role/tax checks, pending-results and actual-erasure cases.
- [ ] Implement partial-draft schema and submit guards, composite ownership, private refs, bounded content and cancellation. Trusted outcome/status fields have no applicant patch path.
- [ ] GREEN serialized PostgreSQL cases. Preserve historical migrations. Reconstruct supported snapshot57 and exact SQL supplement using a fresh temporary introspection directory.
- [ ] Review migration/privacy and commit.

### Task3: Real Telegram form and pre-price fence

**Files:** Add `packages/application/src/resident-verification-service.ts` and tests; modify applicant service, actual promo route/composition and relevant config/server tests; protect promo quote/application and current-offer read repositories.

**Interfaces:** Authenticated private updates normalize into bounded text/media or scoped revision-bound callback actions. Replies carry explicit inline/reply markup. New-cohort enrollment enters the form; the owner can resume it. Submission acknowledges receipt and pending checks only. Legacy authoritative offers/settlements select the existing flow without timer reset.

- [ ] RED real-ingress callbacks/photos/files/text, role/category menus, consent-first start/resume, forged/stale/cross-owner actions and repeated updates.
- [ ] RED direct `/tariff`, `/apply`, tariff listing/current-offer reads before new approval, with no anchor/invoice; preserve legacy equivalents.
- [ ] Implement default-off real composition and repository-level fences. Keep document upload/OCR/social/LLM adapters as explicit unavailable contracts; no fabricated processing.
- [ ] GREEN focused tests and relevant build/type/lint; independent adversarial review and fix findings.

### Task4: Reviewable delivery

- [ ] Stage all new files before exact scope/inventory checks. Register only reviewed migration/schema/table/route/flag changes with negative probes and provenance.
- [ ] Run focused acceptance, package/test types, formatting/lint/diff; record genuine staging limitation rather than claiming live evidence.
- [ ] Commit clean source and run final branch gate once, preserving detailed logs. Diagnose new failures, do not blindly repeat.
- [ ] Push this branch and create a draft PR against codex/phase1-owner-plan-20261023 so only the new increment appears. No merge/deploy/provider activation.
