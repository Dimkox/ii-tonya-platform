---
title: Reconcile Phase0 scope and migration registries without weakening guards
type: chore
created: 2026-10-23
status: in-review
baseline_commit: ece006aa03b035db770a04dbea1e843a96cb10cc
review_loop_iteration: 0
context:
  - AGENTS.md
  - docs/agents/expert-residency-team.md
---

<frozen-after-approval reason="owner authorized continuation and clearing Phase0 local guard failures">

## Intent

Scope121/123 and history7/8 are red. Reconcile exact committed, previously specified
features against the guard inventory, preserving failure on unknown artifacts and
mutated approved content. Separately strengthen internal mint import protection;
production loses generic mint access in the companion authority refactor.

## Boundaries & Constraints

Always: explicit registrations, normalized exact hashes, negative bypass tests,
immutable SQL/snapshot bytes, honest local-vs-release evidence. Every registration
must link to a canonical feature spec, source invariants and evidence limitations.
Never: wildcard allowlists, skipped detectors, new frozen-gap exceptions, generic
worker mint exception, automatic registration of arbitrary scanned names/hashes,
provider calls, exhausted tests, migration generation, push or deployment.

</frozen-after-approval>

## Code Map

Worktree: /home/pall/projects/ii-tonya-base/work/ii-tonya-platform/.worktrees/phase1-owner-plan-20261023.

- `/tmp/phase0-guard-continuation-scope-red.log`: fresh failing guard diagnostics.
- `tests/repo/support/payment-scope-boundary-core.ts`: explicit paths, routes,
  relations, artifact hashes, canonical factory ban and AST classifiers.
- `tests/repo/migration-history-integrity.test.ts`:0050 omits three function and two
  trigger registrations. Preserve exact equality and frozen gap/bigint lists.
- Companion `spec-phase0-verifier-authority.md`: removes generic mint from worker,
  adds `expert-residency/verified-event-internal.ts`; only public verified-event
  implementation and authoritative yookassa/verifier.ts may import its primitives.
- Canonical source specs: spec-client-paid-settlement; spec-planerka-booking-workflow;
  spec-booking-notification-delivery; spec-expert-campaign-api/checkout;
  spec-expert-authenticated-entry; spec-payer-receipt-capture;
  spec-payment-first-send-admission; spec-native-cutover-recovery. Located under
  docs/superpowers/implementation-artifacts; use corresponding test-evidence.

## Tasks & Acceptance

Owned files: scope helper/core and support exports, migration history guard,
new `tests/repo/verifier-authority-boundary.test.ts`, and
`docs/spec/phase0-guard-registration-audit.md`. No provider/application source edits.
Authority implementer owns verified-event/internal/verifier/worker and their tests.

- [x] Read source specs/evidence and document grouped inventory:21 relations from
      SQL0042–0050,36 artifact paths,8 authenticated routes,2 receipt module paths and
      five old content hashes. Register only reviewed named artifacts after source
      examination. No product activation or new financial rule follows.
- [x] Add missing0050 functions payer_receipt_redaction_due,
      protect_payer_receipt_contact, protect_payer_receipt_binding and triggers
      payer_receipt_contact_guard/payer_receipt_binding_guard to sorted exact inventories.
- [x] Add RED probes that unknown sibling relations/routes/provider modules and
      modified approved content remain forbidden. Never bless arbitrary scanned output.
- [x] Add AST import/export protection for new verified-event-internal module:
      only exact two trusted importer modules allowed. Reject direct/aliased/namespace
      import, re-export, dynamic import and require from app/barrel/other modules;
      protect public barrel exposure and internal primitive symbols. Wire the check
      into the existing recursive production classifier, not only standalone tests.
      Preserve canonical factory production ban and existing sandbox exceptions.
- [x] Add exact approved hash for internal module and modified trusted branding
      implementation; update provider verifier hash only AFTER companion source stable
      and independently reviewed. No app canonical factory exception.
- [x] Run new focused probes RED/GREEN. Existing scope/history fresh RED is already
      coordinator-owned; final GREEN only when all companion changes are stable/staged.
- [x] Run scoped lint/types/format/diff, report changes/evidence. No commit; coordinator
      owns final staged scope/history commands and independent review.

Acceptance: Given only this exact reviewed tree, final scope/history checks pass.
Given an unknown path, relation, route or changed registered content, they still fail.
Given an app or public barrel importing internal mint authority, recursive scanner
rejects it. Given existing frozen migration gaps and SQL bytes, they remain identical.

## Verification

No PostgreSQL or old provider suite invocation. New unit/repo probes and focused
static checks only. Source evidence does not certify provider execution. Exclude
ignored local state/dependencies; scanner limits remain unchanged. Companion source
and caller test adaptations must finish before final types or registered hashes.
