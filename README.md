# ии-Тоня Platform

Production-oriented implementation of the client and expert workflows described in the
authoritative ии-Тоня source document.

## Status

Pre-production. The client platform foundation is implemented, while live-provider,
staging, and production gates remain closed. The expert residency referral extension
has implementation for Tasks 1–12 in the active draft PR, including expert API,
Telegram/prompt boundaries, bounded worker operations, traceability, runbooks,
release-readiness guards, and mandatory database-gate registration.

Verification is still an explicit release boundary. Focused Task 10 evidence is green,
and the corrected real-PostgreSQL release-candidate E2E is green at exact source
`c560cbb65e105e1aaeb8d86f544ff95cfd218346` in the constrained Claw container.
The previously standalone expert HTTP boundary is now composable through the normal API
application for injected test capabilities; runtime startup fails closed if expert flags
are enabled without that complete capability. No live authentication or payment provider
is supplied, and all deployment defaults remain disabled.
CI and Database Gate run on the repository-scoped self-hosted Claw runner and execute
inside the constrained `ii-tonya-test` Compose profile. They do not consume GitHub-hosted
Actions minutes. Pull-request execution is restricted to repository-owner branches;
external pull requests are not allowed to run untrusted code on Claw. Final aggregate
verify, independent reviews, and human/release approvals remain open.

The separate `server-control` workflow is manual-dispatch only, uses read-only repository
permission, and publishes no raw command output. It is not part of the test runner path.
GitHub Free does not expose private-repository branch protection or rulesets. The
repository therefore fails closed at the release perimeter: the legacy native workflow
contains only an explicit refusal job, and the provenance-bound manual `Gated release` is the sole
release entrypoint. Its jobs also run on the dedicated `ii-tonya-release` Claw label, so
the release control plane does not require hosted Actions minutes.
Repository merge settings allow squash only and delete merged branches; staging and
production deployment environments accept only `main`.

The authoritative continuation checkpoint is
`docs/handoffs/2026-08-11-expert-residency-referrals-full.md`; the older handoff and
`.superpowers/sdd/progress.md` remain historical evidence.

For a clean machine, start with `AGENTS.md`,
`docs/handoffs/environment-manifest.md`, and
`docs/agents/expert-residency-team.md`. Validate the active toolchain before installing
dependencies:

```powershell
pwsh -File scripts/check-development-environment.ps1
```

The lockfile is the complete dependency graph; do not copy `node_modules` or caches from
another machine.

## Architecture graph

The connected repository architecture, including runtime modules, PostgreSQL authority,
CI/deployment, tests, evidence, disabled capabilities, deferred scope, prohibited paths,
and orphan/dead-code classifications, is documented in:

- `docs/architecture/project-connectivity-graph.md`
- `docs/architecture/project-connectivity-inventory.md`

The graph intentionally includes non-live and historical entities instead of hiding
them. Workspace-level orphan count is currently zero; intentionally disabled,
test-only, evidence, deferred, prohibited, and legacy entities are marked explicitly.
File/symbol deletion requires a separate static/dynamic reference review and is never
inferred merely from lack of a production import.

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
settlement/refund/reversal flows, disabled-by-default services and feature controls,
approved admin workflows, expert HTTP/Telegram/prompt-safe boundaries, bounded worker
expiry/reconciliation/held-replay jobs, bounded telemetry, traceability, release
runbooks, and release-readiness guards. See
`docs/superpowers/specs/2026-08-02-expert-residency-referrals-design.md`,
`docs/superpowers/plans/2026-08-03-expert-residency-referrals.md`, and
`docs/spec/expert-residency-referrals-traceability.md`.

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
signatures. The committed records intentionally remain `NO-GO` and `BLOCKED`; live
provider composition is not authorized by this branch.
