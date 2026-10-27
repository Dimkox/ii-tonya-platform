# Quote-bound expert campaign checkout — local implementation evidence

Date: 2026-10-12. Source of truth: `docs/superpowers/implementation-artifacts/spec-expert-campaign-checkout.md`.
Branch: `codex/planerka-api`; baseline HEAD: `690797db64fd80aa1aeccea8003543de470d8c16`.
Shared worktree, no commit. **PG3 detected a real credit-invalidation defect. Authorized correction implemented for source review; unrun, not release-ready.**

## Changed paths and ownership

- `packages/db/src/repositories/expert-campaign-order-repository.ts` — new strict four-field command, canonical UUIDs, decimal-string result, transactional quote consumption/replay, FIFO reservations and bounded contention.
- `packages/db/src/schema/expert-residency.ts` — campaign order fields, unique FK and policy/binding checks only; existing tariff predicates retained.
- `packages/db/src/index.ts` — repository, command/result/error exports only.
- `packages/db/src/repositories/expert-residency-provider-inbox-repository.ts` — initial checkout task added the `expert_campaign_v1` maturity alternative; the separately authorized correction below also changes reversal/settlement credit authority. Earlier deadline/interval changes remain their original owner's work.
- `packages/db/migrations/0048_expert_campaign_orders.sql`.
- `packages/db/migrations/meta/_journal.json` — contiguous entry 48, `when: 1791763200005`, breakpoints enabled.
- `packages/db/migrations/meta/0048_snapshot.json`.
- `packages/db/migrations/state/0048_sql_objects.json`.
- `packages/db/migrations/state/0048_manifest.json`.
- `tests/integration/expert-campaign-orders.test.ts` — same logical file: PG3 executed72 cases; initial correction added10 unrun cases, repayment-review round adds5 more (87 total, unrun).
- This evidence file.

The initial checkout implementation reused the residency repository/atomic expiry helper. The separately authorized credit-invalidation correction now changes that helper and the admin repository as recorded below.
No app, contracts, domain, promo, group-entitlement policy, catalogue, consent or provider composition changes.
Repository guards remain coordinator-owned. No nested agents, commits, pushes, provider requests, production changes or activation.

## Exact PostgreSQL invocation accounting

The file has a three-run maximum. **3/3 consumed, exhausted. No owner extra-run permission has been relayed; no test execution during this correction.**
No other PostgreSQL test file, old exhausted suite, full suite or multi-path suite was run for this task.

The focused invocations used the same command, with `II_TONYA_TEST_POSTGRES_ADMIN_URL` set to the retained synthetic admin connection:

```sh
pnpm exec vitest run tests/integration/expert-campaign-orders.test.ts
```

| Run             | UTC start | Result                                                                                                                                       | Duration                    |
| --------------- | --------- | -------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------- |
| RED1            | 19:51:15  | 51/51 failed against the compileable `EXPERT_CAMPAIGN_NOT_IMPLEMENTED` scaffold; genuine missing-behavior RED, not migration/fixture failure | 18.06s total; 15.137s tests |
| Intended GREEN2 | 19:58:57  | **69 passed, 1 failed, 70 total; exit 1**                                                                                                    | 36.15s total; 33.245s tests |
| Coordinator 3   | 20:19:02  | **71 passed, 1 failed, 72 total; session97064 exit1**; mixed-authority exact-ledger oracle detected an extra100000 refund release            | 37.50s                      |

GREEN2's failed case was `commits overdue replay expiry and original grant release once`:
the final evidence query used unquoted reserved alias `grant`, raising SQLSTATE `42601`.
The concurrent expiry/replay calls and expired-status assertions completed before that query failed.
The subsequent net-zero grant allocations / single-release / used-quote assertions did not execute in this case.
The alias is now `grant_id`; this correction passed in coordinator PG3.

Two additional source-review corrections after run2 passed in coordinator PG3:

1. Replay must recheck the immutable quote's user, not just the expert's current active owner. Otherwise reassigning an expert to a different active user could authorize replay of the former owner's quote. A new reassignment regression was added before the repository check.
2. Preserve PostgreSQL microseconds: filter grants in SQL against the captured post-lock server timestamp, and compute the persisted deadline with SQL `least(quote expiry, min(allocated grant expiry))`. JavaScript Date is retained only for the existing millisecond DTO/creation convention. Added an exact-microsecond deadline regression. Drizzle's raw TIMESTAMPTZ parser was inspected and returns the original string.

The last executed suite result is **71/72, failed**, not87/87. Coordinator reported no hook failures or unhandled errors. Later assertions in the mixed case after its exact-ledger failure did not execute.

## Exercised matrix and remaining verification

Run 2 passed:

- Literal PRO stage-one 1-month 599400/179820/419580/2592000 and 3-month 1528470/458541/1069929/7776000; START floor 1500000/450000/1050000; PRO stage-two 1888110/566433/1321677; BASE floor and monthly group limits 0/1/3; only100000 credit leaves499400 cash.
- FIFO grant ID order, allocation sums, canonical UUID replay, retirement replay, changed-quote and legacy-key conflicts, distinct-key quote reuse, concurrent same-key/same-quote commands.
- New/replay denial for inactive user, inactive/unverified expert, wrong owner; foreign quote denial, strict input/key validation and feature fail-closed.
- All 21 financial/identity/snapshot fields immutable; DELETE, clone/reuse, forged source fields and policy relabeling rejected; lifecycle status changes and old v1/v2 order paths retained.
- Real blocked subject and document SQL across quote expiry; actual user and tariff row waits followed by deactivation/retirement; grant-lock wait crossing credit expiry; three actual bounded advisory-lock attempts with no partial consumption.
- Injected post-allocation failure rolls back order/reservation; same command subsequently succeeds.
- Saved campaign cash/duration through settlement, consecutive paid intervals, actual settled/refunded replay status, unique first marker, 30-day maturity, no immediate reward, terminating reversal and cancellation.
- A historical due-maturity fixture produced one reward once; another due maturity raced checkout/settlement/reversal with an expiry invocation. Kant subsequently identified that expiry had no due order and that aggregate ledger/allocation equality was insufficient proof of conservation. This run therefore does **not** establish mixed-authority per-grant conservation; the stronger oracle below remains unexecuted.
- Replay after quote expiry returns expired and does not reopen consumption.

All lock-wait tests submit the original SQL while the blocker remains held. Separate autocommit observations require both `pg_blocking_pids` membership and an ungranted `pg_locks` row before blocker release. A test executor gate alone is never counted as lock evidence. No production test hook or timeout increase.

Privileged historical grant/maturity fixtures are explicitly marked; they do not imply runtime caller-clock authority or normal competing-authority behavior. Existing quote SQL clock writes are trusted privileged writes: 0047 was not changed, and no invented tolerance window is claimed.

## Transaction and SQL source proof

The checkout branch is SERIALIZABLE. Each of at most three whole-transaction attempts sets local `lock_timeout='250ms'` before document/subject authority, then checks user eligibility and follows existing control→expert locking. Only 40001/55P03/40P01 are retried; exhaustion returns a content-free typed contention error. Implicit FK waits share the transaction-local timeout. Shared retry helpers and worker/settlement lock policy were not changed.

New consumption locks quote, tariff and grants before reading fresh database time. No pre-lock transaction-time expiry predicate selects credit. Creation time is fresh, provider deadline equals the quote expiry, and payment deadline is the exact SQL minimum with allocated grants. Quote linkage is unique and immutable. No quote is updated to mark consumption.

Replay verifies current active user/expert ownership and original quote ownership, then reuses `expireLockedExpertResidencyOrder` inside the same transaction with `clock_timestamp()`. Overdue replay returns the committed expired result; no exception rolls back the release. Replay never reprices or requires the tariff to remain active.

0048 binds raw campaign INSERTs to the quote's original user through the expert, active user/expert/tariff, quote validity, tariff ID, price, term, duration and every entitlement. Financial UPDATE/DELETE/relabeling is rejected; the existing payment/refund/expiry lifecycle fields remain writable. Existing v1/v2 tariff and order predicates are retained; only the new campaign order policy permits campaign fields.

## Migration reconstruction and static checks

- Required PowerShell preflight with `-RequireDocker`: exit0; Node24.21.0, pnpm11.9.0, Docker29.9.0, Compose5.6.0.
- Container inspected before each test invocation: `ii-tonya-notification-t2-20261012-postgres-1`, running `postgres:17.5-bookworm`, IP192.168.112.2; actual `server_version_num=170005`.
- 0048 reconstructed by replaying the SQL journal on a separate isolated PG17.5 database; introspection used a fresh temporary output directory. No Drizzle generate. Prior SQL hashes verified unchanged against0047 manifest. Ignored helper: `.cache/expert-campaign-checkout/reconstruct.ts`; temporary database/output cleaned by its finally block.
- Final metadata: **118 tables, 39 functions, 70 noninternal triggers**; no new table. Extensions unchanged: btree_gist1.7, pgcrypto1.3. PostgreSQL version and artifact/input hashes recorded in0048 manifest.
- Exactly two new SQL functions: `enforce_expert_campaign_order_source`, `protect_expert_campaign_order_snapshot`.
- Exactly two new triggers on expert_residency_orders: `expert_campaign_order_source`, `expert_campaign_order_snapshot_immutable`.
- New columns: campaign_quote_id, campaign_term_months. New constraints: expert_campaign_order_quote_fk, expert_campaign_order_quote_unique, expert_campaign_order_binding. Existing expert_order_policy_version replaced to admit the campaign order policy; old v1/v2 predicates unchanged.
- Final static verification after the replay-owner and timestamp-precision corrections: DB typecheck **exit0**; shared `tsconfig.tests.json` typecheck **exit0**; DB ESM/DTS build **exit0**; ESLint on the five changed TypeScript paths **exit0**; Prettier on changed TypeScript/JSON/evidence **exit0**; `git diff --check` **exit0**. Read-only hash verification matched all49 journal SQL inputs and both0048 metadata artifact hashes. None of these checks is a substitute for coordinator PG3.

## Pending / risk boundary

Kant accepted the strengthened oracle before coordinator PG3, which detected the real production defect. The new correction below needs independent review and an explicitly authorized extra run; no full-green handoff is claimed. The coordinator reports migration guards **8/8 and12/12 passing** on0048. Those guards were not run by this implementer. This correction changes no SQL/schema/metadata.

The separate settlement-authority suite's date-assertion correction remains unrun after8/9 with its own3/3 budget exhausted. This task does not upgrade that result.

Actual application/API/Telegram/promo/provider composition and UI deadline disclosure remain downstream work. No route silently enables campaign checkout. Group policy is not expanded; monthly group limits are not multiplied into pooled term entitlements. No production readiness or activation is claimed.

## Historical checkpoint: Kant P2 oracle refinement before PG3

Only the existing `tests/integration/expert-campaign-orders.test.ts` and this evidence file were changed for this review request. Production, accepted replay-ownership/precision fixes, SQL, metadata, coordinator guards and browser documents were not changed. The file still contains72 cases under its original logical identity; PG budget remains **2/3**, with no test execution during this refinement.

The existing mixed-authority case now:

- Obtains a separate genuine100000 reward grant, seeds its short historical expiry explicitly, and creates a real pending campaign order reserving exactly that grant. It waits for the actual payment deadline and asserts in SQL that the order is due before starting expiry.
- Pauses the real expiry executor only after its due-order `FOR UPDATE` selection has acquired the lock. Same-key checkout replay submits its actual order-lock SQL while expiry retains that lock. Independent autocommit `pg_blocking_pids` plus ungranted `pg_locks` observation is required before releasing the expiry gate. Original SQL is forwarded unchanged; no production hook is added.
- Runs checkout, settlement, reversal and a genuinely due maturity alongside this expiry/replay contention. Requires expiry's fulfilled result to be exactly `{examined:1,released:1}`, the due order to be expired, and one original-grant release. Replay must return that expired order or bounded typed contention.
- Builds the complete expected ledger from the two seeded100000 grants, exact original reservations and each command's fulfilled/rejected outcome. It compares every entry kind, signed amount, order, original-entry link, source, idempotency key and grant allocation—not merely sums. An extra reservation debit fails even if an identical erroneous allocation was inserted beside it. Each original reservation may have at most its one expected release.
- Accounts for the two existing maturity outcomes explicitly: one new100000 grant or100000 repayment of the reversed original grant, never both. A checkout allocating the original grant again is allowed only after reversal/release and maturity repayment, without also spending the same credit through successful settlement; expired-grant allocation is rejected.
- Verifies exact per-grant reward/reservation/release/spend/reversal/repayment/expiry/net amounts, inventory, and available/reserved/debt balances against the outcome-derived expected ledger. Reconciles order states, payment-attempt cash/status, processed provider inbox rows and maturity status to the fulfilled outcomes; failed transactions must leave no financial order/entry effects.
- Replays fulfilled commands and expiry after the race, requiring the full ledger—including entry IDs and allocations—to remain identical. Due-order expiry must then examine/release zero further orders.

At this checkpoint the last executed result was69/70. Shared-test typecheck, scoped test-file ESLint, formatting and whitespace checks passed; all49 SQL input hashes and both0048 metadata hashes were rechecked unchanged. Subsequent PG3, recorded above, exercised this stronger oracle and found the double-release defect. Its failure is preserved, not reclassified as an oracle error.

## Authorized credit-invalidation correction — tests unrun

Authority: `docs/superpowers/implementation-artifacts/expert-credit-invalidation-fix.md`. Only these five paths changed for this correction:

- `packages/db/src/repositories/expert-residency-provider-inbox-repository.ts`.
- `packages/db/src/repositories/expert-residency-repository.ts`.
- `packages/db/src/repositories/admin-repository.ts`.
- Existing `tests/integration/expert-campaign-orders.test.ts`.
- This evidence file.

Main retains runbook/status/guard ownership. No schema/migration, routes/application, provider calls, nested agents, commits, production writes or historical repair script. The approved technical decisions are implemented, not independently accepted or execution-verified.

### Financial authority and provenance

Reversal discovers affected orders without the former `NOT EXISTS(any release)` filter. It locks/revalidates consuming pending/failed orders, releases the entire outstanding reservation across its original grants, and transitions pending orders to existing `failed`. Only the qualifying reward is reversed. Settled orders are excluded from cancellation; their historical spend and residency remain intact.

The shared helper validates original expert/order/grant identity, signed amounts, exact entry/allocation totals, original reservation total against saved order credit, and prior releases per grant. Existing partial releases reduce only their corresponding original allocations. Over-release, foreign-grant allocations, occupied mismatched keys and pre-existing spend fail closed with `EXPERT_RESIDENCY_CREDIT_ALLOCATION_INVALID`; old facts are never updated or silently compensated.

Fresh cancellation release provenance remains `source_type=provider_reversal`, `source_id=<refunded qualifying order ID>`, `original_entry_id=<reservation ID>`, key `refund-release:<first-settlement marker ID>:<reservation ID>`. The release amount is the outstanding total across ALL original grants, not only the reversed grant. If this exact source key already represents a valid historical partial, the new append-only key is `<base key>:remainder:<outstanding total minor>`. Reversal provenance remains `reward-reversal:<marker ID>` bound to the original reward entry and qualifying order. Expiry keeps `release:<reservation ID>` and settlement keeps `settlement-release:<reservation ID>` / `settlement-spend:<reservation ID>`; neither blindly adds a second full inverse.

Payment after credit invalidation preserves the authenticated inbox's exact identity and cash, keeps the order failed, commits one rejected inbox/exception transaction, then throws the public error. No residency, spend, payment-attempt settlement or automatic refund is fabricated. Exact event replay returns the same rejection without reopening an operator-resolved signal. Failed-order recognition requires the bound original reservation, reversal release, source marker/grant and original reward or repayment-benefit reversal—not merely `status=failed`. The repayment branch was added in the review round below.

Exact operator names for main's runbook:

- Inbox result / public rejection: `EXPERT_RESIDENCY_CREDIT_INVALIDATED`.
- Signal provider: `expert_residency`.
- Signal reason: `expert_residency_paid_after_credit_invalidation`.
- Order status: `failed`; inbox status: `rejected`; initial signal status: `open`.
- Existing `latePaymentBinding` framing is retained (`expert-residency-late-payment-v1` plus authenticated inbox identity); no raw payload is exposed. List admits only the two known exception reasons. Detail additionally requires the exact reason/result pair and bound authenticated settled-event fact. Deadline result/reason remain `EXPERT_RESIDENCY_PAYMENT_EXPIRED` / `expert_residency_paid_after_deadline`. Support/session/MFA and operational resolve are unchanged.

### Lock/retry reasoning (source proof, not runtime acceptance)

Settlement and reversal use SERIALIZABLE, transaction-local250ms lock timeout (including implicit FK waits), and at most three whole-transaction attempts on40001/40P01/55P03 only. No production test hook. Reversal locks consuming orders before expert/grant/ledger authority; candidate-order acquisition uses NOWAIT to avoid a wait cycle between reversals holding different source orders. Sorted expert acquisition uses NOWAIT because checkout takes expert before order. Settlement's later feature-control acquisition also uses NOWAIT because checkout takes control first. Existing non-NOWAIT waits remain bounded by the local timeout; exhaustion preserves the SQL contention error rather than accepting partial writes. The shared retry helper and maturity worker are unchanged.

Checkout allocation phantoms require a fresh transaction: reversal predicate-reads the affected reservations, while checkout reads grant allocations that reversal changes. Both financial paths are SERIALIZABLE; the added controlled-schedule regression requires a retry and cancellation of the newly committed order. Source inspection alone is not sufficient proof of this concurrency behavior; the test is unrun.

### Regression inventory / verification boundary

Deterministic sequential settlement-first/reversal-first, split-grant cancellation, partial-release and corruption, and retained-payment/operator cases were written before implementation. Added cases then cover actual payment FK blocking behind reversal with fresh `pg_blocking_pids`/`pg_locks` observation, stale pending-order snapshot retry, allocation-phantom retry, partial-release expiry and foreign-grant corruption. Ten new cases in the SAME file, not a new execution budget. Real legacy rewards fund real campaign orders with literal100000/79820 allocations; historical partial releases/deadlines are explicitly privileged fixtures. There was no RED or GREEN execution for these new cases.

The existing mixed oracle retains exact entry/key/source/original/per-grant equality and at-most-one full release. It now recognizes only the approved terminal `EXPERT_RESIDENCY_CREDIT_INVALIDATED` outcome, reconciles failed order and rejected inbox/one signal, and still rejects duplicate refund+settlement releases. No financial expectation was increased to accommodate the failing PG3 row.

Static checks are recorded at final handoff below. PG remains3/3; operator API/PG and settlement-authority files remain separately exhausted and untouched. Existing green results predate this correction. No production readiness, live financial repair or provider reconciliation acceptance is claimed.

### Initial stable correction handoff (82-case source, before repayment P1)

- Environment preflight (`pwsh -File scripts/check-development-environment.ps1`): exit0, session71972. No PG/container operation was performed for this correction.
- `pnpm exec tsc --noEmit -p packages/db/tsconfig.json`: exit0, final session94607.
- `pnpm exec tsc --noEmit -p tsconfig.tests.json`: exit0, final session70517.
- Scoped ESLint on the three owned repositories and existing campaign test: exit0, final session37734.
- Prettier write completed on these four TypeScript files and this evidence; final check and `git diff --check` passed.
- No test command, test collection, substitute SQL experiment, DB build, migration reconstruction or old-suite execution. No change to the exhausted invocation counts. Baseline PG3 remains71/72 failed; the current82-case source has not run.

Independent source review and owner-authorized extra execution remain mandatory. Historical already-over-released records are deliberately rejected, not repaired; existing processed reversal replays are not a backfill command. Actual provider cash disposition remains a separately authorized operational workflow.

## Kant repayment-backed reservation P1 — corrected source, unrun

Authority: appended repayment-backed reservation section of `expert-credit-invalidation-fix.md`. The review finding is confirmed: the initial affected-order query followed only `g.first_settlement_id`, and cancellation depended on a direct `rewardGrant`. A marker whose benefit replenished an older grant could therefore lose its repayment without invalidating a pending order funded by that grant. The initial82-case source is not accepted as resolving this finding.

This round changes only the provider-inbox repository, the SAME campaign test file and this evidence. The shared release helper, admin repository, all SQL/schema/metadata, main-owned runbook/status/guards and other tests are unchanged.

- Affected-order discovery now includes original grants allocated to the marker's existing `debt_repayment` benefits in exactly the `first_settlement` / `held_reward_replay` namespaces, as well as grants issued directly by the marker. It still acquires consuming-order authority before later expert/grant/ledger locks, with the existing bounded retries and allocation-phantom protection.
- Cancellation is independent of whether the marker issued a new grant. The affected expert is checked against the marker's snapshotted inviter; each affected reservation is fully released through the existing per-original-grant helper. Unrelated pending orders and settled history are not cancelled.
- Existing repayment reversal amounts, direct reward reversal amounts and idempotency keys are unchanged. In particular, repayment reversal remains `repayment-reversal:<benefit ledger entry ID>`, `source_type=provider_reversal`, `source_id=<refunded qualifying order ID>`, `original_entry_id=<exact repayment benefit ID>`. Cancellation release still uses `refund-release:<marker ID>:<reservation ID>`.
- Failed-order recognition additionally binds the reservation's original grant to that marker's exact repayment benefit allocation and its exact negative reversal allocation on the SAME grant/expert/source order. An unrelated reversal on another grant cannot establish cancellation provenance. The direct-reward branch remains available.
- Operator result/reason remain `EXPERT_RESIDENCY_CREDIT_INVALIDATED` / `expert_residency_paid_after_credit_invalidation`; no runbook names, routes, debt policy or cash disposition changed.

Four parameterized positive regressions were written BEFORE the source correction: repayment-only and mixed direct/repayment benefits through both immediate settlement and held-reward replay. They exercise real grantA issuance/reversal, qualifyingB benefit production, pendingC checkout, B refund, C's rejected payment and bound support detail/replays. Mixed cases explicitly seed one historical60000 partial repayment before B; B's real existing producer then repays40000 and issues60000. This fixture does not establish new runtime debt policy. Exact original-grant releases, benefit/reward reversal entries and keys, final per-grant totals and available/reserved/debt balances are asserted. A separate genuine grant and pending order funded only by it must remain unaffected. A fifth negative test uses an explicitly forged privileged linkage to prove that a repayment reversal on A does not authorize failed-order recognition for a reservation funded only by D.

Current source count: **87 cases**, including these5 new unrun cases. No test execution, collection or SQL experiment. Campaign budget remains **3/3 exhausted**; last execution remains coordinator PG3 **71/72 FAILED**. Old exhausted files were not touched or rerun.

Static verification for this round: environment preflight exit0 (session53624); DB typecheck exit0 (session88049); shared-test typecheck exit0 (session28596); scoped ESLint exit0 (session58008); Prettier formatting and `git diff --check` passed. No test, collection or SQL experiment was used as a substitute for execution permission. Independent re-review by Kant and explicit owner extra-run permission remain pending; this is source progress, not a passing PG gate.
