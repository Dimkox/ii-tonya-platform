# Phase 0 applicant schema audit

Approved contract: [schema foundation](../superpowers/implementation-artifacts/spec-phase0-schema-foundation.md).
Source vocabulary: [owner plan P0.2](../superpowers/plans/2026-10-23-phase-1-owner-plan.md).
The existing model plus a separate applicant table is authoritative. These names
are product concepts, not instructions to duplicate existing tables or money.

| Requested table/concept | Classification and database authority                                                               | Boundary                                                                                                 |
| ----------------------- | --------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `users`                 | Existing `users`, UUID primary key; channel identity via `channel_identities`                       | Applicants already have a user; no expert record is required.                                            |
| `residents`             | Existing `experts` (one per user), `expert_residency_orders` and immutable tariff versions          | There is no new residents table. Paid status follows authoritative settlement, not application approval. |
| `referrals`             | Existing qualified expert `expert_referral_codes`, `expert_referrals`, reward maturities and ledger | Single-use admin-issued qualified expert codes do not implement reusable lead attribution.               |
| `payments`              | Existing residency payment attempts, provider operations/events and orders                          | No payment or identity table, provider call or checkout workflow is added.                               |
| `verification_queue`    | Added `expert_onboarding_applications`, unique `user_id`; pending partial index `(created_at,id)`   | Queue metadata only; no documents, contacts, free text, JSON, or balances.                               |

| Requested P0.2 field                    | Classification and authority                                                                                                                                      | Limit / later behavior                                                                                                                                                                                                                   |
| --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ref_code` (unique)                     | Existing qualified expert code hashes in `expert_referral_codes.code_hash`; HMAC-only, single-use, with admin provenance                                          | Reusable promo lead code generation on `/start`, deep-link parsing, referrer attribution and unique Telegram registration counts are **Phase 1 A1**, not implemented by these codes or this migration. No plaintext code is stored here. |
| `bonus_points` (integer, frozen/active) | Existing integer-kopek referral ledger, `expert_referral_balances.available_credit_minor`, and `expert_referral_reward_maturities` pending/matured/rejected state | Derived credit and pending maturity are the authority. No mutable points/balance column, conversion rule, new accrual or maturity workflow. Pending maturity is not spendable balance.                                                   |
| `calculated_tariff` (decimal)           | Existing owner-bound immutable `expert_campaign_quotes.price_minor` and monthly integer-kopek snapshot, linked by nullable `campaign_quote_id`                    | Decimal display must derive from integers. No copied price, recalculation or campaign workflow. Quote selection/payment admission remains Phase 1 A3 and existing payment authority.                                                     |
| `tariff_expiry_date`                    | Existing `expert_campaign_quotes.expires_at`                                                                                                                      | Preserve existing TTL and quote rules. An application link does not extend TTL or validate a quote for payment.                                                                                                                          |
| `verification_status`                   | Added non-null `pending` (default), `approved`, `rejected`                                                                                                        | Different from existing expert `verified` boolean. No backfill, expert activation, external approval authority or transition workflow.                                                                                                   |
| `onboarding_stage`                      | Added nullable `interview`, `card_draft`, `manager_review`, `promo_check`, `payment_ready`                                                                        | Null is pre-content onboarding. Allowed vocabulary only; stage transitions, manager permissions, collection and publication are later workflows. `payment_ready` grants no payment permission.                                           |
| `next_billing_date`                     | Derive from authoritative settled residency orders' `residency_ends_at`, observing existing settlement/reversal/entitlement rules                                 | No duplicated mutable date or renewal scheduler. An applicant without paid entitlement has no paid billing due date. Archive metadata does not change settlement dates.                                                                  |
| `archive_until_date`                    | Added nullable PostgreSQL `timestamptz`, paired with nullable `archived_at` timestamp                                                                             | Finite timestamps, chronological order through three calendar months inclusive. No entitlement extension, automatic restore, jobs or payments.                                                                                           |

## Database enforcement

Migration `0051_expert_onboarding_applications` only creates the application table
and pending queue index. `expert_onboarding_user_unique` enforces one application
per user. The direct user foreign key permits applicants before expert creation;
the composite `(campaign_quote_id,user_id)` FK references the existing
`payer_receipt_quote_owner_unique(id,user_id)` from migration 0050. A missing quote
is permitted, while a present quote must exist and belong to the same user, on
both inserts and updates. No duplicate quote-owner index is added.

Archive bounds require both fields null or both non-null, reject infinities and
backward dates, and calculate the maximum timestamp explicitly in UTC. Three months uses
PostgreSQL calendar arithmetic, not 90 days: January 31 through April 30 and
November 30 through February 28 are valid; the following day is invalid. The exact start time is preserved: an end earlier on the same calendar day is
rejected. A review correction changed the initial date-only draft to timestamps.
`updated_at` defaults on creation; future writers must set it when updating.
No transition trigger or active provider/runtime binding is introduced.

The hand-authored 0051 snapshot extends 0050 without changing historical objects.
The accompanying catalog supplement extends PostgreSQL 17.5 constraint/index
state captured after real full-chain replay, including the corrected archive timestamp
constraint verified by the final coordinator run; immutable SQL-only functions/triggers/views
and historical gaps remain untouched. The manifest binds every SQL input and both
metadata artifacts by SHA-256. This does not permit schema-derived generation.

## Verification evidence

Environment preflight passed Node 24.22.0, pnpm 11.9.0, Docker 29.9.2 and Compose
5.6.1. The focused integration test pins its own testcontainer to PostgreSQL 17.5;
it never uses a caller's shared database URL. Every temporary database and its
container is removed in teardown.

Integration RED: 14/14 failed because the new table did not exist.
Integration GREEN attempt: 13/14 passed; one assertion incorrectly expected a JS
Date from raw Drizzle SQL (which returns a timestamp string). That assertion was
corrected to validate a parseable creation timestamp and matching default update
time. All uniqueness, quote ownership, enum, archive and prior-data preservation
cases passed on this attempt. Final coordinator run: 18/18 passed on PostgreSQL 17.5, including exact full catalogue
equality, target-only applicant erasure and rollback after a later database failure.
The three-run budget is consumed; do not rerun this file. Metadata RED failed missing the
new export. No aggregate/full/multi-path suite, commit, push, migration deployment,
feature activation, or provider call was performed.

Metadata GREEN passed 1/1. Database typecheck, tests TypeScript check, scoped ESLint,
Prettier and `git diff --check` passed. State provenance guard passed 15/15.
Migration-history guard passed 7/8; the existing 0050 payer-receipt functions are
absent from its older hand-SQL registration list. Scope guard passed 120/123;
its existing migration journal hash, integration index hash and broad historical
relation/artifact registrations are stale. These baseline failures are retained,
not hidden by rebaselining unrelated artifacts or weakening detection. Additive
0051 artifacts and the new application relation are registered. Exact hashes for
this change's reviewed YooKassa sources and journal were refreshed after review;
unrelated stale hashes and grandfathered gaps remain untouched.

## Applicant erasure disposition

`expert_onboarding_applications` is removable workflow metadata, not a retained
financial or audit fact. `PostgresPrivacyRepository.startErasureAtomically`
deletes the target user's application in its existing serializable cleanup
transaction after verified processor manifests are captured/persisted and before
identity mappings are deleted. Foreign quote snapshots and ledgers remain intact,
as do every other user's application and financial history. No provider call or
physical processor-erasure claim follows from local deletion.

The focused PostgreSQL file includes real repository coverage for captured
manifests, targeted removal and preservation of both users' ledger facts, plus a
real database failure during later identity cleanup proving applicant deletion,
user deactivation and manifest/job creation roll back together. These cases
passed in the coordinator's final third run (18/18 overall). The focused file budget
is exhausted. No additional run was consumed by the implementer.

Final staged scope guard: 121/123. The new full0051 snapshot also repeats21
previously unregistered inherited relations from0050, so inherited registration
debt appears under the new snapshot path too. This remains an explicit failure;
no new global allowance was added to hide it. Release acceptance is blocked until
the registration debt is reviewed independently.
