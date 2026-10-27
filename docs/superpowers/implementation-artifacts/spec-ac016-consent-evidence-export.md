---
title: "AC-016 owner consent evidence export"
type: "feature"
created: "2026-10-09"
status: "in-review"
baseline_commit: "9c705b475936bb944ebb0035acf2fd1f45980cbb"
review_loop_iteration: 0
context:
  - "/home/pall/projects/ii-tonya-base/work/ii-tonya-platform/AGENTS.md"
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The published export preserves original consent documents but omits
the decision evidence needed to distinguish original scope, channel and history.
AC-016 requires reproducible original evidence, not merely the latest authority.

**Approach:** Add an owner-bound evidence projection to each exported decision.
Keep the existing document projection and JSON download path. This increment does
not change consent authority, publish legal texts or enable erasure.

## Boundaries & Constraints

**Always:** Authenticate through the existing owner-only privacy route. Preserve
legacy nulls, original documents and revoked decisions. Include decision ID,
sequence as a decimal string, channel, safely projected original scope, decision text hash,
basis and prior decision ID only when the referenced decision has the same owner.
Include presentation ID and created/consumed timestamps only when its owner,
purpose and document match the decision. A missing or mismatched presentation
produces null evidence, never a join to a different subject. Export historical
facts without interpreting them as current permission. Preserve all existing
fields and maintain matching DB/application TypeScript contracts.

**Approved scope correction:** Preserve SQL/JSON null as `scopeFields: null`
with `scopeStatus: "absent"`. Preserve an empty object, or an exact object with
only `fields` containing an array of at most two distinct values from
`display_name` and `timezone`, as `scopeStatus: "complete"`; retain array order.
Every other shape is `scopeFields: null`, `scopeStatus: "redacted"`, without
copying arbitrary keys or values into errors, logs or exported metadata. Do not
mutate stored scope. A redacted record is explicitly incomplete audit evidence,
not an assertion that its original scope was empty. Extend the allowlist only
under a separately reviewed typed purpose schema.

**Ask First:** Any expansion into third-party identities, processor receipts,
new legal claims or new runtime capabilities. Do not manufacture missing evidence.

**Never:** Export presentation tokens, token digests, session keys, raw recipient
or reservation IDs, provider credentials or another user's decisions. Do not
enable signing, detailed input, payments or factory/Trust CI. Do not rerun the
exhausted original-copy integration file or rename its scenarios to evade limits.

## I/O & Edge-Case Matrix

| Scenario          | Input / State                                       | Expected Output / Behavior                               | Error Handling                        |
| ----------------- | --------------------------------------------------- | -------------------------------------------------------- | ------------------------------------- |
| Original evidence | Own decision and bound presentation                 | Historical metadata and timestamps, original scope/hash  | Existing authenticated response       |
| Replacement       | Later version or different current authority        | Historical evidence unchanged                            | No latest-version substitution        |
| Legacy            | Missing binding or nullable metadata                | Explicit nulls; existing original-copy behavior retained | No synthetic defaults                 |
| Foreign link      | Prior decision or presentation belongs elsewhere    | Linked evidence null; foreign metadata absent            | No enumeration                        |
| Credentials       | Presentation includes token digest/session material | Explicit safe-field projection only                      | Secrets absent from serialized export |

</frozen-after-approval>

## Code Map

- `packages/db/src/repositories/privacy-repository.ts` — `SubjectExport` contract
  and `exportOwnedSubject` SELECT currently return purpose/decision/policy/time
  plus immutable original document. Extend only the consent projection.
- `packages/application/src/privacy-service.ts` — matching exported contract;
  existing service enforces requester/subject ownership.
- `packages/db/src/repositories/consent-scope-export.ts` and adjacent
  `consent-scope-export.test.ts` — approved pure scope projection and focused
  unit RED/GREEN coverage before the final bounded PostgreSQL run.
- `packages/db/src/schema/identity.ts` — immutable consent metadata and
  presentation bindings already exist; no migration is required.
- `packages/db/src/repositories/consent-evidence-repository.ts` — existing
  issuePresentation/recordDecision APIs provide realistic focused fixtures.
- `tests/integration/consent-original-export.test.ts` — read-only baseline,3/3
  exhausted; its original-copy acceptance is not the new evidence-metadata test.
- `apps/api/src/routes/client-privacy.ts` and `apps/web/src/consent-view.ts` —
  existing authenticated export transport and JSON download; retain behavior.

## Tasks & Acceptance

**Execution:**

- [x] `tests/integration/consent-evidence-export.test.ts` — add focused metadata,
      nullable legacy and malicious-link/credential exclusion tests. Observe RED
      against the current implementation on isolated PostgreSQL17.5.
- [x] `packages/db/src/repositories/privacy-repository.ts` and
      `packages/application/src/privacy-service.ts` — add explicit evidence shape and
      ownership-checked query projection; normalize timestamp and sequence output.
- [x] `tests/integration/consent-evidence-export.test.ts` — verify GREEN with a
      maximum of three invocations total, including RED; report every failure.
- [x] `docs/test-evidence/2026-10-06-human-review-gap-audit.md` — record exact
      evidence, independent review and remaining live acceptance limitations.

**Acceptance Criteria:**

- Given an authenticated owner, when exporting, then each decision has original
  evidence rather than fields inferred from current authority.
- Given another subject's linked record, when exporting, then no foreign record
  metadata or credentials appear anywhere in the serialized response.
- Given a legacy decision, when exporting, then absence remains explicit without
  breaking the established original-document field.
- Given the additive implementation, when building API consumers, then DB and
  application types agree and the existing JSON transport remains compatible.

## Spec Change Log

### Final date-edge patch

Independent review found non-finite presentation dates could abort export.
Keep the historical evidence contract; return no presentation when its dates
cannot be represented, rather than fabricate a timestamp. New focused pure
helper tests cover this failure and preserve valid/null behavior. Euler's
independent patch review found no blocker. Full triage is in the gap audit.

### Owner-approved scope correction

User replied "lf" (Russian keyboard "да") to the explicit proposal to export
only permitted structured scope and mark unknown structures hidden while keeping
the stored original. This resolves the arbitrary JSON disclosure finding. Keep
owner-bound joins, original-document behavior and legacy nulls. Add focused unit
RED/GREEN coverage for projection before the one remaining PG invocation; do not
repeat or rename exhausted integration scenarios.

## Design Notes

Owner's "доделывай" confirms the previously presented bounded export design.
Erasure receipt architecture remains a separate increment within the full goal,
not a replacement for it. Raw third-party identifiers are intentionally excluded;
this increment alone cannot certify every scoped-transfer audit requirement.
The working tree contains preserved audit updates and unrelated owner files.

## Verification

- `pwsh -File scripts/check-development-environment.ps1 -RequireDocker` — supported
  Node24/pnpm11.9.0 and Docker before PostgreSQL execution.
- Focused new Vitest file on Compose PostgreSQL17.5 — RED then GREEN within3 runs;
  assert server_version_num170005. Never use the default PostgreSQL16 test image.
- Relevant DB/application builds, tests typecheck, scoped ESLint/Prettier and
  `git diff --check` — no errors; independent adversarial review before completion.
- Normal pre-push gate and signed exact-source release checks before authorized
  RC deployment. Do not claim hosted CI or authentic live login from local tests.

## Suggested Review Order

- Start with owner-bound evidence joins and safe output projections.
  [privacy-repository.ts:557](../../../packages/db/src/repositories/privacy-repository.ts#L557)
- Inspect the explicit scope allowlist and redaction marker.
  [consent-scope-export.ts:8](../../../packages/db/src/repositories/consent-scope-export.ts#L8)
- Check finite-date validation before ISO conversion.
  [consent-presentation-export.ts:8](../../../packages/db/src/repositories/consent-presentation-export.ts#L8)
- Review integration isolation and historical evidence scenarios; do not rerun exhausted tests.
  [consent-evidence-export.test.ts:1](../../../tests/integration/consent-evidence-export.test.ts#L1)
