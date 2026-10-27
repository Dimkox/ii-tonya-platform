# Booking notification HTTP transport — local evidence

Scope: new isolated T4 module and focused test, baseline690797db. No shared
exports/DB/runtime/flags changed. Real catalogue remains empty; no live send.
Plan: docs/superpowers/plans/2026-10-12-booking-notification-transport.md.

Environment check passed Node24.21.0/pnpm11.9.0. Official Telegram sendMessage and
ResponseParameters documentation checked; real message responses bind private chat
and bot identity. All exercised responses and credentials are synthetic.

New logical file `packages/integrations/src/telegram/booking-notification-transport.test.ts`:

- Run1,17:03:15UTC:23failed/27passed of50, behavioral RED against compiling
  unknown-result scaffold; no import failure. Rejection cases passing on scaffold
  are not independently observed RED.
- Run2,17:04:00UTC:50/50GREEN,610ms total. Budget2/3, reserve final run for review.
- Integrations typecheck and scoped ESLint passed. Tests typecheck found a
  test-only exactOptionalPropertyTypes error in captured RequestInit; corrected
  its declaration without runtime changes. Follow-up test typecheck pending.
- Prettier formatted both files; git diff --check passed after implementation.

Coverage includes fixed endpoint/body/one-call behavior, token/input validation,
callback-only keyboard, bot/private-chat/message binding, status/body disagreement,
400/401/403 rejection, full429delay, failure phase, body-phase ambiguity, safe errors,
valid JSON at64KiB boundary, declared oversize, malformedUTF8 and stalled fetch/body.

Independent reviewer Averroes01a13112-b6ed-71a2-8639-edf865095328 completed.
Accepted findings: missing pause signal on bot mismatch; malformedUTF8 fixture
also invalidJSON; URL-button fixture also wrong cardinality. All three addressed.
New regression failed as expected in run3 at17:06:26UTC(1failed/50passed).
Bot mismatch now returns unknown with bot_mismatch and pauseBot:true, never
not_applied. UTF8 fixture now corrupts an in-string byte of a valid success
envelope; forbiddenURL is added to an otherwise valid two-button keyboard.
Run4 at17:06:43UTC:51/51GREEN,622ms total. See plan's explicit budget ruling:
one extra single-file HTTP unit invocation, no PG/concurrency/full-suite cap
changed. This does not authorize further runs of any exhausted existing file.
The earlier test-only type correction passed its follow-up typecheck.
After the final fix: integrations typecheck, tests typecheck and scoped ESLint
each exited0. Prettier formatted both files and git diff --check exited0.
No full suite was repeated; whole-product/combined-RC evidence is still absent.

This module is not wired into the worker and does not grant admission. T2 fixes,
T3 callbacks, exact wire-digest binding, actual runtime composition, full-scenario
verification and release/rollback evidence remain required. No product acceptance.
