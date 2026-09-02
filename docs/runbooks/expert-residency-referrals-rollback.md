# Expert residency referrals rollback

Status: **disabled release candidate — staging and production not authorized**

This is a **SYNTHETIC-ONLY** procedure. Owner: Release operator. Required
approvers: Operations owner and financial reviewer; Security reviewer joins for
key or provider-authentication incidents.

## Trigger and containment

Stop on a migration/hash mismatch, reconciliation mismatch, unbounded metric
label, leaked plaintext/key material, unexpected live provider call, incorrect
cash/referral allocation, duplicate reward, negative projection, or failed held
replay. Record the exact SHA and redacted evidence as **PENDING/BLOCKING**.

1. Keep `EXPERT_REFERRAL_ENABLED=false` and
   `EXPERT_RESIDENCY_BILLING_ENABLED=false`.
2. Through audited feature control, set new commands and reward grants false.
3. Drain authenticated existing-state callbacks and bounded expiry,
   reconciliation, held replay, refund/chargeback, reversal, and debt work.
4. Reconcile orders, attempts, inbox results, reservations, grants, allocations,
   debt, and residency intervals. Escalate any mismatch; do not auto-correct it.
5. Roll application code back only to a verified image compatible with every
   already-applied migration, then run smoke and reconciliation checks.

## Data and schema safety

Never erase, rewrite, or decrement consumed codes/referrals, approvals, provider
inboxes, settlements, refunds, chargebacks, ledger facts, debt, audit events, or
applied migration history. Never use destructive table cleanup. Schema rollback
is forward-fix: add a reviewed corrective migration. Restore from an approved,
encrypted backup only under the database incident procedure when the Operations
owner and financial reviewer accept the recovery point and reconciliation plan.

HMAC rollback retains every active issued-code version; changing the current
version does not remove older secret-managed versions. One-time plaintext cannot
be reconstructed and must not be copied from logs or backups.

The kill switch does not authorize stopping required existing-state work. Client
`500/500` remains isolated and is not part of this rollback. Re-enable or stage
only after exact-SHA hosted CI, migration and financial reviews, named AI
spot-check, authenticated external sandbox evidence, and explicit staging
authorization are no longer **PENDING/BLOCKING**. Production still requires a
separate explicit authorization.
