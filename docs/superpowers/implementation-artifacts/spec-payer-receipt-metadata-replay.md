---
title: Receipt-free replay of an admitted expert payment
type: bugfix
created: 2026-10-14
status: in-review
baseline_commit: 821996cf09cb8149648f9d925694041bad386f08
review_loop_iteration: 0
context:
  - "{project-root}/AGENTS.md"
  - "{project-root}/docs/agents/expert-residency-team.md"
---

<frozen-after-approval reason="existing approved payment replay requirement">

## Intent

**Problem:** Replaying an immutable expert purchase currently decrypts its receipt contact twice, even when the payment already has a provider ID. Expiry, redaction or an unavailable key therefore blocks an otherwise valid read-only payment check.

**Approach:** Separate retained receipt authority metadata from contact disclosure. Use exact order/contact binding and the existing request digest for replay. Read plaintext only for a newly admitted initial send. This implements the bound-replay requirement already in the API payment composition specification; it does not approve a new first-disclosure race policy.

## Boundaries & Constraints

**Always:** Preserve user/expert eligibility, original quote ownership, exact receipt selection, immutable financial values, command identity and the byte-compatible `yookassa-request-authority-v1` digest. A bound payment uses GET only and still checks provider ID, order ID, amount, currency, mode and HTTPS confirmation. An existing unbound admission remains unknown: no contact read and no second POST. Fresh orders and initial disclosure still require a valid, decryptable contact. Metadata is an opaque internal identity, not proof of consent, email verification or permission to disclose expired data. All failures remain sanitized.

**Ask First:** Any change to first-disclosure authority following deletion, pricing, consent, money movement or production activation. These are outside this fix.

**Never:** Add a migration, recover plaintext from a digest, persist new receipt copies, use a legacy consent source when a payer metadata lookup fails, activate payments, call real providers, run old exhausted tests, change shared history or claim full checkout/CI completion.

## I/O & Edge-Case Matrix

| Scenario               | Input / State                                                                                             | Expected Output / Behavior                                   | Error Handling                  |
| ---------------------- | --------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ | ------------------------------- |
| Bound replay           | Exact order, admission and provider ID; contact redacted/expired or key unavailable                       | Exact prior order and GET-verified checkout; no decrypt/POST | Provider mismatch fails closed  |
| Unbound replay         | Existing admitted operation without provider ID                                                           | Unknown outcome; no contact read or POST                     | Existing safe unknown error     |
| Fresh initial send     | Metadata present, live matching contact, new admission                                                    | One initial POST after admission; unchanged digest           | Existing failure classification |
| Disclosure unavailable | Newly admitted operation; contact absent, invalid or authority changed                                    | No POST, no automatic resend                                 | Unknown consumed admission      |
| Wrong selection/owner  | Other contact, quote, user, reassigned expert, or absent binding                                          | No access to original purchase                               | Existing domain error           |
| Metadata unavailable   | Missing/malformed order, legacy unbound order, repository error or absent metadata reader on payer source | No metadata, no legacy fallback or provider call             | Sanitized unavailable           |
| Legacy consumer        | Explicit pre-existing contact-only source, not payer wrapper                                              | Existing legacy behavior remains                             | No new bypass                   |

</frozen-after-approval>

## Code Map

- `packages/db/src/repositories/payer-receipt-contact-repository.ts`: currently joins exact order/quote/contact/user binding then opens the vault. Add a metadata-only query with no ciphertext selection or vault dependency. Migration0050 retains immutable kind/identity after redaction and protects composite FKs.
- `packages/db/src/repositories/expert-campaign-order-repository.ts`: prior-order branch already checks active verified owner, quote ownership and selected contact ID. Remove only its live-contact reauthorization, not fresh-order selection.
- `packages/integrations/src/yookassa/operation-port.ts`, `payer-receipt-source.ts`, `payment-adapter.ts`, `packages/integrations/src/index.ts`: optional legacy-compatible authority capability, strict payer wrapper, metadata-first admission and post-admission matching contact for fresh sends. Refund behavior stays unchanged.
- `tests/integration/payer-receipt-capture.test.ts`: old expiry-race assertion expects replay denial; update only that assertion for the intentional contract change, do not execute this exhausted file.

## Tasks & Acceptance

**Execution:**

- [x] Add regression tests in `tests/integration/payer-receipt-replay.test.ts` and `packages/integrations/src/yookassa/receipt-metadata-replay.test.ts`; record RED before product edits.
- [x] Implement the above owned source changes, preserving first-send admission and all unrelated workflows.
- [x] Update the single obsolete capture-test assertion; record it as modified but unrun.
- [ ] Correct reviewed malformed-contact and bookkeeping-error paths, and cover credited/overdue and uncertain-admission replay.
- [ ] Record focused results, compatibility evidence, independent review, limitations and rollback in `docs/test-evidence/payer-receipt-replay-2026-10-14.md`.

**Acceptance Criteria:**

- Real isolated PostgreSQL17.5 tests prove metadata survives redaction without vault access, exact order replay preserves financial state, and a changed owner/selection cannot replay.
- Adapter tests pin old/new metadata digest compatibility and prove zero plaintext read/POST for existing operations, null/throwing payer reader and provider mismatches.
- A genuine first-send test checks ordering and matching authority; legacy contact-only behavior remains explicit. No production activity is necessary.

## Spec Change Log

- 2026-10-14: Independent review of054ee692 found two disclosure error-path defects and gaps in credit/expiry/uncertain-admission coverage. Add value validation and preserve the sanitized unknown outcome when status bookkeeping fails. Add coverage of existing credit expiry semantics, not new financial policy. KEEP metadata-only bound GET, the original digest/UUID, strict payer-source failure, original ownership checks and legacy/refund behavior. Adapter run3 is review RED; an extra GREEN run needs pending owner approval. PG final3 remains reserved.

## Design Notes

Expose optional `receiptAuthorityForOrder(orderId)` returning `{contactKind: "email" | "phone", authorityReference: string} | null` on the existing contact port. The payer wrapper always exposes it and returns null if missing, without falling back to plaintext. Legacy sources without the capability can keep their current contact-derived authority. For newly admitted payer requests, compare the contact's derived identity with the retained metadata before creating the existing request. Keep digest property order unchanged.

Replay does not override the pre-existing order deadline: an overdue order still returns `expired` and releases its reserved credit exactly once through `expireLockedExpertResidencyOrder`. The exact-prior-order comparison applies before that deadline; a missing contact must not suppress existing expiry processing. This clarifies the unchanged financial-authority constraint, not a new price or retention decision.

## Verification

Work only in `.worktrees/review-2a3484e6-20261013`, branch `codex/receipt-metadata-replay-20261014`. Main coordinator checkout has unrelated changes. Sequential implementation by one owner; no remote operations. Technical execution checkpoints are delegated by the owner; unresolved business decisions are not.

Each new focused file has at most three runs: implementer RED1/GREEN2, coordinator final3 reserved. Record invocation and exit immediately. No full suite, multi-path suite or old-file rerun. If a run fails for setup, it still consumes a slot; stop rather than evade the cap. Use `II_TONYA_TEST_POSTGRES_ADMIN_URL=postgresql://ii_tonya:local-placeholder-only@192.168.128.2:5432/ii_tonya` for the task-owned Docker Compose PostgreSQL17.5 instance; the testkit creates isolated child databases. This URL is synthetic, not a credential from an env file. Host-side read-only connection already confirmed server_version_num170005. Run relevant package builds/typechecks, tests typecheck, scoped lint/format and `git diff --check`. Independent reviewer is read-only and must not rerun tests. No hosted CI exists here. Do not spawn agents; report to the coordinator in the evidence file and commit only owned files, then return the commit, focused results and remaining risks. Coordinator handles independent review and reserved final3.

## Current Checkpoint

Source31e947da passed scoped independent fix review. PostgreSQL final3 passed21/21 at16:38:59UTC; its budget is exhausted and the synthetic Compose instance has been removed. Adapter run3 was review RED before the fixes (23failed/45passed); a fourth post-fix run still needs the owner's unanswered explicit approval. Therefore this spec remains `in-review`, not done. No full workflow, hosted CI, paid-provider or production acceptance is claimed. Recovery and exact hashes are in the evidence file.

## Suggested Review Order

- Start with metadata admission and the GET-versus-disclosure split.
  [payment-adapter.ts:125](../../../packages/integrations/src/yookassa/payment-adapter.ts#L125)
- Check retained identity without ciphertext access.
  [payer-receipt-contact-repository.ts:181](../../../packages/db/src/repositories/payer-receipt-contact-repository.ts#L181)
- Verify original ownership, selected contact and unchanged expiry authority.
  [expert-campaign-order-repository.ts:145](../../../packages/db/src/repositories/expert-campaign-order-repository.ts#L145)
- Review credited replay, exactly-once release and durable uncertainty coverage.
  [payer-receipt-replay.test.ts:321](../../../tests/integration/payer-receipt-replay.test.ts#L321)
- Inspect disclosure regressions; post-fix adapter execution remains pending.
  [receipt-metadata-replay.test.ts:341](../../../packages/integrations/src/yookassa/receipt-metadata-replay.test.ts#L341)
