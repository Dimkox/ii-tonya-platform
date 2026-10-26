# Core stabilization independent review — 2026-10-26

Reviewed exact candidate: `390613bc72cf51cd450404cc3f9492198d26ea87`.
Product implementation: `349fc51cddf4570e3f37de68012d280c0941d5bb`.
Base: `567e71b4dea4bd2720da452c8049916f9d2b437c`.
Three fresh context-free reviewers were launched before collection: blind hunter,
edge-case hunter and verification-gap reviewer. All returned read-only findings;
no reviewer fixed source. Complete diff was retained locally for reproduction.

## Coordinator triage

All entries below are concrete same-intent patches, not a new product/specification
loop. No wholesale re-derivation or user approval is required. Duplicates were
combined only when they share both claim and required action. The blind reviewer
reported12 items; edge reviewer independently confirmed handoff durability and
callback acknowledgement; gap reviewer added actual pagination traversal evidence.

| ID  | Consequence | Accepted finding and bounded fix                                                                                                                                       |
| --- | ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R1  | High        | Notification discloses an uncommitted handoff. Commit token before disclosure; immediate independent visibility/redemption and post-send DB-failure acceptance.        |
| R2  | Medium      | Preparing a notification invalidates an existing interactive handoff even when no send happens. Preserve the prior usable link; keep explicit owner-request semantics. |
| R3  | Medium      | Unknown/crash-before-send recovery is undocumented. Real current-owner handoff recovery, no automatic unknown→pending reset or blind retry.                            |
| R4  | Medium      | Informational access view misses archive-until parity. Add the same archive predicate as actual activation and prove both archive cases.                               |
| R5  | Medium      | New tag callbacks are never acknowledged. Wire trusted answerCallbackQuery through normal composition; check original callback/bot scope.                              |
| R6  | Medium      | UI revision precheck masks a stored successful replay. Exact scoped duplicate must remain duplicate; fresh stale/conflicting requests deny.                            |
| R7  | Medium      | Page100 can render101/21. Bound/clamp against actual pages and use canonical returned page; handle empty catalogue.                                                    |
| R8  | Medium      | Pagination tests never traverse beyond page0. Actual Fastify next/later selection/reload/last/back acceptance must detect offset/navigation mutations.                 |
| R9  | Medium      | Selected inactive tags are hidden, cannot be removed and consume the20limit. Reachable removal/replacement while preventing inactive additions.                        |
| R10 | Medium      | Exact XML byte scanning misses valid external relationships with quote/spacing variants. Safe bounded attribute parsing with no DTD/entity/network resolution.         |
| R11 | Medium      | Direct extract tests do not prove main's actual resource limits. Bounded subprocess acceptance of the real limit setup and termination/output.                         |
| R12 | Medium      | Documentation overclaims no filesystem writes from FSIZE0. State actual file-growth/core limits and lack of filesystem sandbox; bounded demonstration.                 |
| R13 | Medium      | Concurrent notification claims lack actual independent-connection acceptance. One send/attempt and consistent durable terminal state.                                  |

The same implementer received one complete remediation batch. Egress consent locks
must remain intact: an immediate redemption probe must not await the same lock
inside the notifier and create a test deadlock. Prove committed visibility, start
redemption, let the send transaction end, then await valid redemption. No privacy
barrier may be removed to satisfy the fixture.

Status: remediation in progress. Closure will inspect only these accepted findings
and their required consequences, without imposing another discovery quota.

## Remediation candidate

Same implementer committed `72e133b57912badb8b67789f6660fcc9dcc1f9c6` against the
reviewed candidate. Root inspected exact final PG log:17/17, no skips, plus
Python12/12 output. Remediation evidence records actual RED5failed/2passed to
GREEN7/7 for new PG cases, external-XML RED4failures to Python12/12, and the
narrow foreign-replay ACK correction. Normal ACK composition10/10, affected
units/builds/package and full-test types/lint/format/diff are recorded passing.
No active implementer/check process remains. Lossless evidence now contains119
logs with raw/compressed SHA manifests; this is not staging or provider evidence.

Status: bounded independent closure pending on R1–R13 only, then canonical final
gate and authorized draft PR. No new discovery quota or wholesale rewrite.
