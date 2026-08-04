# ии-Тоня Platform

Production-oriented implementation of the client and expert workflows described in the
authoritative ии-Тоня source document.

## Status

Pre-production. The client platform foundation is implemented, while live-provider,
staging, and production gates remain closed. The expert residency referral extension
has completed implementation tasks 1–9; its expert-facing API, Telegram/prompt adapters,
worker operations, final traceability, and release evidence (tasks 10–12) are still
pending. The authoritative checkpoint is `.superpowers/sdd/progress.md`.
Resume instructions and exact verification evidence are recorded in
`docs/handoffs/2026-08-04-expert-residency-referrals.md`.

## Authoritative source

- Snapshot: `docs/source/ii-tonya-expert-full-source-2026-07-28.txt`
- SHA-256: `0439AE1C645E6FDA46F013A66512401F251AA18D35520F5C9A7A3C7C59314EAF`
- Original Google Doc ID: `14AWYM9jbE0OPU3rKY6_PpPl3REDaqQbISdMB4D2mpUc`

The source contains product intent, prompts, pseudo-JSON, and repeated drafts. It is not
treated as executable Make configuration. `docs/spec/normalized-requirements.md` is the
implementation contract; the source remains the traceability baseline.

## System boundary

Selarti serves the client channel, Telegram serves the expert channel, and Planerka
provides scheduling integration. A transactional backend owns booking, billing, coupon,
consent, and audit state. Make and Google Sheets are limited to non-critical automation
and projections.

## Expert residency referral program

Expert referral codes are a separate product and persistence boundary from the existing
client coupon program. They must never share tables, balances, code namespaces, or
redemption paths with client coupons.

- An expert may invite another expert with an expert-only referral code.
- After the invited expert's first eligible residency payment settles, the inviter
  receives exactly 1,000 RUB (`100000` kopecks) of internal residency credit.
- Each reward grant expires exactly 365 days after it is granted.
- Credit may cover at most 50% of a residency tariff. The remaining amount is paid in
  money; a lower credit share is allowed when the spendable balance is insufficient.
- Credit allocation is FIFO by expiry. Settlement, expiry, refund, reversal, debt,
  idempotency, and abuse holds are owned by PostgreSQL transactions and append-only
  financial records, not by prompts, Telegram, Make, or Google Sheets.
- Expert codes are stored as non-reversible digests. Plaintext batch codes are returned
  once to an approved administrator; inventory exposes masked values only.
- Batch issuance, revocation, bounded quota overrides, tariffs, abuse holds, replay, and
  feature switches require authenticated approved admin workflows. Sensitive overrides
  require two distinct approvers.

Current durable implementation includes the domain rules, database schema and
migrations, referral lifecycle, residency quoting and checkout, provider-neutral
settlement/refund/reversal flows, disabled-by-default services and feature controls, and
approved admin workflows. See
`docs/superpowers/specs/2026-08-02-expert-residency-referrals-design.md` and
`docs/superpowers/plans/2026-08-03-expert-residency-referrals.md` for requirements and
the remaining task sequence.

## Safety boundary

No real client messages, bookings, balances, payments, or crisis workflows are enabled
until the staging contract tests and the documented go-live gates pass.

## Local verification and container evidence

Use Node 24 and pnpm 11.9.0. After installing the frozen dependency graph, the single
repository verification entrypoint is:

```powershell
pnpm install --frozen-lockfile
pnpm verify
```

Build and boot the actual packaged API and worker images, probe readiness, inspect the
non-root/read-only runtime, and tear the stack down with:

```powershell
pnpm test:container
```

Probe an already deployed API with `pnpm smoke -- --base-url=http://localhost:3000`.
The local Compose stack binds only the API to loopback, uses placeholder-only database
credentials, and keeps every live integration flag set to `false`.

## Release boundary

Local application tests, sanitized provider fixtures, and built-container health are
three distinct evidence classes. None is provider-connected staging evidence.
Production remains blocked until `docs/runbooks/go-live-evidence.md` records
`Release status: GO`, `docs/runbooks/provider-staging-evidence.md` records separately
reviewed `Provider staging status: PASS`, and both tested image digests have approved
signatures. The committed records intentionally remain `NO-GO` and `BLOCKED`; the
provider staging and production deployment adapters are not configured.
