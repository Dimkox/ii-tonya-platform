# Separated sales independent review

Candidate: `8233da05a45e2f5d7b4c9491bf7877b79ca760dc`.
Baseline: `66cb3fd5d2bf18ce3da29d3cca17cbe39ab8aa7b`.
Three context-free, same-capability read-only reviewers inspected the complete diff
and surrounding call paths. No reviewer edited source or ran tests. Findings below
are coordinator-triaged; approval is pending remediation and bounded closure.
The owner authorizes coherent repairs without destructive re-derivation or routine
approval loops. All findings are resolvable from the existing approved intent.

| ID  | Severity / route | Evidence and required correction                                                                                                                                                                                                                                                                                                                                                            |
| --- | ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R1  | high / patch     | Held checkout requires a receipt contact at expert-held-onboarding-repository.ts:98, but the applicant flow cannot capture one; ordinary browser capture requires verified expert identity. Add a private owner/consent-bound applicant capture step using encrypted custody, with normal-ingress acceptance.                                                                               |
| R2  | high / patch     | The original bridge quote expires after at most24h; receipt redaction and capture guards then make later approval/replacement impossible. Bind receipt custody to valid versioned fee authority, preserving finite retention and current consent, and verify approval/reissue beyond24h.                                                                                                    |
| R3  | high / patch     | Migration0059:325/128 and settlement compare mutable form revision to immutable submitted revision. Normal follow-up increments revision without changing submitted facts. Validate genuine frozen submission identity/digest and erasure separately; do not reject valid follow-ups or readmit deleted forms.                                                                              |
| R4  | high / patch     | expert-verification-repository.ts:301 restricts latest selection to original choice. Quarter expiry and explicit month before first approval fails. Bind current explicit selection of the same approved owner/form/base.                                                                                                                                                                   |
| R5  | high / patch     | expert-separated-sales-repository.ts:321 bridges stale monthly selections before scheduler refresh, producing expires_at<=quoted_at and rolling back form submit. Resolve expiry at the transactional ingress; never silently convert unavailable quarters.                                                                                                                                 |
| R6  | high / patch     | Unknown create with no stored provider ID cannot be reached by worker/webhook recovery; only tests invoke reconcile(invoiceId,paymentId). Add fresh-authority, audited operator recovery with GET binding proof and no blind POST.                                                                                                                                                          |
| R7  | high / patch     | Scheduler:99–115 bypasses unresolved-request protection when commercial expiry fires; invoice guard throws and aborts unrelated owners/delivery. Skip unsafe replacements and isolate candidate failures while preserving durable uncertainty.                                                                                                                                              |
| R8  | high / patch     | Held reconciliation:298 leaves unknown capture dispatched after authoritative canceled GET. Resolve terminal-proven operations without claiming successful capture, and permit valid replacement.                                                                                                                                                                                           |
| R9  | high / patch     | Scheduler:142 claims dispatched before recoverCheckout preparation; a definitely-unsent error permanently loses notice. Distinguish preparation/retry from begun delivery uncertainty, retaining concurrency fences.                                                                                                                                                                        |
| R10 | medium / patch   | Scheduler:171 treats old refresh/reselect notices as current even after monthly reselection. Bind and recheck producing selection/state; cancel superseded work.                                                                                                                                                                                                                            |
| R11 | medium / patch   | Scheduler and fee helper both insert replacement notices with different timestamps. One replacement must yield one durable notice.                                                                                                                                                                                                                                                          |
| R12 | medium / patch   | New sales service delegates to old pre-price form copy at resident-verification-service.ts:169/242. Version actual runtime messages for sales-first, keeping legacy text unchanged.                                                                                                                                                                                                         |
| R13 | high / patch     | Verification gaps: lost capture/cancel acknowledgments, real waiting/canceled Fastify webhook with held capability, and actual worker Telegram receipt parsing lack coverage. Add bounded local transport fault cases and normal composition checks; foreign bot/chat must never become delivered.                                                                                          |
| R14 | medium / patch   | Coordinator acceptance: current-tariff form response omits remaining time and active link, while scheduler notices omit exact current/new main amount and deadline. Render actual current owner terms/deadline and eligible fixed-fee link; never leak promotion before positive response or invoice before approval. Provide the requested current-tariff action without manual repricing. |

Blind review supplied10 reachable findings, edge review4 (three overlapping),
verification-gap review3 distinct missing consumer proofs. R14 is the coordinator's
explicit owner-copy acceptance check. No speculative policy expansion or live
activation follows. Existing passing legacy/financial/privacy behavior must survive.

## Bounded closure at425b58ee

All three original reviewers independently inspected the correction source and
retained evidence without rerunning tests. Blind reviewer PASS:R1,R2,R6,R9,R10,
R11,R12,R14. Verification reviewer PASS:R13, including all three actual consumer
proofs. Edge reviewer PASS:R4,R5,R7,R8. Archives inspected by the reviewers match
manifest lengths/digests. State32/32, composition4/4, form17/17, upgrade1/1 and
legacy receipt4 passed/4 explicitly skipped are evidence, not live activation.

R3 remains open for one real0059 upgrade ordering: submit→followup→enter v3 stores
current mutable revision in the old bridge, while submission work retains the
original revision.0060 backfills digest/time but not that revision; valid() then
rejects the legitimate existing bridge. The original upgrade fixture tests the
reverse ordering. Required narrow correction: backfill the original revision from
genuine same-owner submission work and execute both orderings plus erasure through
actual0059→0060 replay. The implementer received only this bounded correction;
no new broad review or source re-derivation was requested.

## Final independent closure

R3 PASS at `8bd15f1fe48ef0f5eac909efcf630c7e28879348`: the original edge reviewer
verified the same-owner submission-work backfill and actual0059→0060 test covering
both follow-up orderings plus erasure. Retained RED reproduces the defect; GREEN
passes1/1. No tests were rerun by reviewers. All R1–R14 are now closed; other
accepted runtime corrections are unchanged from425b58ee. Canonical final gate
and delivery remain coordinator work, not implied by review acceptance.
