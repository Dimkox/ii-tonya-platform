# Phase2 local implementation evidence — 2026-10-23

Contract: `docs/superpowers/implementation-artifacts/spec-phase2-preparation.md`.
Baseline: `552b40dd3aceb7b00479ff9d7bff7ef11ee6281b`. Local acceptance only;
no provider call, activation, push, release or new client web interface.

## Slot authority

Existing protected choice/hold/capacity/overlap/idempotency backend is reused.
The new focused `tests/integration/phase2-slot-clock.test.ts` held choice/request
rows without mutating them, observed the actual later row-lock wait while TTL
was valid, crossed real PostgreSQL expiry, then released. RED1 reproduced both
stale-clock admissions and reservation/receipt/audit/outbox writes; message and
expert referral ledgers remained unchanged. Log `/tmp/phase2-slot-clock-red1.log`,
EXIT1,2 failed,20.21s.

The protected path now samples database time after the blocking locks and checks
owner/state/choice and request expiry/raw slot freshness/lead/deadline at SQL
precision. Generic explicit-time callers and historical receipt replay retain
existing semantics. GREEN2 EXIT0,2/2,9.61s,
`/tmp/phase2-slot-clock-green2.log`. The existing bounded async drain helper tracks
setup and bodies. Independent read-only review accepted both source and fixture.
No settled financial history, test clock or production TTL was changed.

## Private client reads

`coupons_balance` is a decimal string of kopecks from unexpired actual client coupon
grants joined to canonical paid settlements and the owning order, filtered by
reviewed server test/live mode. It is distinct from message package units and
expert referral points/money. No spend ledger or redemption guarantee is invented.
Orders use bounded opaque owner cursors; reservations reuse the existing owner
booking query. Identity/current consent barriers, projection and numeric-bot/update
receipt share one transaction. Constructor/event/query snapshots prevent caller
mutation across awaits. Known financial commands, including invalid mentions,
never fall through to LLM/message debit even when disabled or unavailable.

Focused source checks: service12,config11,DBdriver4 (including mutation RED→GREEN),
composition2,actual disabled-route4 and normal app/server wiring3 PASS. Wiring
initial RED2 demonstrated missing capability enforcement/composition. Two later
fixture corrections used a valid synthetic token and the dedicated client route;
final `/tmp/phase2-client-wiring-green3.log`2/2 PASS. No production scope relaxation.
Root independent review accepted ownership/provenance/mode/exact total/snapshots/
receipt transaction/no-fallback; date replies explicitly use МСК.

Independent wiring review additionally found empty manual receiving secrets could
pass equality checks. New focused negative preflight RED and six config RED cases
proved the issue; shared enabled assertion now requires the existing URL-safe
32–256 character non-placeholder secret at loading/preflight/buildApp. Config11,
composition2 and normal wiring3 PASS after correction; source rereview accepted.
Log `/tmp/phase2-client-secret-green.log`. The wiring file ran six times total:
initial2RED, two fixture failures,2GREEN, new secret1RED/2PASS, final3GREEN;
all attempts retained rather than counted as uninterrupted success.

Integrated PostgreSQL acceptance: first invocation EXIT0,8/8 PASS on isolated
PostgreSQL17.5, lead29407; `/tmp/phase2-client-account-pg1.log`, started19:55:13UTC,
11.99s total/7.39s cases. No retry or functional probe followed. Its actual
canonical fixed-package amounts are below Number.MAX_SAFE_INTEGER; it proves
uncapped exact decimal totals beyond the detail page, not an above-safe-integer
financial magnitude. Source uses PostgreSQL numeric::text and BigInt without a
Number conversion for coupon totals.

Protocol compatibility: recognized unsafe/unsupported account command contexts
return bounded HTTP400 `invalid_account_query`, while unavailable owner data returns
a protected generic reply and transient projection errors503. HTTP400 can cause
Telegram retries; these never reach LLM/debit or expose data. Changing that ACK
policy is not claimed here. Malformed wire update IDs remain400.

## Inactive connectors and static gates

See `phase2-inactive-connectors-2026-10-23.md` for primary official protocol sources.
Pure VK/MAX request builders and strict untrusted acknowledgement parsers are
concrete; all runtime send/webhook entrypoints remain unconditionally disabled,
reject before reading caller fields and perform zero I/O. No credentials, SDK,
new dependencies, env activation or TLS changes. VK23/MAX26 plus disabled4 each
PASS. Independent review accepted source; stale MAX comment corrected without
an unchanged test rerun. Integrations normal ESM/DTS build and source types/lint/
format/diff PASS.

RequireDocker preflight PASS Node24.22.0/pnpm11.9.0/owned PostgreSQL17.5 Compose.
Protected rotated synthetic configuration was read in memory only; no values were
printed or committed. DB normal final ESM/DTS build PASS. No new SQL migration or
state reconstruction was needed. Full tests TypeScript, final scoped lint/format/diff and independent source/fixture
reviews PASS. API normal ESM/DTS build PASS. The coordinator owns the single final
branch gate after this local checkpoint; no aggregate run is claimed here.

External strict first-send custody, approved content, live merchant/webhook facts,
processor/backup erasure and release checks remain separate/default-off.
