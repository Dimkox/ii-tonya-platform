# Expert Residency Referrals Operations Runbook

Status: feature-off operating procedure. This runbook does not authorize staging or production activation.

## Ownership

- Incident commander: named platform operations lead.
- Financial approver: named finance reviewer.
- Security approver: named security administrator.
- Database recovery owner: named PostgreSQL owner.
- AI spot-check owner: named reviewer for prompt-boundary evidence.

Every activation, override, replay, key rotation, or incident action must identify the responsible human in the change record. Synthetic examples below are not production identifiers.

## Default state

`EXPERT_REFERRAL_ENABLED=false` and `EXPERT_RESIDENCY_BILLING_ENABLED=false` remain the default. No live payment-provider client is composed. New issuance, redemption, checkout, and reward grants remain blocked until the approved feature control and release gate both permit them. Existing verified settlement/refund/reversal, order expiry/release, reconciliation, debt processing, and controlled held-reward replay must remain operable.

## Pre-deployment checklist

1. Verify exact release SHA and signed CI provenance.
2. Verify migrations 0018 through 0022 and schema parity on a disposable PostgreSQL instance.
3. Verify scope guard still rejects unreviewed provider SDKs, payment routes, relations, flags, and automation artifacts.
4. Verify both feature flags are false in deployment configuration.
5. Verify no provider credential or live provider base URL is present in the expert-residency runtime.
6. Verify the current HMAC key version resolves through the approved secret reference and all still-active prior versions required for outstanding codes remain readable.
7. Verify named migration, financial, security, and AI reviewers are recorded.
8. Verify Task 10 and Task 11 focused evidence is attached to the exact SHA.

## Key rotation

Expert referral codes are persisted only as keyed digests with a non-secret key version. Rotation is versioned, never in-place.

1. Generate a new HMAC key in the approved secret manager.
2. Add the new version to `EXPERT_REFERRAL_HMAC_KEYS_JSON` or the approved secret resolver configuration without deleting any version still required by issued codes.
3. Set `EXPERT_REFERRAL_HMAC_KEY_VERSION` to the new version for newly generated codes.
4. Run crypto/resolver/repository focused tests and verify a code from the previous version can still be redeemed while a new code is issued under the new version.
5. Only remove an old key after there are no issued codes referencing that version and the retention/audit policy permits removal.

Never log plaintext codes, HMAC keys, code hashes, or complete code inventory.

## One-time batch handling

Plaintext expert referral codes may be returned only once from an approved batch generation command.

- The operator must use an approved secure delivery channel.
- Do not paste plaintext batches into tickets, chat, Sheets, logs, or telemetry.
- Inventory views show masked state only.
- Partial batch generation is an incident: do not manually reconstruct or top up the batch. Disable new issuance, preserve audit evidence, and investigate transaction integrity.

## Kill switch

Use the audited feature-control workflow to disable new commands immediately when fraud, provider uncertainty, accounting drift, or code leakage is suspected.

The kill switch must block new code issuance, redemption, checkout creation, and new reward grants. It must not block verified callbacks for existing state, refund/chargeback handling, expiry/release, reconciliation, reversal/debt processing, or already-authorized held replay.

After disabling new commands, record the feature-control version, approval IDs, actor sessions, reason, exact timestamp, and affected release SHA.

## Reconciliation

The expert-residency reconciliation worker operates in bounded batches. The production composition remains provider-disabled until a separately reviewed provider reader exists.

When the provider reader is disabled, the worker must report `provider: disabled` and make no external call. When a reviewed provider reader is later introduced, it may compare only provider/payment identity, amount, currency, and authoritative status. Mismatches are recorded as incidents; reconciliation never invents a financial transition.

Investigate any reconciliation mismatch before manual action. Compare durable provider inbox evidence, payment attempt identity, order snapshot, settlement/refund facts, and ledger allocations. Repair only through the authoritative state machine or an approved forward-fix; never edit balances directly.

## Order expiry and credit release

Order payment deadline authority is the PostgreSQL clock. At `db_now >= payment_deadline`, expiry wins and reserved credit is released exactly once. Operators must not extend an existing order deadline manually. The expert must receive a fresh quote and checkout.

If the expiry worker stalls, keep new checkout disabled when material reservations are accumulating. Restore worker health, run a bounded expiry batch, verify order/ledger counts, and monitor job duration and failure metrics.

## Held reward replay

Held replay is only for durable `pending_feature_hold` first-settlement markers created while reward grants were disabled.

Before replay, verify the audited feature control allows reward grants and confirm no terminating refund/chargeback has made the marker `cancelled_by_refund`. Replay runs in bounded batches and the repository rechecks the captured settlement-time eligibility, payment state, residency state, referral snapshot, abuse decision, and debt. It may grant, repay debt, or produce no grant; it cannot manufacture a new entitlement.

Never mass-edit held markers. If replay results diverge from expected counts, stop further replay, disable new commands/rewards, preserve database and logs, and escalate to finance + security.

## Refund and chargeback response

Use only authenticated, verified provider events. A full terminating refund or chargeback may reverse the original referral reward. A partial cash refund does not restore spent referral credit and cannot exceed captured cash minus prior refunds.

If the reward was already spent, completed historical residency remains unchanged and debt is recorded for the inviter. Do not alter historical order snapshots to make balances look correct.

For duplicate events, rely on provider-event and idempotency identity. If two events share identity but disagree on payload digest or authoritative facts, treat it as a provider/security incident rather than choosing one manually.

## Debt investigation

Referral debt is ledger-derived. Available referral credit remains zero while debt is outstanding, and future rewards repay debt before creating spendable credit.

For a debt case, collect only the required internal identifiers under access control: reversal entry, original grant, per-grant allocations, qualifying settlement marker, order, and verified provider event. Do not expose these facts in Telegram, prompt context, metrics labels, or Sheets.

A debt correction requires an approved append-only correction fact. Never update or delete prior financial ledger facts.

## Metrics and alerting

Only bounded labels are allowed: `module`, `operation`, `outcome`, and approved bounded `errorCode`. Never use expert IDs, code/hash values, order IDs, payment IDs, names, provider payloads, or raw errors as labels.

Alert for sustained worker failures, growing pending expiry/replay queues, reconciliation mismatches, unexpected duplicate-event spikes, debt creation spikes, or held replay cancellations. Thresholds are environment-specific and must be approved before staging; absence of an approved threshold is not permission to ignore a signal.

## Client 500/500 isolation proof

Before release, run the repository scope-boundary and architecture tests and confirm expert referral storage, codes, balances, routes, flags, and ledger facts remain separate from the client coupon later-intent. No expert feature change may introduce an executable client coupon/referral model.

## Incident escalation

Escalate immediately for plaintext code leakage, HMAC key exposure, unexplained ledger mutation, reward duplication, settlement after deadline, provider-event identity conflict, cross-expert data exposure, scope-guard bypass, or any live provider call from a disabled release.

First response: disable new commands/rewards where appropriate, preserve existing-state processing, capture exact SHA and feature-control version, stop unsafe replay, preserve DB evidence, and name the incident commander. Do not deploy an unreviewed hotfix directly to production.

## Database recovery

Use the platform PostgreSQL recovery procedure and restore only to an approved recovery target. After restore, replay migrations, verify schema parity, verify immutable/admin replay tables, then run reconciliation and idempotent existing-state workers before considering new commands. Never restore only derived balances without the underlying ledger, grants, allocations, orders, settlement markers, and provider-event inbox.
