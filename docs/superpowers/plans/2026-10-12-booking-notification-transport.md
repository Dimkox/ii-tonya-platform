# Booking notification HTTP transport implementation plan

Coordinator-owned T4 transport subtask, executing inline with TDD. Parent spec:
`docs/superpowers/implementation-artifacts/spec-booking-notification-delivery.md`.
T2 DB fixes remain Tesla-owned. No exports, DB, API, worker or flag changes here.
Goal: actual bounded HTTP send with receipt binding; not product delivery acceptance.

## Contract

Create `packages/integrations/src/telegram/booking-notification-transport.ts` and
same-name test. Factory `createBookingNotificationTransport({botKey,token,fetch?})`
returns `send({botKey,chatId,text,replyMarkup?,deadline})`. Native fetch is default;
injection is for synthetic tests. Request is already authorized by the future
runner; this module does not replace ledger admission or confer send authority.
Return applied+receipt(botKey/chatId/messageId), not_applied(retryAfterSeconds?),
failed(reasonCode,pauseBot), or unknown(reasonCode). Never return raw errors/URLs.

Fixed HTTPS api.telegram.org token endpoint, redirect:error, no retries or logging.
Maximum15seconds including body, additionally bounded by admitted deadline;
64KiB decoded stream, fatal UTF8. Strict positive safe numeric private chat ID,
text1–4096 well-formed UTF16, optional exactly two ct2 callback buttons. No parse
mode, arbitrary links/buttons or token override. Validate config before any call.
Success: HTTP200, ok:true, positive safe message ID, matching private chat and
token-prefix bot identity in from.id with is_bot:true. Valid400/403 rejection is
failed;401 pauses bot;429 preserves full nonnegative integer retry_after up to
2147483647seconds. Mismatched status/body, redirects,5xx,408, stalled/malformed/
oversized body and ordinary thrown network errors are unknown, never retried.
Only TransportFailure before_write thrown by fetch before a Response is available
can be not_applied. A body-read exception cannot retroactively prove non-delivery.

Official contract checked2026-10-12:
https://core.telegram.org/bots/api#sendmessage and #responseparameters.
Size/deadline and stricter receipt binding are application constraints.

## Steps and verification

- [x] Write genuine behavioral assertions and compiling rejecting scaffold.
- [x] Run this new logical test file once: observed behavioral RED, not import failure.
- [x] Implement transport; run same file once: observed50/50GREEN.
- [x] Scoped types/lint/format/diff and independent review; reviewed correction
      subsequently verified RED→GREEN51/51 under the budget ruling below.

Review focus: status/body disagreement; wrong bot/chat; body error versus before-write;
valid JSON at response-size boundaries; deadline during stream;429 greater than60s.
No live send, real credentials, full suite, commit/push/deploy. Existing budgets unchanged.
Ruling: native implementation of isolated transport proceeds while T2 agent fixes
disjoint files, avoiding idle critical-path time; cross-task composition stays gated.
Cost if interface needs adjustment: local transport/runner adaptation, no live effects.

Review ruling: this isolated HTTP unit file uses run3 for observed regression RED
and run4 for final GREEN, revising this plan's self-imposed three-run target.
AGENTS.md caps PostgreSQL/concurrency files at3 and full/multi-path commands at1;
this file has neither database nor concurrent-worker tests and each invocation
is single-file. No repository cap or previously exhausted file is bypassed. Do
not generalize this local budget decision to T2 or other pending test exceptions.
Reason: prove the reviewed bot-pause defect before fixing it. Cost: one extra
synthetic unit invocation, zero provider calls. No pnpm test:repeat is used.
