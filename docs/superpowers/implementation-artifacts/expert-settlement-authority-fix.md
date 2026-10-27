# Expert settlement authority fix

Status: ready for focused reproduction and implementation; not release accepted.
Parent: commercial production completion. Catalogue remains empty. No providers,
real payments, production mutations or consent changes in this increment.

## Requirement and evidence

ERR-FR-030 and ERR-FR-031 in
`docs/superpowers/specs/2026-08-02-expert-residency-referrals-design.md` require
consecutive paid intervals and `db_now < payment_deadline` under the order lock.
Independent source review confirmed that settle locks only the individual order
before reading the maximum prior residency end. Later shared locks do not redo
that calculation. The retry wrapper does not set serializable isolation.
The deadline clock is transaction_timestamp and therefore predates lock waits.

## Acceptance

- Given two different pending orders for one expert and an existing unexpired
  paid interval, when distinct authenticated settlements overlap, then both
  succeed exactly once and append consecutive intervals of their stored lengths.
  The sum of added durations is preserved. Existing paid history is unchanged.
- Given the same provider event replayed after settlement, when it is processed
  again, then no further interval, spend or reward is added.
- Given a pending order locked before its payment deadline, when settlement
  waits and acquires authority after the deadline, then it cannot activate the
  order or spend reserved credit. Existing expiry processing releases credit
  once. The server's fresh database time remains the policy authority; do not
  replace it with unreviewed provider timestamp semantics.
- Given different experts, when their settlements run concurrently, then no
  newly introduced global lock serializes all experts.
- Given a failed settlement transaction, then inbox/order/ledger facts remain
  atomic and retry remains possible without duplicated financial effects.
- Given a verified payment arriving after either settlement-time expiry or an
  earlier expiry-worker commit, then preserve the exact authenticated provider
  fact and surface a durable unresolved operator signal. Do not activate expired
  residency, lose the payment on transaction rollback, or claim an automatic
  refund. Exact event replay must not duplicate that signal or credit releases.

Review refinement: rejection followed by a later worker release is insufficient
for ERR-FR-031. Expiry and release must commit together under the order lock before
returning the public expiry error. Worker replay afterwards must cause no change.
Multi-grant allocation correspondence must be checked, not merely release totals.

## Implementation boundary

Owned production file:
`packages/db/src/repositories/expert-residency-provider-inbox-repository.ts`.
New genuine regression file:
`tests/integration/expert-settlement-authority.test.ts`.
Evidence: `docs/test-evidence/expert-settlement-authority-2026-10-12.md`.
No ownership of campaign quotes, migrations, schema barrels or old test files.

### Reviewed scope extension: discoverable late-payment handling

Use the existing integration_errors open/resolved lifecycle and existing approved
integration_error.resolve operation. No invented outbox topic, alert type or
automatic refund. The verified inbox is the source payment evidence.

- Atomically insert one open error on the first late-payment event, with provider
  expert_residency, a fixed late-payment reason, and a deterministic hash binding
  to that exact inbox fact. Exact replay must not insert another error, including
  after operator resolution. Retain amount/currency and provider identity in the
  authenticated inbox; do not place message text/contact/token data in alerts.
- Provide bounded support-only list and detail through the actual admin API and
  application composition. Fresh valid session/MFA and support role are required;
  no public or expert access. Missing query support must fail closed.
- List uses stable keyset pagination with an explicit limit capped100, defaults
  to unresolved errors, and returns only minimal internal references, reason,
  state and timestamps. Validate cursor/filter values without coercion surprises.
- Detail binds a late-payment error back to the exact verified inbox fact; return
  safe payment/order references and amounts, not raw provider payload, session
  hashes, external chat IDs or secrets. A missing/mismatching binding is not a
  successful financial resolution. Use no-store responses.
- Existing approved resolution only acknowledges operational handling. It must
  not modify order/ledger/provider facts or assert refund. Document that provider
  verification and authorized external resolution remain separate actions.

Additional owned paths for this same task: admin-repository.ts, application
admin-service.ts, API routes/admin.ts, and server.ts only for minimal query wiring.
Preserve unrelated edits. Add genuine focused admin late-payment query/API tests;
do not rerun old exhausted suites. New PG query file follows RED1/GREEN2 with3
reserved; existing settlement file stays2/3 with final3 held for all fixes/review.
Read-only admin access needs no new migration or relaxation of existing approvals.

Use existing expert lock ordering consistently with checkout/reversal/reward
flows. Establish serialization before reading the prior residency end, then read
a fresh database clock after any authority waits. Never take an expert row lock
early without checking referral inviter/invitee lock-order interactions. A later
control lock or retry wrapper alone is insufficient. Preserve all current
v1/v2 referral semantics and authenticated-event checks. Do not enable a new
campaign policy in this fix.

## Test and review plan

1. Inspect actual transaction and lock ordering. Write deterministic real-PG
   regressions before production edits. Test-only executor boundaries may control
   interleaving but must forward real SQL and preserve constraints.
2. Run the new focused file once for behavioral RED. No replay or renaming of
   exhausted suites. Use isolated PostgreSQL17.5 and synthetic data only.
3. Apply minimal authority/clock fix. Run focused GREEN2 and types/lint/diff.
4. Independent review by a different agent; reserve final PG3 for coordinator.
   Maximum three invocations of this new file. No full/multipath suite.
5. Record exact commands, outcomes and remaining limitations. Production release
   still requires the broader candidate, migration, backup and journey gates.
