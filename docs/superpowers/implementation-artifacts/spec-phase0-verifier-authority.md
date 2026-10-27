---
title: Restrict production payment-event mint authority
type: refactor
created: 2026-10-23
status: in-review
baseline_commit: ece006aa03b035db770a04dbea1e843a96cb10cc
review_loop_iteration: 0
context:
  - AGENTS.md
  - docs/agents/expert-residency-team.md
---

<frozen-after-approval reason="owner authorized continued Phase0 repair without step approvals">

## Intent

The scope guard correctly rejects the ordinary worker importing the unrestricted
canonical event factory. Existing provider GET checks are sound, but the caller
need not hold raw financial-event mint authority. Remove that capability from
production composition, preserving all provider verification behavior.

## Boundaries & Constraints

Always: integer money, exact GET binding and terminal checks, shared runtime-brand
identity, immutable evidence, fail-closed defaults. Keep canonical sandbox/test
construction available through the existing boundary.
Never: whitelist worker access to the canonical mint; expose the new internal mint
through a public barrel; alter payment admission, flags, secrets or stored facts;
run exhausted tests; call providers; generate migrations; push or deploy.

## I/O & Edge-Case Matrix

| Scenario        | State                                 | Expected                                  | Error                  |
| --------------- | ------------------------------------- | ----------------------------------------- | ---------------------- |
| Bound payment   | Verified GET succeeded                | Frozen runtime-recognized canonical event | None                   |
| Invalid binding | Wrong ID/order/amount/currency/mode   | No branded financial event                | Existing mismatch      |
| Pending/hold    | Authoritative nonterminal             | No settlement                             | Existing semantics     |
| Refund          | Exact bound refund and parent         | Same verified refund event/evidence       | Existing mismatch      |
| Arbitrary app   | Raw canonical or internal mint import | Scope guard rejects                       | Explicit violation     |
| Public API      | Integrations barrel                   | Internal mint absent                      | No capability exposure |

</frozen-after-approval>

## Code Map

Worktree: /home/pall/projects/ii-tonya-base/work/ii-tonya-platform/.worktrees/phase1-owner-plan-20261023.

- `apps/worker/src/yookassa-composition.ts:91`: currently passes generic canonical
  constructor into the provider verifier; remove that third argument/import.
- `packages/integrations/src/yookassa/verifier.ts`: preserve complete GET, exact
  binding, payment/refund/hold consistency checks; no injected canonical mint.
- `packages/integrations/src/expert-residency/verified-event.ts`: schema/evidence
  validation, freeze and WeakSet brand are currently implemented here.
- New `packages/integrations/src/expert-residency/verified-event-internal.ts`:
  move the single shared validation/mint and brand-membership primitive here.
  Importers restricted to public verified-event implementation and YooKassa verifier.
- `packages/integrations/src/index.ts`: keep public exports, never expose internals.
- `spec-yookassa-bound-runtime.md` and provider design: authoritative GET must precede
  any branded financial fact. Runtime evidence is not activation approval.

## Tasks & Acceptance

Owned production files: verifier.ts, verified-event.ts, new internal primitive,
worker yookassa-composition.ts. Owned tests: new
`packages/integrations/src/yookassa/verifier-authority.test.ts` and mechanical
constructor/observation updates to existing tests at call sites. No scope-helper
edits: companion registry implementer owns helper/scanner and its tests.

- [x] Write new focused RED tests for two-argument provider verification, frozen
      shared-brand identity, exact payment/refund evidence and mismatch/hold cases.
- [x] Move the one WeakSet and validation/mint primitive to the internal module,
      retaining the existing public types, fixture/factory semantics and identity.
- [x] Remove canonical constructor dependency from YooKassaPaymentVerifier;
      use the internal mint only after existing authoritative checks.
- [x] Remove unrestricted factory from ordinary worker composition.
- [x] Adapt all old constructor call sites and obsolete injected-mint spy assertions
      to meaningful output/brand assertions. Preserve business expectations and negative
      side-effect assertions. Do not run exhausted old unit/PG files; report adaptations.
- [x] GREEN new focused file; build integrations and worker dependencies as needed;
      relevant typechecks, tests tsc, scoped lint/format/diff. No full/multi-path suite.
- [x] Report exact interface and internal exports to companion guard implementer.
      No commit; coordinator will review and commit.

Acceptance: Given ordinary worker source, the unchanged canonical-factory ban now
passes. Given valid bound GET, public event and runtime brand match old semantics.
Given invented facts or mismatches, no public mint is newly exposed. New import
boundary enforcement is owned and verified by the companion registry spec.

## Verification

Use the new single-file tests RED/GREEN, ordinary package checks and source review.
Do not rerun onboarding/deletion PG tests, previous verifier/capability unit files,
or old bound-runtime suites. New focused verification covers the newly restricted
capability boundary; this is not a reset of their counters. Preserve existing APIs
apart from the intentionally removed injected constructor argument.
