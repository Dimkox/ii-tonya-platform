---
title: "Client sensitive consent and privacy boundary"
type: "feature"
created: "2026-10-04"
status: "in-progress"
baseline_commit: "af2554499b656de7d4fdddf3d33eff173a8fc4a9"
review_loop_iteration: 0
context:
  - "/home/pall/projects/ii-tonya-base/work/ii-tonya-platform/AGENTS.md"
  - "/home/pall/projects/ii-tonya-base/work/ii-tonya-platform/client-consent.factory.json"
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The client consent flow must make each processing purpose explicit and enforce privacy boundaries before content can enter storage, models, queues, experts, or external processors.

**Approach:** Deliver the full disabled-by-default candidate described by `client-consent.factory.json`: authoritative consent evidence, fail-closed ingress, safe catalog, Telegram/web control surfaces, revocation fencing, scoped expert transfer, erasure/retention, content-free observability, runtime composition, and release evidence.

## Boundaries & Constraints

**Always:** PostgreSQL is authoritative for consent and idempotency; each purpose is separate; current state uses one deterministic oracle; unknown, expired, replayed, mismatched, or ambiguous evidence denies; raw sensitive content is never logged or retained before admission; migrations are hand-authored SQL plus journal; Node 24 and pnpm 11.9.0 are required; tests precede production code; all runtime capabilities default off.

**Ask First:** Any real signature provider, processor, country/region, operator legal text, production activation, external credential, data deletion outside test evidence, push, merge, or deployment requires a separate explicit approval.

**Never:** Do not infer consent from `/start`, payment, offer acceptance, opening a document, Telegram ID, SMS, callback alone, prompt output, or an old boolean; do not replay pre-consent messages; do not store special data without approved signed consent; do not weaken financial, expert, migration, or fail-closed boundaries.

## I/O & Edge-Case Matrix

| Scenario  | Input / State                                               | Expected Output / Behavior                                     | Error Handling                       |
| --------- | ----------------------------------------------------------- | -------------------------------------------------------------- | ------------------------------------ |
| GRANT     | Verified UI presentation, matching subject/document/purpose | One immutable decision and current state projection            | Any mismatch denies without mutation |
| REPLAY    | Consumed/expired presentation or duplicate callback         | No second grant and no privileged transition                   | Return safe conflict                 |
| AMBIGUOUS | Conflicting decisions at one timestamp                      | No active consent                                              | Fail closed                          |
| INGRESS   | Free text, voice, file, forwarded message before admission  | Fixed safe response; no content persistence or external call   | Record only minimal technical fact   |
| WITHDRAW  | Active purpose with queued or pending work                  | State revoked; unstarted work fenced; late responses discarded | Transactional retry-safe result      |
| TRANSFER  | Changed expert, meeting, note, or snapshot                  | Old authorization rejected; new scoped authorization required  | No enumeration or history leakage    |

</frozen-after-approval>

## Code Map

- `packages/db/migrations/0039_consent_evidence_grant.sql` and migration journal -- existing consent evidence foundation; extend only with contiguous hand-authored migrations.
- `packages/db/src/repositories/consent-current.ts` -- single current-state oracle and egress predicate; all readers must use it.
- `packages/db/src/repositories/consent-evidence-repository.ts` and `privacy-repository.ts` -- transactional grant, presentation, withdrawal, and rights operations.
- `apps/api/src/routes/client-privacy.ts` -- authenticated client privacy HTTP surface; currently lists and withdraws consent.
- `apps/api/src/routes/telegram-webhook.ts`, `packages/integrations/src/telegram/` -- Telegram ownership, callback, and ingress boundaries.
- `packages/db/src/repositories/outbox-repository.ts`, `packages/worker/src/outbox-runner.ts`, `packages/worker/src/telegram-send-text-dispatcher.ts` -- async delivery and last-moment consent fencing.
- `packages/db/src/repositories/booking-repository.ts`, `client-expert-transfer-repository.ts`, `expert-telegram-query-repository.ts` -- recipient- and snapshot-scoped expert access.
- `packages/worker/src/privacy-erasure.ts`, `b2-sensitive-retention.ts`, `data-retention.ts` -- retention and erasure jobs; verify production composition is live and content-free.
- `packages/config/src/`, `apps/api/src/server.ts`, `apps/worker/src/` -- capability flags and fail-closed runtime composition.
- `tests/integration/consent-*.test.ts`, `tests/repo/consent-*.test.ts`, `apps/api/src/routes/client-privacy.test.ts` -- existing behavioral and boundary evidence to extend, not replace.

## Tasks & Acceptance

**Execution:**

- [ ] Establish baseline inventory and update the consent-to-code traceability map.
- [ ] Harden schema/repository/oracle for separate purposes, immutable evidence, replay, ambiguity, and withdrawal.
- [ ] Add UI-mediated grant/presentation routes and Telegram/web consent copy with ownership and version checks.
- [ ] Add pre-storage ingress quarantine and safe catalog with structured-only preferences.
- [ ] Fence outbox, worker, late responses, and expert transfer by current consent and exact snapshots.
- [ ] Complete erasure/retention, content-free observability, runtime composition, and release recovery runbook.
- [ ] Add E2E, concurrency, recovery, leakage, independent review, and exact-SHA evidence.

**Acceptance Criteria:**

- Given no valid consent, when client sends sensitive or free-form content, then no content or derivative is persisted, queued, logged, backed up, or sent externally.
- Given a valid UI presentation, when the client grants one purpose, then only that purpose becomes active and the decision is reproducible from immutable evidence.
- Given replay, subject mismatch, document mismatch, expiry, or ambiguity, when a grant is attempted, then the server refuses closed without privileged state.
- Given withdrawal racing with dispatch, when either side executes, then unstarted work and late responses cannot cross the revoked boundary.
- Given a changed recipient or snapshot, when expert access is attempted, then the old authorization is rejected.
- Given runtime readiness is incomplete, when the service starts, then all sensitive capabilities remain disabled.

## Spec Change Log

## Design Notes

The candidate is intentionally broad because the user approved the complete factory slice. Production readiness means the implementation and evidence are complete; it does not silently manufacture legal/provider approvals. The release artifact must remain disabled by default and carry explicit recovery steps.

## Verification

**Commands:**

- `pwsh -File scripts/check-development-environment.ps1` -- expected: no failures.
- `pnpm exec vitest run <focused consent tests>` -- expected: all focused tests pass.
- `pnpm exec tsc -b` -- expected: success.
- `pnpm exec eslint .` -- expected: no errors.
- `git diff --check` -- expected: no whitespace errors.
- `pwsh -File scripts/check-development-environment.ps1 -RequireDocker` -- expected: no failures before PostgreSQL evidence.
