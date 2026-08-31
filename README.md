# ии-Тоня Platform

Production-oriented implementation of the client and expert workflows described in the
authoritative ии-Тоня source document.

## Status

Native production runtime deployed; live-provider activation remains closed. The exact
release `233f3cf72e45e47117948ad5615b603252801e40` runs on the dedicated Ubuntu server as
systemd-managed API and worker services with system PostgreSQL, nginx, and HTTPS for
`ii-tonya.ru` and `www.ii-tonya.ru`. Deployment evidence is recorded in
[`docs/test-evidence/production/233f3cf72e45e47117948ad5615b603252801e40/deployment.md`](docs/test-evidence/production/233f3cf72e45e47117948ad5615b603252801e40/deployment.md).
That first native release required host-only recovery settings and is not accepted as a
reproducible cold-deploy artifact; a corrected exact-SHA replacement is the active release
task.
The client platform foundation is implemented, while live-provider gates remain closed.
Release B2 now contains the default-off single-dialogue response convergence slice:
deterministic and accepted Selarti replies receive one monotonic dialogue sequence and
become ordered `telegram.send_text.v1` outbox work. Selarti proposals are untrusted,
authenticated at a dedicated endpoint, validated, and bound only to a durable B1 request;
there is no direct Selarti-to-Telegram path and no client billing mutation.
Dispatch, response ingress, and sensitive retention remain independently disabled.
The typed Telegram dispatcher uses the existing no-request-logging transport boundary,
but the default worker registry does not compose a bot token or provider URL; that live
binding is an explicit activation gate rather than an environment-only switch.
Live activation is blocked until an official authenticated Selarti response fixture is
approved and staging proves unknown-outcome reconciliation. See the
[B2 traceability](docs/spec/hybrid-message-gateway-b2-traceability.md) and
[B2 rollback runbook](docs/runbooks/hybrid-message-gateway-b2.md).

Release B3 adds default-off, fail-closed Selarti cost admission. Migration 0036 stores
immutable approved policy/rate snapshots, per-request worst-case reservations and
immutable outcome/reconciliation facts. Admission uses integer arithmetic and caps
monthly exposure at the smaller of the operator cap and 10% of trailing-30-day settled
expert-residency cash revenue; quoted, refunded, referral-credit and client-supplied
amounts cannot increase it. Warning can admit, soft/hard stops create a bounded local
operator handoff, unknown outcomes retain reservation, and server-calculated actual USD
usage reconciles to RUB without mutating ordinary-client package or ledger state.

`SELARTI_COST_ADMISSION_ENABLED=false` remains the default. Live provider activation is
still blocked by the B2 official fixture/transport gates and requires an active immutable
operator-approved policy. See [B3 traceability](docs/spec/hybrid-message-gateway-b3-traceability.md)
and [B3 operations](docs/runbooks/hybrid-message-gateway-b3.md).
Release A2.1 adds additive expert-referral maturity scheduling: new eligible commercial
V2 first settlements remain unspendable for 30 days while legacy settlements create no
maturity; processing is lease-fenced, revalidates eligibility, and emits bounded metrics;
the worker is independently default-off via `EXPERT_REFERRAL_MATURITY_WORKER_ENABLED`;
see the [A2.1 rollback runbook](docs/runbooks/expert-referral-maturity-a2-rollback.md)
and [A2.1 traceability](docs/spec/expert-referral-maturity-a2-traceability.md).
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
deployment target. The current gate image is pinned to source
`29993b4fe96facf8c07781833dc7f2d5f560aa7e` and immutable image ID
`sha256:fd31ecb001fea3e4c6d044a420ce2b607586dfa4441ee98b3f7ae6e20abedd63`.
GitHub Actions are not used. GitHub stores Git history and pull
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
against the single dedicated Claw smoke database. The committed `.native-release`
provenance is from an older SHA and is historical/stale, not valid evidence for this HEAD.
No signatures or migration approvals are generated here; exact-SHA rebuild, signing, Trust
CI, Database Gate, and human approvals remain external release gates.
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

## Current V2 trial boundary

Newly issued paid/admin message packages use 30 calendar days; the intro grant is 100 messages with
no expiry, and existing rows retain their stored expiry. Ordinary `free_client_v2` access remains free
and is not re-gated. Paid packages are available where the service offers them. Future coupon grants,
if the deferred default-off coupon subsystem is activated, use 45 days; this tree does not claim
active coupon issuance.

The `тест эксперт` foundation is capped at 100 visible-message units, at most 50 AI turns, with two
units reserved per residual AI turn and zero units for deterministic warmup, qualification,
segmentation, and authoritative pricing. Segments are `EXPERT`, `CENTER` (studio, salon,
retreat/wellness center), and `ORGANIZER` (festival, retreat, travel/event organizer). PostgreSQL
authority is the never-remotely-shipped additive migration `0038_test_expert_trial`; the former
`0039` hardening draft was folded into `0038` before release. Prompt assets, durable bot/chat-scoped
sessions, campaign versions, redemptions, reservations, outcomes, and append-only audit records stay
separate from coupons, referrals, partner acquisition, and B3 cost reservations. Redemption keys use
the `test-expert:<campaign-version-id>:<internal-user-id>` namespace; summaries are informational,
while locked PostgreSQL transitions remain cap authority.

The routing controls are default-off: `TEST_EXPERT_PROMO_ENABLED`,
`TEST_EXPERT_DETERMINISTIC_FLOW_ENABLED`, `TEST_EXPERT_SELARTI_ENABLED`, and
`TEST_EXPERT_PROMPT_VERSION`; the last value is compatibility metadata, not activation authority.
`TEST_EXPERT_RECONCILIATION_ENABLED` independently gates the bounded worker. The
public promo body route is removed. Composition lives in the webhook-secret-authenticated client
route `POST /v1/webhooks/telegram/client/:botKey`, derives identity from a private update, rate-limits
before reservation, and resolves exactly one bot/chat/user identity. Every deterministic entry,
warmup, qualification, segment, quote, FAQ, limit, and fallback creates the existing
`telegram.send_text.v1` outbox/delivery for that same dialogue. Durable session state routes later
private free-form messages without a repeated prefix; ambiguity fails closed. Placeholder copy is
versioned and explicitly inactive for selling because approved warmup copy has not been supplied.
Before routing or delivery, current granted `client_messaging` consent is required; residual
admission additionally requires current granted `selarti_ai_processing` consent. Missing, revoked,
ambiguous, or wrong-policy-version consent fails closed.

Promo+Deterministic alone provides zero-unit behavior. Residual AI additionally requires one active
database campaign linked to an approved prompt asset with official-contract evidence and every
existing B1/B2/B3 capability; startup and API composition also require both `TEST_EXPERT_RECONCILIATION_ENABLED` and `WORKER_OUTBOX_DELIVERY_ENABLED`. One residual turn reserves two units, passes B3 cost admission, and
creates one idempotent `selarti.request.v1`; there is no direct provider dispatch. Only B2 response
convergence creates the same-dialogue `telegram.send_text.v1` answer and moves reserved units to
consumed. A bounded scanner preserves delayed, lost, and ambiguous outcomes, reconciles a durable B2
response as applied, and releases only from an authoritative durable `not_applied` fact—never from
timeout or response absence. Prompt/campaign metadata is immutable, and audited transitions are
limited to inactive→approved→retired and inactive→active→retired. No prompt or campaign is seeded active. The
source prompt remains preserved by the inactive
[prompt manifest](docs/prompts/test-expert-source-manifest.json), which cannot activate runtime.

Rollout is flag-off, then internal allowlist and bounded cohort, then separately approved provider
admission. Rollback disables provider admission first, reconciles unknowns, drains outboxes, and
preserves immutable history. Raw deterministic input is stored only as digests; residual text exists
only in the already retention-governed Selarti request outbox and is never copied to trial/session,
audit, outcome, or logs. This remains a provider privacy activation gate. An operational metric sink
is mandatory whenever promo/deterministic is enabled. Actual transitions emit redemption,
deterministic/offload, reservation, consumption, release, unknown, cap rejection, duplicate, provider
outcome, and reconciliation-age facts. Conversion and cost names are emitted only when a durable fact
exists. Yandex Metrika and all static scripts in `apps/web/index.html` remain unchanged.

Focused API, application, config, schema, repository, worker, and web checks are green. The explicitly
authorized final current-head disposable PostgreSQL 17.5 run passed 6/6 cases for folded `0038`,
lifecycle authority, unknown-scan `EXPLAIN`, provider uniqueness, B2 convergence, concurrency, and
audit immutability. The single allowed full `pnpm verify` run failed before this follow-up and was
not rerun; its introduced trial type regressions and partner-pricing test types are fixed under
focused checks. Official Selarti privacy/contract evidence, approved prompt/warmup copy, independent
exact-SHA review, restart durability, and real database-role denial remain
activation blockers pending independent review and exact-SHA CI.

## Unit-economics planning calculation

This calculation records the 2026-08-28 planning scenario only. It does not activate or
replace the tariffs, packages, coupons, referral terms, or legal text currently stored in
the repository.

### Inputs

| Input                              |                                   Planning value |
| ---------------------------------- | -----------------------------------------------: |
| Ordinary-client revenue            |                                          `0 RUB` |
| Expert price mix                   |    `60% × 3,900 + 30% × 5,900 + 10% × 9,990 RUB` |
| Listed expert ARPE                 |                                `5,109 RUB/month` |
| Selarti exchange rate              |                  Bank of Russia USD/RUB `× 1.10` |
| 2026-08-28 effective Selarti rate  |              `85.9541 × 1.10 = 94.54951 RUB/USD` |
| Annual inflation stress            | `60%` with expert prices held nominally constant |
| Stress Selarti rate                |           `94.54951 × 1.60 = 151.279216 RUB/USD` |
| Average expert lifetime            |                                     `2.5 months` |
| Equivalent geometric monthly churn |                                  `1 / 2.5 = 40%` |
| Deterministic offload assumption   |                                            `75%` |
| Selarti activity assumption        |         `25 AI turns/expert/month` after offload |
| Selarti billing assumption         |                       `2 billable units/AI turn` |
| Modeled token allowance            |                   `0.511 RUB/AI turn` at base FX |
| Acquiring sensitivity              |                       `4.636%` conservative case |
| USN income-tax sensitivity         |                                             `6%` |
| VAT sensitivity after threshold    |                         `5%` inside frozen price |
| VAT threshold used in scale table  |               `20m RUB` normal; `15m RUB` stress |
| Refund reserve                     |                                  `1% of revenue` |
| Expert discount/referral leakage   |              `8%-16% of listed ARPE` sensitivity |
| Support/operations                 |         `600 RUB/expert/month`; stress `960 RUB` |
| Hosting, backup, monitoring        |          `30,000 RUB/month`; stress `48,000 RUB` |
| Founder plus part-time support     |        `180,000 RUB/month`; stress `288,000 RUB` |
| Small-team payroll                 |        `600,000 RUB/month`; stress `960,000 RUB` |

The price mix, offload rate, AI activity and billing ratios, token allowance, refund
reserve, support, hosting, and payroll rows are internal scenario assumptions rather than
vendor quotes or observed production metrics.

The Selarti monthly-plan prices used here are `$360` for Pro 20k and `$0.03` for each
unit above 20,000. The conservative acquiring case models `(2.8% + 1%) × 1.22`; the
actual merchant rate depends on the YooKassa contract and payment method. Provider and
tax inputs were retrieved on 2026-08-28 from the official
[Selarti tariff manual](https://manual.selarti.com/finansovye-voprosy/tarify-i-limity),
[Bank of Russia daily rate](https://www.cbr.ru/currency_base/daily/?UniDbQuery.Posted=True&UniDbQuery.To=28.08.2026),
[YooKassa fees](https://yookassa.ru/fees/), and
[Federal Tax Service 2026 changes](https://www.nalog.gov.ru/new2026/). Selarti prices
are modeled as quoted in USD; invoice tax treatment must be confirmed separately.

### Core calculation

```text
ARPE = 0.60 × 3,900 + 0.30 × 5,900 + 0.10 × 9,990 = 5,109 RUB
monthly churn = 1 / 2.5 = 40%
AI turns = paying experts × 25
Selarti units = AI turns × 2
base Selarti = base FX × [360 + 0.03 × max(0, units − 20,000)] + AI turns × 0.511
stress Selarti = stress FX × [360 + 0.03 × max(0, units − 20,000)]
                 + AI turns × (0.511 × 1.60)
VAT = 5% × revenue when annualized revenue exceeds 20m RUB normal / 15m RUB stress
contribution = revenue − acquiring − USN − VAT − refunds − Selarti − support − hosting
replacement CAC = paying experts × 40% × CAC per acquired expert
LTV = monthly contribution × 2.5
CAC ceiling at LTV/CAC >= 3 = LTV / 3
```

For 100 experts, VAT is below the modeled threshold and the line items reproduce the
published totals (rounded to whole RUB):

```text
normal = 510,900 − 23,685 − 30,654 − 5,109 − 34,038 − 1,278 − 60,000 − 30,000
       = 326,136 RUB

stress = 510,900 − 23,685 − 30,654 − 5,109 − 54,460 − 2,044 − 96,000 − 48,000
       = 250,948 RUB

stress after replacement CAC = 250,948 − (100 × 40% × 2,500) = 150,948 RUB
```

At 100 paying experts, the modeled normal monthly contribution is approximately
`3,261 RUB/expert`. Under the 60% inflation and 2.5-month-lifetime stress, before
replacement acquisition and promotion leakage, it is approximately `2,509 RUB/expert`:
LTV is approximately `6,274 RUB`, and the all-in CAC ceiling is approximately `2,091 RUB`.
An `8%-16%` expert-price discount/referral leakage sensitivity subtracts approximately
`409-817 RUB/expert/month`; stress LTV then falls to approximately `4,230-5,252 RUB` and
the CAC ceiling to approximately `1,410-1,751 RUB`.

### Scale sensitivity

Contribution below includes the modeled Selarti/tokens, acquiring, tax sensitivity,
refund reserve, support/operations, and shared hosting. It is before team payroll; the
last column also subtracts replacement acquisition at `2,500 RUB` for the 40% monthly
churn.

| Paying experts | MRR at ARPE 5,109 | Normal contribution | Stress contribution | Stress after replacement CAC 2,500 |
| -------------: | ----------------: | ------------------: | ------------------: | ---------------------------------: |
|             10 |   51 thousand RUB |    -25 thousand RUB |    -67 thousand RUB |                   -77 thousand RUB |
|             25 |  128 thousand RUB |    +34 thousand RUB |    -14 thousand RUB |                   -39 thousand RUB |
|             50 |  255 thousand RUB |   +131 thousand RUB |    +74 thousand RUB |                   +24 thousand RUB |
|            100 |  511 thousand RUB |   +326 thousand RUB |   +251 thousand RUB |                  +151 thousand RUB |
|            250 | 1.277 million RUB |   +911 thousand RUB |   +717 thousand RUB |                  +467 thousand RUB |
|            500 | 2.555 million RUB |  +1.745 million RUB |  +1.514 million RUB |                 +1.014 million RUB |

Modeled break-even counts are:

| Operating shape                        |      Normal | Stress, no paid CAC | Stress with CAC 2,500 |
| -------------------------------------- | ----------: | ------------------: | --------------------: |
| Founder-only, excluding founder salary |  17 experts |          29 experts |            41 experts |
| Founder plus part-time support         |  63 experts |         111 experts |           155 experts |
| Small team                             | 171 experts |         325 experts |           474 experts |

Break-even is calculated by increasing the paying-expert count until contribution covers
the listed team payroll. Founder-only excludes founder salary; the other two rows use the
normal/stress payroll assumptions in the input table. VAT is added once the applicable
annual threshold is crossed: the 2026 `20m RUB` threshold in the normal case and the 2027
`15m RUB` threshold in the one-year stress case.

### Selarti and promotion sensitivity

- Pro 20k costs approximately `34,038 RUB/month` at the effective current rate and
  `54,460 RUB/month` after the 60% FX stress, before tokens and overage.
- At 28,000 billable units, the modeled monthly Selarti charge is `$600`, or
  approximately `56,730 RUB` current / `90,768 RUB` stress, before tokens.
- At 100 active experts and 40% churn, the service must replace 40 experts every month.
- A `1,000 RUB` expert referral reward is acquisition cost/contra-revenue rather than
  income.

Client coupons must be reserved at expected redemption value. For the current illustrative
`2x` package plus `500/500` referral terms, one `1,000 RUB` package produces the following
pre-fee sensitivity:

| Expected redemption | Expected `2x` coupon cost | Expected `500/500` cost | Total expected cost | Remainder from 1,000 RUB |
| ------------------: | ------------------------: | ----------------------: | ------------------: | -----------------------: |
|                 20% |                   400 RUB |                 200 RUB |             600 RUB |                 +400 RUB |
|                 50% |                 1,000 RUB |                 500 RUB |           1,500 RUB |                 -500 RUB |
|                 80% |                 1,600 RUB |                 800 RUB |           2,400 RUB |               -1,400 RUB |

If ordinary clients pay nothing, the `2x` package trigger and inviter reward after a
first package payment have no funding event. At 100 qualifying `500/500` referrals per
month, the expected reserve alone is `20,000 / 50,000 / 80,000 RUB` at 20% / 50% / 80%
redemption. This reserve and every discount or expert referral credit must be included in
realized ARPE and CAC before a scale decision.

The tax sensitivity must be recalculated before activation: the published USN
VAT-exemption threshold is 20 million RUB in 2026, 15 million RUB in 2027, and 10 million
RUB from 2028. At listed ARPE `5,109 RUB`, those annual thresholds correspond to roughly
327 / 245 / 164 continuously paying experts.

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

## Commercial Core V2 A1 current state

Version: `0.0.0` (package manifest). A1 adds PostgreSQL commercial controls, immutable
legacy/V2 client assignments, exact V2 START/BASE/PRO tariff and order snapshots, makes
zero-package ordinary-client inbound completion free, and snapshots the exact `30%`
(`3000` bps) credit ceiling. The end-to-end evidence is
[`tests/integration/commercial-core-v2-a1.test.ts`](tests/integration/commercial-core-v2-a1.test.ts);
traceability and rollback are in [`docs/spec/commercial-core-v2-a1-traceability.md`](docs/spec/commercial-core-v2-a1-traceability.md)
and [`docs/runbooks/commercial-core-v2-a1-rollback.md`](docs/runbooks/commercial-core-v2-a1-rollback.md).
All live flags default false. No production tariff is seeded, no provider is activated,
and no live gate is claimed. A2.1 expert-referral 30-day maturity is implemented, while its worker and reward control remain disabled by default.
External Trust CI, Database Gate, and branch push remain blocked and controller-owned.

Commercial-policy observability is an activation gate: Platform owns assignment/control
write failures and replay conflicts; Payments owns tariff/order conservation; Operations
owns alerts for control-version conflicts, unexpected provider calls while disabled,
assignment failures, and ledger conservation drift. Thresholds and routing require
approval before activation; the go-live reviewer remains unassigned/blocked.

## Release boundary

Local application tests, sanitized provider fixtures, and built test-container health
are distinct evidence classes. None is native staging or provider-connected evidence.
Production remains blocked until `docs/runbooks/go-live-evidence.md` records
`Release status: GO`, `docs/runbooks/provider-staging-evidence.md` records separately
reviewed `Provider staging status: PASS`, and the exact native release bundle has passed
checksum, SBOM, signature, migration, systemd, smoke, reconciliation, and rollback gates.
The committed records intentionally remain `NO-GO` and `BLOCKED`; live provider
composition is not authorized by this branch.

# Hybrid Telegram gateway B1 (default off)

B1 owns authenticated private client Telegram text ingress at `POST /v1/webhooks/telegram/client/:botKey`, bot-scoped identity, consent-gated canonical inbound storage, deterministic routing, and creation of `selarti.request.v1`. The generic `POST /v1/webhooks/telegram` remains reserved for existing expert/fallback processing and never invokes the client gateway. `dialogue_inbound.expires_at` records a deadline exactly 30 days after creation; no physical purge worker is implemented in B1.

Traceability: gateway routing and disabled behavior → `packages/application/src/hybrid-message-gateway.test.ts`; webhook authentication, terminal/retry HTTP semantics, and preserved expert ordering → `apps/api/src/routes/telegram-webhook.test.ts`; atomic identity, consent, replay, ownership, accounting isolation, retention, and outbox behavior → `tests/integration/hybrid-message-gateway-b1.test.ts`; 0033→0034 preservation → `tests/integration/hybrid-message-gateway-b1-migration-upgrade.test.ts`; migration/schema parity → `tests/repo/hybrid-message-gateway-schema-parity.test.ts`.

Rollback/forward recovery: set `CLIENT_TELEGRAM_INGRESS_ENABLED=false` and restart the API; do not reverse migrations 0034–0036 or delete journaled dialogue/inbound/outbox, delivery, reservation, or reconciliation facts. Diagnose and repair forward, reconcile pending `selarti.request.v1` and ambiguous delivery/outcome rows by idempotency key, then re-enable only after focused replay, consent, ordering, retention, and budget tests pass. B2 response convergence/retention and B3 cost admission are implemented and default-off. Full `pnpm verify` and independent architecture, security, and release reviews have completed for the current Release B tree; evidence is recorded in PR #38 and the raw verification evidence. Any subsequent repository change invalidates that evidence and requires fresh exact-SHA verification. Live provider/Selarti activation, external Trust CI, signed approvals, and staging/native provider evidence remain pending/default-off. Because `selarti.request.v1` contains bounded client text, its production creation remains explicitly activation-blocked until those gates pass.
