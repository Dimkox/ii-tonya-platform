# ии-Тоня Platform

Production-oriented implementation of the client and expert workflows described in the
authoritative ии-Тоня source document.

## Status

MVP-CLIENT-CONVERSATION-001 is locally implemented and independently reviewed with 0
Critical / 0 Important findings. All conversation, provider, AI, and related feature flags
remain default-off; the immutable `client-conversation` gate is implemented but **NOT RUN**.
External AI, Product, Safety, Security, Privacy/Legal, and backup evidence remains blocked.
This is not released or live.

Native production runtime deployed; live-provider activation remains closed. The exact
release `233f3cf72e45e47117948ad5615b603252801e40` runs on the dedicated Ubuntu server as
systemd-managed API and worker services with system PostgreSQL, nginx, and HTTPS for
`ii-tonya.ru` and `www.ii-tonya.ru`. Deployment evidence is recorded in
[`docs/test-evidence/production/233f3cf72e45e47117948ad5615b603252801e40/deployment.md`](docs/test-evidence/production/233f3cf72e45e47117948ad5615b603252801e40/deployment.md).
That first native release required host-only recovery settings and is not accepted as a
reproducible cold-deploy artifact; a corrected exact-SHA replacement is the active release
task.
The client platform foundation is implemented, while live-provider gates remain closed.
The expert residency referral extension
includes expert API,
Telegram/prompt boundaries, bounded worker operations, traceability, runbooks,
release-readiness guards, and mandatory database-gate registration.

Verification is still an explicit release boundary. Focused Task 10 evidence is green,
and the corrected real-PostgreSQL release-candidate E2E is green at exact source
`c560cbb65e105e1aaeb8d86f544ff95cfd218346` in the constrained Claw container.
The previously standalone expert HTTP boundary is now composable through the normal API
application for injected test capabilities; runtime startup fails closed if expert flags
are enabled without that complete capability. No live authentication or YooKassa
adapter or credentials are supplied, and all deployment defaults remain disabled.
The expert Telegram query increment implements private `/schedule`, `/client`, and
`/stats` reads plus a separate single-use `cv1` client-view callback. It is code-complete
behind `EXPERT_TELEGRAM_QUERIES_ENABLED=false`; the default server supplies no query
capability, so changing the flag alone fails startup closed. This is not live Telegram
activation or provider evidence.
The default server intentionally constructs neither a live query adapter nor callback
secret; both remain deferred activation inputs. Enabled composition is proven only with
an injected test capability while the production lifecycle remains closed.
CI and Database Gate run directly on Claw inside the constrained `ii-tonya-test`
container, which imitates the dedicated server runtime without becoming a production
deployment target. GitHub Actions are not used. GitHub stores Git history and pull
requests only; executable evidence is written under `docs/test-evidence/claw/`.
Final aggregate verification, independent reviews, and human/release approvals remain
explicit gates.
GitHub Free does not expose private-repository branch protection or rulesets. The
repository therefore fails closed at the release perimeter. The former container-based
production release path is not authorized by the current architecture. Production must
run natively on the dedicated Linux server as systemd-managed API and worker processes,
with system PostgreSQL and nginx. Docker and Compose are development and Claw test tools only.
The native checksummed-bundle release path is implemented and its exact-SHA Claw assembly,
offline production closure, SPDX SBOM, checksums, inventory, and packaged-entrypoint
fail-closed smoke are recorded under `docs/test-evidence/claw/887c462065bc8d4f480b5474135638a5bc063b8c/`.
The same packaged API, migration entrypoint, and worker passed a native service rehearsal
against the single dedicated Claw smoke database. The production bundle is signed, the
exact-SHA migration is approved and applied, and public HTTPS readiness is live. External
provider credentials and activation remain separate fail-closed gates.
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

The repository also contains the complete BMad Method 6.11.0 Core + BMM runtime in
`_bmad/` and its Codex skill projection in `.agents/skills/`. It is project tooling,
not an application dependency. Installation, Windows UTF-8 setup, configuration,
verification, and upgrade commands are recorded in
`docs/handoffs/environment-manifest.md#bmad-method-and-superpowers`.

## Architecture graph

The connected repository architecture, including runtime modules, PostgreSQL authority,
CI/deployment, tests, evidence, disabled capabilities, deferred scope, prohibited paths,
and orphan/dead-code classifications, is documented in:

- **[Open the full project connectivity graph](docs/architecture/project-connectivity-graph.md)** — production-native and Claw-test topology
- **[Open the companion connectivity inventory](docs/architecture/project-connectivity-inventory.md)**
- [Open the production architecture](docs/superpowers/specs/2026-07-28-ii-tonya-platform-design.md)
- [Open the authoritative normalized requirements](docs/spec/normalized-requirements.md)

The graph intentionally includes non-live and historical entities instead of hiding
them. Workspace-level orphan count is currently zero; intentionally disabled,
test-only, evidence, deferred, prohibited, and legacy entities are marked explicitly.
File/symbol deletion requires a separate static/dynamic reference review and is never
inferred merely from lack of a production import.

## Authoritative source

- Snapshot: [full immutable source](docs/source/ii-tonya-expert-full-source-2026-07-28.txt)
- SHA-256: `0439AE1C645E6FDA46F013A66512401F251AA18D35520F5C9A7A3C7C59314EAF`
- Original Google Doc ID: `14AWYM9jbE0OPU3rKY6_PpPl3REDaqQbISdMB4D2mpUc`

The source contains product intent, prompts, pseudo-JSON, and repeated drafts. It is not
treated as executable Make configuration. The
[normalized requirements](docs/spec/normalized-requirements.md) are the implementation
contract; the source remains the traceability baseline.

## YooKassa release boundary

The repository contains a narrow YooKassa Merchant API boundary: fixed-origin client,
durable PostgreSQL operation mapping, authoritative verifier, default-off webhook seam,
bounded reconciliation, and encrypted exact-body recovery runtime. It is **not
activated**: all credentials and recovery-policy inputs are empty placeholders, the
default API/worker composition supplies no YooKassa key resolver or merchant capability,
and no test-shop or live provider evidence is recorded. YooKassa is the merchant product of
YooMoney; the personal YooMoney Wallet API and the former T-Bank proposal are not used.

- [YooKassa design](docs/superpowers/specs/2026-08-14-yookassa-provider-design.md)
- [YooKassa requirement traceability](docs/spec/yookassa-provider-traceability.md)
- [YooKassa operator runbook](docs/runbooks/yookassa-provider.md)
- [Provider-connected staging evidence](docs/runbooks/provider-staging-evidence.md)

No GitHub Actions are used. Direct Claw gates are the executable CI and Database Gate
path, and their committed evidence is not merchant-connected evidence. Production
deployment is deferred while hoster maintenance is active; this does not authorize a
container deployment, credential entry, or feature activation.

## System boundary

Selarti serves the client channel, Telegram serves the expert channel, and Planerka
provides scheduling integration. A transactional backend owns booking, billing, coupon,
consent, and audit state. Make and Google Sheets are limited to non-critical automation
and projections. YooKassa by YooMoney is the selected payment provider; its adapter and
recovery boundaries are implemented but remain disabled and uncomposed until the provider
contract, key-management boundary, and release gates are approved.

## Production topology

Production is a dedicated Linux server for this project. The application is deployed as
a signed native release bundle and runs as two non-root systemd services: API and worker.
The host uses its system PostgreSQL instance and nginx/TLS reverse proxy. Application
containers, Docker Compose, and a container runtime are not part of production or
staging. Docker remains available only for reproducible development, direct Claw tests, test
databases, provider stubs, and sandbox evidence.

Approved course corrections:

- [YooKassa provider selection](docs/superpowers/sprint-change-proposal-2026-08-13-yookassa.md)
- [Native dedicated-server production topology](docs/superpowers/sprint-change-proposal-2026-08-13-native-production.md)

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

## Test-only sandbox payment runtime

The branch `codex/sandbox-payment-provider` adds a separate `apps/sandbox-api` and
`packages/sandbox-payments` test boundary. It can simulate checkout and independently
approved settlement/refund against isolated PostgreSQL tables, then submit branded
events to the existing settlement/reversal pipeline. It has no live-provider SDK,
network authority, or credential input. The native production API/worker bundle and
systemd runtime must not depend on or contain this boundary.

This work is not release-ready. Tasks 1–4 are approved, Task 5 is conditional, and Task
6 code/config was approved while its image execution remained blocked by offline pnpm
hydration timeouts on constrained Claw. No sandbox image was produced. `SBX-TST-009`,
production packaged-image inventory/smoke, scans, SBOM, signing, provenance, and final
exact-SHA gates remain unrun. Provider staging remains `BLOCKED`; production remains
`NO-GO`. See `docs/runbooks/sandbox-payment-provider.md` and
`docs/test-evidence/claw/sandbox-payment-provider-20260813/verification.md`.

## Local verification and container evidence

Use Node 24 and pnpm 11.9.0. After installing the frozen dependency graph, the single
repository verification entrypoint is:

```powershell
pnpm install --frozen-lockfile
pnpm verify
```

Build and boot the packaged **test** API and worker images, probe readiness, inspect the
non-root/read-only test runtime, and tear the stack down with:

```powershell
pnpm test:container
```

Probe an already deployed API with `pnpm smoke -- --base-url=http://localhost:3000`.
The local Compose stack binds only the API to loopback, uses placeholder-only database
credentials, and keeps every live integration flag set to `false`.

## Release boundary

Local application tests, sanitized provider fixtures, and built test-container health
are distinct evidence classes. None is native staging or provider-connected evidence.
Production remains blocked until `docs/runbooks/go-live-evidence.md` records
`Release status: GO`, `docs/runbooks/provider-staging-evidence.md` records separately
reviewed `Provider staging status: PASS`, and the exact native release bundle has passed
checksum, SBOM, signature, migration, systemd, smoke, reconciliation, and rollback gates.
The committed records intentionally remain `NO-GO` and `BLOCKED`; live provider
composition is not authorized by this branch.
