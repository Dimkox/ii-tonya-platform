# Payer Receipt Replay Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Reconcile an already admitted payment without opening its retained receipt contact.

**Architecture:** Retained opaque authority supplies the existing digest. Initial admission decides GET-only replay versus first send. Only a fresh send reads a live contact; the payer wrapper cannot fall back to legacy authority.

**Tech Stack:** Node24, pnpm11.9.0, TypeScript, Drizzle SQL, PostgreSQL17.5, Vitest.

**Spec:** `docs/superpowers/implementation-artifacts/spec-payer-receipt-metadata-replay.md`

## Global Constraints

- No migrations, production changes, real providers, new receipt storage or changed financial authority.
- Preserve `yookassa-request-authority-v1` property order and command identity.
- New focused files: maximum RED1/GREEN2/final3. Old suites exhausted, not rerun.
- First-disclosure race policy remains outside this fix; full API checkout is not completed by it.

## Review Focus

- A payer reader exposing no metadata capability must not trigger plaintext fallback.
- A reused contact/owner must not inherit another purchase even after expert reassignment.
- Identity mismatch after admission must not send or reopen admission for another attempt.
- Missing vault must permit metadata replay but must not permit a fresh purchase.
- Changed provider amount/mode/order/ID/confirmation must fail despite a locally bound operation.

## Task 1: Retained receipt authority and safe replay

**Files:** Exactly the source/test/evidence files in the spec Code Map and Tasks.

**Interfaces:** Optional `receiptAuthorityForOrder(orderId: string): Promise<{ contactKind: "email" | "phone"; authorityReference: string } | null>` on the existing port; the payer source always exports this capability. Existing contact method and refunds remain unchanged.

- [x] Write the two new focused files. Assert redacted metadata lookup, unchanged replayed financial state, zero decrypt/POST on bound and unbound replay, exact digest compatibility, first-send contact matching, wrong-owner/selection denial and strict payer-source failure.
- [x] Run each file once, separately. Expected RED: contact-free replay is unavailable/rejected, not an import/setup failure. Record results immediately.
- [x] Implement metadata query, strict wrapper and adapter ordering. Remove only the prior-order live-contact check. Align the old expiry-replay assertion without executing that exhausted file.
- [x] Run each new file once more, separately. Expected GREEN with no skipped tests. Reserve third runs for coordinator final verification after review.
- [x] Run relevant builds/typechecks, scoped lint/format and whitespace checks. Record source hashes and limitations.
- [ ] Obtain independent review, triage findings, then coordinator runs reserved final3. Never substitute a copied/renamed old test.
- [ ] Commit the bounded fix and evidence. RC publication remains a separate owner-authorized coordinator action; no payment flag or app deployment follows from this task.

## Review correction checkpoint

Source054ee692 passed GREEN2, adapter36/36 and PG15/15. These steps must not be replayed. Independent review found malformed disclosure and unsanitized bookkeeping failure. Adapter run3 is reassigned to review RED, before either production fix. A fourth adapter run requires the owner's pending explicit approval. PostgreSQL final3 remains reserved. See the evidence ledger for authoritative counters.

Add focused coverage for nonzero reserved credit and its existing exactly-once expiry release; preserve the existing overdue-order behavior. Strengthen actual persisted admission/attempt snapshots and lost-ack replay tests without changing their authority. No terminal-bound payment redesign is included.
