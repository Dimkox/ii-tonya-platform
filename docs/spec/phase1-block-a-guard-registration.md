# Block A exact scope registration — 2026-10-23

Authority: [Block A contract](../superpowers/implementation-artifacts/spec-phase1-block-a.md)
and [execution contract](../superpowers/implementation-artifacts/spec-phase1-through-phase2-execution.md).
This registration covers local applicant acquisition only. It grants no provider,
financial, runtime activation, shared migration, deployment or release authority.

## Exact relations and route

Seven new relations are explicitly registered in both residency and database relation
inventories:

- `expert_promo_codes`: reusable `promo_` namespace, independent of qualified codes/coupons.
- `expert_promo_registrations`: unique Telegram identity digest and immutable attribution.
- `expert_promo_requests`: bot-scoped durable operation replay.
- `expert_promo_guide_work`: pending content/delivery work; no fake PDF success.
- `expert_promo_bonus_indications`: one frozen 100-point nonfinancial indication,
  included within the existing qualified 1000 RUB reward rather than additional credit.
- `expert_promo_manager_work`: ID-only applicant handoff, without contact/questionnaire payload.
- `expert_promo_enrollments`: bounded private consent enrollment; attribution is finalized only after consent.

The single route `/v1/webhooks/telegram/expert-promo/:botKey` uses a dedicated
receiving scope, Telegram webhook secret and private message identity. Registering
its literal path does not certify authentication or enable it.

## SQL history and artifacts

`0052_expert_promo_applicants.sql` creates those seven relations and the single
hand-authored function `enforce_expert_promo_immutable`, with exact triggers
`expert_promo_codes_immutable`, `expert_promo_registrations_immutable`, and
`expert_promo_requests_immutable`. Exact SQL object equality remains enforced.
The declared table count advances 123 to 130; existing historical snapshot gaps and
BigInt-default baseline are unchanged. No generator is used.

The SQL, supported snapshot, manifest and SQL-only supplement are registered by
literal normalized-content SHA256 after reconstruction of the settled SQL. The
journal hash changes only to include the contiguous 0052 entry. Hashes are never
learned from scanned production files at test runtime.

## Verification

`pwsh -File scripts/check-development-environment.ps1 -RequireDocker` passed
(Node 24.22.0/pnpm 11.9.0/PostgreSQL 17.5 image). An isolated new
`promo_state_0052` database on the task-owned Compose project replayed all 53
journal migrations. Fresh temporary-directory `drizzle-kit introspect` 0.31.10
produced the supported snapshot, normalized using the live positional constraints
and indexes. Its `prevId` links to 0051. Exact catalogue readback captured 130 tables,
43 functions, 75 triggers, 853 constraints, 354 indexes and 2 extensions. All prior 0051
catalogue entries remain unchanged. The onboarding default's earlier manually
spelled `'pending'::text` introspects as equivalent `'pending'`; new metadata
retains the actual introspected spelling, without modifying 0051.

The reconstruction database and empty-directory introspection output were removed;
other fixture databases were untouched. Local reproduction helper/log are retained
in ignored `.superpowers/sdd/phase1-block-a-state/`. The helper is diagnostic local
state rather than executable repository automation or release evidence.

Scoped guard/history ESLint and formatting passed. Coordinated single-file
scope invocation passed 123/123 against the staged new source and artifacts.
History initially passed 7/8: newest-snapshot literal still expected 51 rather
than 52. Corrected that exact pin; the authorized history-only correction run passed
8/8 at 14:26:24 UTC. Scope was not rerun. The
function/trigger inventory, 130-table parity and frozen gaps all passed.
No classifier, internal authority import boundary, unknown-import rejection,
negative probe, payment provider allowlist or historical gap is weakened.
