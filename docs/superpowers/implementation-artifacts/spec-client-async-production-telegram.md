---
title: Ordinary worker client Telegram delivery
type: feature
created: 2026-10-12
status: in-progress
baseline_commit: e532428d014806100893bcf33243d6e5b3c060c2
context: []
---

## Intent

Complete the ordinary worker's Telegram delivery composition so an admitted
client reply reaches the configured client bot without injecting a business
adapter. This is part of the owner's full commercial-product goal, not a
replacement for unfinished Selarti, payment or production verification.
Technical choices and execution are delegated by the owner. Preserve existing
authority and default-off controls. Implementer follows the accompanying plan
docs/superpowers/plans/2026-10-12-client-async-production-telegram.md.

## Boundaries

One implementer owns the file set below. No nested agents, provider/network
requests, remote operations, production flags, commits, pushes or installs.
Do not edit old exhausted tests or rename/copy them to reset allocations.
No migrations or new delivery ledger. Reuse committed dispatch admission and
ordered outbox machinery. Never disclose bot tokens, endpoint URLs, chat IDs,
message text, raw replies or network errors. No fallback to the expert bot.
Keep Selarti missing-capability rejection; this increment does not enable AI.

## Code Map and ownership

- New packages/integrations/src/telegram/client-async-transport.ts implements
  existing TelegramTransport port for plain sendMessage only; export through
  packages/integrations/src/index.ts.
- Read packages/integrations/src/telegram/booking-notification-transport.ts for
  bounded fetch and receipt checks. Do not reuse its callback/booking authority
  or narrower bot-key syntax. Do not fabricate response envelopes from outcomes.
- New apps/worker/src/client-async-composition.ts constructs transport and URL
  from configured client token and key. Permit raw fetch injection for tests.
- apps/worker/src/main.ts: resolve default capability before opening DB, preserve
  explicit trusted injection compatibility and feed existing async registry.
- packages/worker/src/telegram-send-text-dispatcher.ts and outbox-runner.ts:
  only extend validated retry delay propagation/scheduling. Preserve all existing
  payload/admission checks, unknown handling, lease/fencing and topic behavior.
- Read-only client-async-outbox.ts, runtime.ts, client-consent-authority.ts,
  ordered outbox repository and existing configuration field definitions.
- Validation can live in the new composition module; change env.ts only if
  genuinely required for the existing fields, with a documented reason.
- New tests only: packages/integrations/src/telegram/client-async-transport.test.ts,
  apps/worker/src/client-async-production-composition.test.ts,
  tests/integration/client-async-telegram-production.test.ts.
- Own docs/test-evidence/client-async-production-telegram-2026-10-12.md only.
  Coordinator owns shared status/runbooks. Escalate unexpected ownership needs.

## Tasks and acceptance

1. Build transport with fixed HTTPS api.telegram.org sendMessage URL from the
   configured token. Validate token-derived bot identity; reject foreign URLs,
   arbitrary headers, callback payloads or additional JSON fields before fetch.
   Wire body contains only chat_id/text. Use 15-second total deadline, bounded
   stream reading up to64KiB, redirect rejection and zero internal retries.
2. Accept success only for HTTP200/ok:true and valid positive message ID, matching
   token-derived sender bot ID, exact requested private-chat ID and bot sender.
   Preserve validated original response for existing dispatcher. Malformed,
   oversized, truncated, redirected, foreign or ambiguous responses throw a
   sanitized uncertainty error; they must not reach permissive dispatcher paths.
3. Proven rejection may be returned only as a validated Telegram error envelope
   whose error_code matches HTTP status. For429 require bounded valid integer
   retry_after; invalid/missing delays remain unknown, not immediate retry.
   Preserve explicit TransportFailure before_write only when genuinely supplied;
   native fetch rejection never proves nonapplication.
4. Carry retryAfterMs through the retryable outcome and schedule no earlier than
   provider delay while retaining existing jitter/minimum backoff. Reject unsafe
   delay values rather than overflowing dates. No sleeping in transport.
5. Enabled B2 delivery requires egress consent gate, client bot key and Telegram
   bot token. Disabled composition makes no request. Missing enabled credentials
   fail with sanitized readiness error before DB creation. Default composition
   uses no expert credentials and never activates hybrid routing or Selarti.
6. Retain existing recordAttemptStarted/consume admission sequence and exact
   payload binding. Unknown sends and crash-after-send cannot automatically
   resend; no claim of external exactly-once delivery or invented reconciliation.

Given ordinary production factory configuration and synthetic HTTP, when an
admitted committed client reply is claimed, then concrete transport sends it and
the real repository records its validated outcome without business-adapter injection.
Given two bots, wrong chat/bot receipt or withdrawn/regranted authority, when
delivery runs, then no foreign or unauthorized delivery is accepted.
Given valid429, when worker retries, then persisted next-attempt time respects
retry_after. Given crash/unknown result, when restarted, then no blind resend occurs.

## Verification

Read repository instructions and TDD skill completely. Preflight with RequireDocker
before PG checks. Write all new behavioral tests before implementation. For EACH
new file author owns RED1/GREEN2 and coordinator final3 after independent review.
Record sessions immediately including collection failures. Never run full suites,
multi-path tests or old tests in this increment. Types, scoped lint/format/diff
checks are allowed. Coordinate package builds so no concurrent dist races occur.
Use isolated existing synthetic PostgreSQL17.5 only; no production data/provider.
Ensure integration tests exercise actual admission, repository and transport, not
only mocked ports. Tests must cover wrong identity, duplicate invocation, shutdown
or timeout, invalid429, consent withdrawal/regrant, order and uncertain restart.
Stable handoff includes exact source hashes, results, allocation and limitations.
