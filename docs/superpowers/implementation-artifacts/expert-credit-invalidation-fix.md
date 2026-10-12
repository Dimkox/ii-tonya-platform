# Expert credit invalidation — blocking correction

Status: implementation authorized, verification pending owner extra-run permission.
Parent: quote-bound campaign checkout and full commercial completion.
Baseline:690797db64fd80aa1aeccea8003543de470d8c16 plus current shared candidate.

## Evidence and authority

Coordinator campaign PG3 at20:19:02 returned71/72. Strengthened exact-ledger oracle
found an extra100000 refund-release alongside the settlement outcome. Source
inspection confirms reversal releases reserved credit without invalidating its
pending order; later settlement creates another full release and spends it.
For a100000 reservation allocated60000/40000 to two grants, reversal can emit a
partial60000 release. A second grant reversal skips the remaining40000 because
any release exists; expiry/settlement can instead emit another full100000 inverse.

These violate accepted ERR-FR019/020/022/034. The exact ledger test is protecting
required behavior; do not change its expected total to bless duplicate release.
This is not permission to mutate live ledgers or repair historical data silently.

## Approved technical decisions

- Use existing `failed` status for a pending order invalidated by reward reversal.
  Preserve financial snapshots. Durable cancellation provenance is the bound
  append-only release/reversal evidence; do not invent deadline expiry or refund.
- Preserve an authenticated payment that arrives after credit invalidation as a
  terminal rejected inbox fact, and insert one protected operator signal in the
  same transaction. Use a distinct fixed result/reason for credit invalidation,
  separate from deadline expiry. No automatic refund, repricing or extra charge.
- Extend the existing protected operator list/detail to this known exception.
  Keep exact reason/result correspondence and authenticated fact binding; no
  arbitrary wildcard reasons, raw payload/contact disclosure or public access.
  The current late-payment route may retain its URL, documenting both reasons.
  Operational resolution still does not prove provider refund.

These choices implement existing cancellation/payment invariants and are within
delegated technical authority. They are not new commercial debt or refund policy.

## Owned implementation scope

Harvey alone owns this correction:

- `packages/db/src/repositories/expert-residency-provider-inbox-repository.ts`:
  reversal/settlement authority and authenticated invalidated-payment handling.
- `packages/db/src/repositories/expert-residency-repository.ts`: shared allocation-
  aware release helper, preserving existing expiry behavior and idempotency.
- `packages/db/src/repositories/admin-repository.ts`: known exception filtering
  and exact detail binding only; unchanged support/session/MFA authority.
- Existing `tests/integration/expert-campaign-orders.test.ts` and its existing
  evidence file. Add targeted cases here, not a renamed file to reset the budget.

Main owns operator runbook, AGENT-STATUS, ledger and repository guards. Report the
actual new codes/behavior for main documentation. No schema/migration, unrelated
application/routes, provider, production, commit/push or nested-agent changes.
Request a concrete scope adjustment if these boundaries cannot safely implement
the accepted invariants; do not stop merely to reapprove these technical choices.

## Required behavior

- Given reversal first, when a grant is allocated to pending orders, lock and
  revalidate the affected orders, invalidate them and release each entire original
  reservation across all its grants atomically. Reverse only the qualifying grant.
  No later settlement may activate an invalidated order or spend its cancelled
  allocation. Other grants are restored, not reversed as a side effect.
- Given settlement first, retain completed financial/history facts; reversal of
  historically spent reward produces the accepted debt, not order cancellation.
- Determine authority consistently with concurrent checkout, settlement, expiry
  and reversal. Re-read state after waits/retry, cover allocation phantoms and
  implicit FK locks, and keep retry/lock handling bounded. Do not introduce an
  unexamined order→expert / expert→order deadlock or claim isolation alone solves it.
- Release is derived per original reservation AND grant. Subtract existing valid
  release allocations, append only the outstanding inverse, and preserve replay.
  A historical partial release must neither hide the remainder nor authorize a
  second full inverse. Already over-released or mismatched facts fail closed;
  never silently compensate corruption or rewrite old facts.
- Given payment after invalidation (including replay/race), retain exact verified
  cash/currency/provider identity, preserve failed order/no entitlement, and surface
  its distinct bound operator exception. Commit before the public rejection.
  Exact replay after support resolution creates no additional signal/release.
- Support list/detail must find this exception and deny unauthorized/stale-MFA
  reads. A deadline-expiry signal must not cross-bind an invalidation event or vice
  versa. Existing operational resolve does not change money or entitlements.

## Tests and verification limits

Keep the71/72 failed PG3 result as evidence; it is a real detected safety issue,
not a passed gate. Write deterministic settlement-first/reversal-first and split-
grant cases before implementation. Cover second-grant reversal, expiry replay,
partial historical release, rejected payment retention and protected visibility.
Preserve exact ledger/per-grant/ownership/timestamp assertions, no lower oracle.

The campaign file has consumed3/3. **No further execution is currently authorized.**
One additional full focused invocation was requested from the owner; unanswered.
The separate settlement-authority file is also3/3 with its own unanswered extra1.
Admin operator PG/API files are3/3; their earlier green results predate this fix.
Do not run them, run a full/multipath suite, or copy cases into a new file.
Code/static progress is allowed while awaiting authority; label new tests unrun.
Check relevant types, scoped lint/formatting and diff; independent source review
before any authorized extra run. Source acceptance alone is not execution proof.

## Independent review fix round: repayment-backed reservation

Kant found a P1 in the stable82-case correction. Main verified the code path:
affected-order discovery follows a grant's original first settlement and the
cancellation loop is inside `if (rewardGrant)`, while repayment benefits are
reversed separately. Thus a settlement that only replenished an older grant by
debt repayment can be refunded without invalidating a pending order funded by it.

Extend the SAME correction and file ownership to this existing benefit path.
Discover affected original grants from both direct issuance and debt-repayment
allocations (`first_settlement` and `held_reward_replay`) of the reversed marker.
Lock/revalidate and cancel affected pending reservations independently of whether
the marker created a new reward grant. Preserve settled orders and exact existing
repayment/reversal amounts; this is not permission to introduce a new debt policy.

Extend durable failed-order recognition to the exact bound repayment benefit and
its reversal, not a generic failed state or arbitrary unrelated reversal. A later
verified payment must retain the same distinct operator exception and replay
guarantees. Cover repayment-only and combined direct/repayment benefits, later
payment, and unaffected grant preservation in the EXISTING campaign file before
the source correction. Keep tests UNRUN and budget3/3; no new execution authority.
Same Harvey implements; same Kant rechecks this delta after stable handoff.
