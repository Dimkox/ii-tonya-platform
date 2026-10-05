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

### 2026-10-04: live inventory and implementation gap audit

The owner authorized implementation, RC publication, production deployment, and
selection of the client bot identified by the configured token. This is execution
authority, not fabricated signature-provider evidence, final legal document bodies,
participant research, or a successful Trust CI receipt. The parent stays
`in-progress`; the narrower browser increment is tracked in
`spec-client-web-account.md`.

The read-only production inventory found zero users, channel identities, approved
consent documents, consent decisions, and publishable expert services. Do not seed
demo records into live to disguise those absences. Before the account cutover, API
and worker pointed to `88c34f3f6b53fc099c14cc750cc71225fa0bbbe3`, while web pointed
to `0f49618e3e3b6d064e830f3b8ba77db794555bd0`.

| Factory boundary                    | Remaining acceptance gap                                                                                                                                                                       |
| ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Written special-category permission | No selected real signing provider, complete signature evidence, or admission model enforcing that evidence. Ordinary Telegram authentication is not a signature or content consent.            |
| Pre-consent ingress                 | Keep content ingress off. A durable rejected-delivery watermark and strictly bounded structured input are still missing; old events must not become new after a grant.                         |
| Public catalog                      | No public unauthenticated projection/UI yet. Published live inventory is empty.                                                                                                                |
| Late provider responses             | Responses lack the original consent-authority stamp; they must be checked under the withdrawal lock before persisting any response body.                                                       |
| Outbound delivery                   | Last-moment checks still have a check-to-send race; a later grant must not revive work authorized by a revoked decision.                                                                       |
| Expert transfer                     | Existing grants do not bind the exact recipient, reservation, and approved snapshot hash. Keep disclosure disabled.                                                                            |
| Erasure and retention               | Coverage of dialogue/proposal/outbox/authority data and real processor/backup proof is incomplete. Elapsed retention time is not verified deletion. The browser must not claim completion.     |
| Documents and activation            | Six final purpose-specific documents are not present in the live document registry. Legal/operator/provider inputs must contain actual values and evidence, not merely boolean approval flags. |
| Factory CI                          | Deployed Trust CI does not enroll this repository. The legacy consumer runner also references an absent pinned image. Local tests are not an exact-SHA factory receipt.                        |

The factory/consumer infrastructure defect was filed as
[Adaptive Grok Build Pro issue 243](https://github.com/Dimkox/adaptive-grok-build-pro/issues/243).
No factory trust policy, holdout, signing authority, or image identity was changed
to manufacture a passing gate.

The cabinet candidate passed a local full run (307 files, 2374 tests, no skips)
before the independent review patches and dependency upgrade. Post-review focused
results must be recorded separately; that earlier result is not a full-suite claim
for a later SHA. The browser sequence used an isolated PostgreSQL 17.5 database
and synthetic documents. It is not evidence that real legal documents exist in
production or that a user completed a real Telegram login there.

### 2026-10-05: cabinet RC deployed, full factory remains incomplete

Native API and web now run the same source
`426ee3b571de9b77aaae2e9294cb79e7cd0a596c` on ii-tonya.ru. The token-selected
client bot's verified Mini App menu opens `/account`. Live public desktop/mobile
checks and negative authentication checks passed; no real user login was claimed.
The live document registry is still empty and the acceptance gaps above remain.
Session/privacy routes are enabled, while unsafe ingress, external delivery and
erasure remain unavailable. The RC is published on `rc/client-consent-factory`;
the factory Trust CI limitation is unchanged. See the
[production evidence](../../test-evidence/production/426ee3b-client-account-2026-10-05.md).

### 2026-10-05: public catalog and navigation RC deployed

The current native/web source is now
`cab25eef3d7abd8591c2a49c3605a14acdc76585`, published on the RC branch and deployed
to the separate ii-tonya.ru host. The public catalog API/UI is implemented and
passed direct external-browser checks; its live eligible service list is empty.
Navigation-only Telegram ingress now records content-free terminal receipts,
rejects replay across later mode changes, and provides the account Mini App link.
Webhook/commands/menu configuration is confirmed, but Telegram recorded a fresh
connection timeout; real command delivery and real-user login remain unobserved.
The owner was asked for a real Telegram launch. See the
[RC evidence](../../test-evidence/production/cab25eef-client-navigation-2026-10-05.md).

These facts supersede only the earlier public-projection and navigation-watermark
gaps. They do not complete personal-content admission, signed special-category
consent, scoped expert transfer, authority-stamped async work, erasure proof,
approved document publication, payment/provider activation or Trust CI. The
controller continues independent implementable increments; CT-015 content-free
telemetry is next. The full factory remains `in-progress`.

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

## Latest production RC — 2026-10-05, 05:00 UTC

Native and web now run `2db008f7d25cfcaef134afbd9d8de4d6e975c8b7`, pushed normally
to `rc/client-consent-factory`. This supersedes the cab25ee live-source observation,
not its navigation implementation. CT-015 operational telemetry now uses closed
schemas, safe HTTP failures, sanitized trace context and guarded metric labels.
Independent review findings were closed before publication. See
[exact release evidence](../../test-evidence/production/2db008f7-content-free-telemetry-2026-10-05.md)
and [telemetry contract](spec-content-free-telemetry.md).

Direct browser and HTTP checks passed; API/worker/Nginx are active. SQL history
was unchanged. Real commercial catalog data remains absent (zero experts, services
and slots); real Telegram delivery/login remains unobserved and its stored timeout
persists. Payments, personal ingress/provider processing and erasure activation
remain off. Factory Trust CI enrollment, signature/provider/legal evidence and
the other parent gaps are not satisfied by this RC. Next independent code slices
are verified backup evidence and original-consent asynchronous fencing.
