---
id: SPEC-production-completion-2026-10-12
companions:
  - requirements-audit.md
  - registry-and-release.md
  - policy-reconciliation.md
sources: []
---

# Production completion contract

Status: draft. Audit captured; source-policy reconciliation and preservation validation remain incomplete. This is not release approval or an implementation-ready replacement for unresolved source requirements.

## Why

The owner requires a commercially working remote service matching every tab of the supplied specification. The published website and partial domain implementation do not yet deliver the complete client journey.

## Capabilities

- **CAP-1**
  - **intent:** Preserve and query all source requirements and their implementation evidence without exposing credentials.
  - **success:** All25 tabs, their hierarchy, revision, sanitized structured bodies and embedded images are stored; hashes and database integrity match locally and remotely; findings link to source tabs and evidence.
- **CAP-2**
  - **intent:** Clients authenticate and receive bounded nonclinical assistance and human handoff through the required channels.
  - **success:** An authenticated acceptance journey receives an actual provider response; retries cannot duplicate charges; handoff and spending controls work under provider failure.
- **CAP-3**
  - **intent:** Clients and experts complete appointment selection, approval, confirmation, cancellation, rescheduling and notifications.
  - **success:** Expert approval precedes calendar creation, client confirmation follows verified creation, and uncertainty never creates an untracked duplicate. Availability, reminders and lifecycle requirements in the audit have scenario evidence.
- **CAP-4**
  - **intent:** Clients purchase packages and receive correct balances, coupons, referral grants and refunds.
  - **success:** Accepted commercial decisions govern transactional state; provider-confirmed payment grants entitlement exactly once; duplicate, reordered and refund events preserve ledger correctness.
- **CAP-5**
  - **intent:** Experts complete onboarding, residency, service management and their separate referral flows.
  - **success:** Expert scenarios in the companion matrix have verified outcomes without mixing client coupons and expert referral accounting.
- **CAP-6**
  - **intent:** Website, account, design, legal and privacy surfaces reflect the resolved requirements and actual service behavior.
  - **success:** Every public action reaches its declared outcome; unavailable provider functions are explicitly identified; required brand and privacy artifacts have acceptance evidence.
- **CAP-7**
  - **intent:** Operate a reviewed remote release with known revision, monitoring and recovery.
  - **success:** Exact API/web revisions, end-to-end results, restrictions, backup and rollback evidence accompany deployment; readiness alone never establishes functional completion.

## Constraints

- PostgreSQL owns financial and idempotency state; prompts and external spreadsheets do not.
- Client coupon and expert referral products remain separate.
- No credentials in this contract, source registry, logs or published assets.
- Keep the real catalogue empty until the owner supplies inventory. Do not seed demo profiles as real offers.
- No written consent or electronic signing in the start route; human product acceptance remains separate from automated development checkpoints.
- Unpaid subscriptions do not justify reporting disabled integrations as operational.
- Preserve accepted owner decisions over superseded source text; unresolved financial choices remain explicit.
- Respect repository test-run limits; the Planerka client file has no remaining authorized invocation.
- Node24, pnpm11.9.0 and committed lockfile remain required; no generated migration history.
- No fabricated hosted CI evidence: hosted workflows are absent by repository policy.

## Non-goals

- Completing factory/Trust CI integration in this increment; the owner excluded it.
- Charging customers, purchasing subscriptions or inventing real expert availability during verification.
- Restoring superseded clinical, unlimited-use or external-financial-authority requirements.

## Success signal

A customer can use the published site and authenticated account, obtain assistance, arrange an expert-approved appointment, complete a provider-confirmed purchase and see the correct entitlement. Operators can trace and recover every step. All remaining all-tab obligations have explicit verified acceptance or an owner-approved deferral.

## Open Questions

- Reconcile the51 source-conflict records against accepted DEC decisions before identifying genuinely unresolved choices; do not ask the owner to reapprove settled policy.
- Verify whether DEC-FIN-029/030/031 remain open for referral reuse, partner pricing and affiliation; this draft does not select financial rules.
- Confirm final brand variant and actual social destinations where source text and accepted website decisions do not resolve them.
- Provider access remains externally constrained: Planerka credentials returned401; subscription cause is not established by that response alone.
