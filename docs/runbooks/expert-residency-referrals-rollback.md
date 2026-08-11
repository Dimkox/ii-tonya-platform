# Expert Residency Referrals Rollback Runbook

Status: recovery procedure for a disabled-by-default release. It does not authorize activation.

## Principle

Rollback must stop unsafe new activity without corrupting existing financial state. Do not use rollback to erase settled/refunded/reversed facts, referral bindings, reward grants, debt, audit records, or provider-event identities.

## Immediate containment

1. Record the exact release SHA, database migration level, feature-control version, incident timestamp, and named incident commander.
2. Set new expert referral/residency commands to disabled through the audited feature-control path.
3. Keep verified settlement/refund/reversal processing, expiry/release, reconciliation, debt, and required held-marker terminalization available for pre-existing state.
4. Stop any unreviewed live provider composition. The approved fallback is the disabled provider reader/adapter.
5. Stop held-reward replay if replay correctness is part of the incident; do not rewrite pending markers.

## Application rollback

Rollback the application only to an exact previously signed image digest whose database compatibility is approved. Do not deploy a tag or branch name without digest/provenance verification.

Before switching application images, determine whether the prior version can safely read the current schema. If compatibility is uncertain, leave the current application disabled and perform a forward-fix rather than running old code against a newer financial schema.

After application rollback, verify:

- both feature flags/new-command controls remain disabled;
- no live expert payment provider is composed;
- callback/refund/reconciliation endpoints for existing financial state are not accidentally blocked;
- worker single-cycle and graceful-shutdown behavior remains intact;
- client message-package and booking flows remain isolated and healthy.

## Migration rollback versus forward-fix

Migrations 0018–0022 create durable financial and audit facts. Destructive down-migration after those facts exist is forbidden unless a separately reviewed migration plan proves no authoritative data will be lost.

Preferred recovery is a forward-fix migration. A schema rollback may be considered only when all of the following are true: no authoritative expert financial facts exist in the affected schema, a named database owner and financial reviewer approve the operation, a verified backup is available, schema parity is proven after rollback, and the operation is rehearsed on a disposable restore first.

Never drop or truncate expert referral/residency tables merely to make an older application start.

## Database restore

If restore is required, restore the complete authoritative set consistently: expert identities required by foreign keys, referral batches/codes/bindings, tariff versions, residency orders, payment attempts, provider-event inbox, first-settlement markers, reward grants, ledger entries, ledger allocations, feature controls, abuse holds, issuance overrides, immutable admin execution results, and audit records.

After restore:

1. replay migrations to the approved target;
2. run schema parity and migration upgrade tests;
3. verify provider-event inbox uniqueness and result payloads;
4. run bounded expiry/release;
5. run reconciliation with provider disabled unless a reviewed provider reader is authorized;
6. run held replay only if explicitly approved and markers are eligible;
7. compare derived balances/debt to ledger facts;
8. keep new commands disabled until review is complete.

## Reward or balance incident

Do not edit a balance projection directly. Identify the original grant, allocations, spend/release/expiry/reversal/debt facts, qualifying settlement, and provider event. Correct financial state with an approved append-only correction or authoritative reversal flow.

If duplicate reward is suspected, disable new rewards, stop held replay, preserve the database snapshot, and verify unique first-settlement/referral/payment constraints before any correction.

If expected credit is missing, do not manually insert a grant. Determine whether the settlement marker is `eligible`, `permanently_ineligible`, `pending_feature_hold`, or `cancelled_by_refund`. Only the controlled replay path may resolve an eligible hold.

## Provider incident

For provider authentication failure, identity conflict, mismatched amount/currency/status, or unavailable provider state, disable new checkout as needed and retain provider-event evidence. Do not retry by generating a second payment identity or by changing the stored order snapshot.

A disabled provider reader must produce no external call. Re-enable any provider reader only after separate provider review and explicit activation approval.

## Code/key incident

For plaintext code leakage, revoke unused affected codes through the audited command and investigate delivery handling. Consumed codes and immutable referral bindings are not deleted.

For HMAC key exposure, disable new issuance/redemption, add a new key version, preserve prior key material only as long as necessary to validate outstanding codes, and rotate through the approved secret manager. Never rehash database rows in place without a reviewed migration.

## Validation after rollback

Required evidence before declaring recovery:

- exact rollback SHA/image digest and signed provenance;
- database migration level and schema parity;
- feature controls disabled;
- scope/security tests green;
- Task 10 prompt/API boundary tests green;
- Task 11 worker/reconciliation/metrics tests green;
- no live provider calls from the disabled configuration;
- reconciliation shows no unexplained drift;
- debt/reward/expiry sample spot-check by the named financial reviewer;
- client `500/500` later-intent remains isolated.

Rollback completion is not staging or production approval. Reactivation requires a new explicit authorization after root-cause review.
