# Payer Receipt Capture Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans. One writer, no nested agents.

**Goal:** Capture a payer's receipt email and bind it to the purchase without OTP or a consent entrance gate.
**Architecture:** Existing session/CSRF authenticates capture. Dedicated authenticated
encryption protects contact; serializable order transaction enforces immutable
selection. Existing worker privacy cycle removes expired ciphertext.
**Tech Stack:** Node24, pnpm11.9.0, TypeScript, hand-authored SQL, PostgreSQL17.5.
**Spec:** docs/superpowers/implementation-artifacts/spec-payer-receipt-capture.md

## Global Constraints

Existing accepted DEC-PLT-004 authority; preserve old consent-bound source.
No provider/production calls, OTP, fake verification or historical payer inference.
No generation of migrations, dependencies or repeated/exhausted tests.
Five new files: authorRED1/GREEN2, coordinator3; strict single-file invocations.
Retention configured explicitly1..400days, no deployment default.

## Review Focus

- Bearer route cannot bypass receipt requirement enforced in browser.
- Legacy order replay cannot bind a new payer/contact or call a real provider.
- Concurrent cleanup and checkout serialize without releasing erased contact.
- Quote/payer/key substitution cannot decrypt another capture.
- Lost capture/checkout responses preserve command identity; logout clears plaintext.

## Task 1: Connected capture and selection

- [ ] Inspect named seams and preflight. Write five test files from spec before
  implementation, including every review-focus case and strict config/raw JSON.
- [ ] Typecheck test harness; run each RED1 separately, recording precise cause.
- [ ] Add schema/migration0050 after numbering check, explicit metadata/state
  artifacts per repository rules. Enforce immutable capture metadata and narrow
  ciphertext redaction, quote/payer/order relationships and idempotent identities.
- [ ] Implement dedicated AES256GCM vault and source with authoritative AAD;
  define narrow export types beside implementation, maintain dependency direction.
- [ ] Implement repository capture/replay and receipt-required order entry point.
  Validate before financial writes; bind in same transaction, preserve original
  contact on replay, conflict on changed selection. Keep legacy path isolated.
- [ ] Add explicit configuration and API composition, both checkout route families,
  capture endpoint and browser input/capture workflow. Missing capability is
  unavailable, never fallback. No plaintext persistence outside encrypted row.
- [ ] Wire redactExpiredBatch(100) into existing privacy cycle independently of
  capture activation/key state; test redaction and binding concurrency using realDB.
- [ ] Build affected packages sequentially; run each GREEN2 once, focused types,
  scoped lint/format/diff. No old suite or real external request.
- [ ] Report stable handoff for independent review; reserve every final3 and
  coordinator commit. List unperformed migration/live/release checks explicitly.

This connected increment does not implement provider payment POST/webhook wiring
or claim commercial release readiness. It removes a concrete prerequisite without
changing financial rules or substituting fake paid outcomes.
