# Client Async Telegram Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. Execute sequentially.

**Goal:** Deliver admitted client replies through ordinary worker composition.
**Architecture:** Fixed bot-bound HTTP transport feeds existing dispatcher and
ordered DB runner. PostgreSQL remains the consent/outcome authority.
**Tech Stack:** Node24, TypeScript, pnpm11.9.0, Vitest, PostgreSQL17.5.
**Spec:** docs/superpowers/implementation-artifacts/spec-client-async-production-telegram.md

## Global Constraints

No live requests or activation. Three genuinely new test files, author1/2 and
coordinator3. No old tests/full suites. Preserve all existing authority checks.

## Review Focus

- Valid-looking response for another bot/chat must remain unknown.
- HTTP429 with malformed/missing delay must not trigger a resend.
- Native fetch rejection must not become before-write proof.
- Failed DB acknowledgement after successful HTTP must not regenerate delivery.
- Same user on another bot or withdrawn consent must not gain admission.

## Task 1: Connected delivery transport and retry scheduling

- [ ] Add the three test files listed in the spec. Assert fixed URL/body, bounded
  stream/deadline, exact receipt identity and all five review-focus cases; include
  actual production factory default composition and real isolated DB admission.
- [ ] Typecheck tests before running each file RED1 separately. Record failures
  caused by missing behavior separately from harness/collection failures.
- [ ] Create createClientAsyncTelegramTransport in the new integrations module,
  returning existing TelegramTransport; inputs are configured token and optional
  fetch seam. Return only validated original Telegram responses.
- [ ] Create composeClientAsyncTelegram in the new worker composition module,
  returning existing ClientAsyncCapabilities.telegram or disabled result. Call it
  from the production factory before DB creation, preserve Selarti checks.
- [ ] Extend retryable DispatchOutcome with optional retryAfterMs; dispatcher
  maps validated429 delay and runner persists max(existingBackoff, providerDelay).
  Cover invalid delay/overflow and unchanged behavior without a delay.
- [ ] Build required packages sequentially, then run each new file GREEN2 once.
  Run affected typechecks, scoped lint/format and git diff --check.
- [ ] Hand off stable source/evidence to coordinator for independent review.
  Do not consume final3 or commit; coordinator handles review fixes and verification.

The one connected task is not complete until ordinary composition and real DB
admission are tested together. Controlled HTTP evidence is not live delivery proof.
