# Deferred final-call implementation — 2026-10-30

The owner approved one repeat after three days only when subscription is still
unpaid and the resident has not clicked “Оплатить тариф”. Telegram message-open
status is unavailable and is not inferred from delivery or clicks.

New unnumbered draft `drafts/early_bird_final_call_authority.sql` requires the
existing final-call queue draft, deferred-payments schema (0088), and deferred-refund
authority (0089). It
replaces the deliberately unavailable admission trigger with verified
ONBOARDING_ONLY eligibility: active user, current messaging authority, latest
`later` choice, exact qualification and manager approval, onboarding invoice with
matching independent verified binding, active wave config, and no subscription
settlement. Pending or succeeded refund bindings/facts/reconciliation block
notices; an independently verified canceled-refund resolution removes only that
pending block, while recorded refund facts continue to block. Daily eligibility starts at the configured 28 December 10:00 Moscow
time; repeat eligibility rounds actual delivery +72h up to a daily 10:00 tick.
The campaign enables the approved repeat rule per WAVE config, not globally.
An authenticated subscription callback records engagement before checkout. A
click from the dispatch/delivery-commit window also suppresses the repeat by
comparing engagement against notice creation, avoiding a false repeat when the
click commits before delivered_at is recorded.

A reminder uses an actionable bot callback, not a fabricated payment URL.
A November payer's receipt contact expires before late December; the callback
therefore resumes current tariff checks and, when necessary, fresh email capture
before creating a real YooKassa checkout. The message describes that step.

`PostgresDeferredFinalCallCampaign` plus the worker runtime/job provide concrete
scan, enqueue, durable dispatch, authenticated recipient/current consent recheck,
message delivery result bookkeeping and launch exclusion. Dispatched/uncertain
notices do not automatically retry. Exclusion compares independently verified
provider capture time strictly before launch: payments at or after launch do not
qualify for wave one. A delayed verified webhook for a timely payment clears an
exclusion without publishing a card. Publication remains a separate authority.
Account deletion and onboarding refund are not inferred from exclusion.

Verification ledger:

- Worker unit 2/2 passed; DB typecheck passed. An earlier worker-scoped check
  used the wrong package filter and is not counted as evidence. After the root
  package rebuild and launch-kit optional-header correction, the actual worker
  command `pnpm --filter @ii-tonya/app-worker typecheck` passed. Focused ESLint
  passed.
- PostgreSQL invocation 1: 1/1 passed.
- Invocation 2: 2/2 passed (repeat ticks, engagement/payment suppression included).
- Invocation 3: 2/3 passed; erasure failed because the historical queue guard
  uses unqualified relations while called from a pg_catalog-only erasure path.
  The new erasure function uses the required trusted public search path, and a
  public-schema CREATE privilege guard was added. New exact-boundary tests and
  per-config repeat policy changes followed before the authorized extra runs.
- The owner authorized two extra executions of failed PostgreSQL files.
  Invocation 4: 4/4 passed, including trusted-schema erasure correction,
  before/exact/after microsecond launch cutoff, repeat policy and click timing.
- Invocation 5 (last authorized extra): 4/4 passed through the root runner using
  the supported pinned PostgreSQL17.5 adminURL path. Added pending/canceled/refund
  fact suppression assertions passed. No further runs are authorized for this
  file. All earlier failures are retained.
- Fresh worker unit 2/2, focused ESLint and whitespace checks passed.

Tests use the real queue DDL and new authority SQL, with synthetic deferred tables
and qualification helpers. They do not replace a full migration-chain, actual
runtime-role, Telegram-provider or exact-SHA release witness. No production change.

Production transport is constructed internally from the configured token by
`createFinalCallTelegramTransport`: fixed Telegram HTTPS origin, redirect refusal,
8-second abort deadline, 16KiB response limit, exact bot/private-chat/message
identity checks and no retries. Three focused transport tests passed, including
a stalled synthetic network operation aborted after the actual 8-second timer.
No Telegram/provider network request was made by these tests.

Aggregate-role review correction: the replacement trigger functions
`early_bird_final_call_admission()` and `early_bird_final_call_erasure()` are
SECURITY DEFINER and now explicitly revoke PUBLIC execution. Their inherited
PUBLIC grant had blocked strict runtime principal audits. All definer functions
in this draft were checked for explicit revocation; the aggregate role witness
owns verification, and this exhausted focused file was not rerun.

## Isolated worker capability

`drafts/early_bird_final_call_worker_capability.sql` adds the single restricted
entrypoint `public.early_bird_final_call_worker(text,jsonb)`. Only the NOLOGIN,
NOINHERIT role `ii_tonya_wave_final_call_worker` receives EXECUTE; PUBLIC execution
is revoked. Queue operations, scheduling, exclusion and the current recipient/sending
snapshot execute behind this function. Engagement is deliberately excluded: the
worker cannot forge a user click. The separate owner-only API function
`early_bird_final_call_engage(uuid)` is invoked by `PostgresFinalCallEngagement`
only after the authenticated callback scope resolves the user. Neither PUBLIC nor
the worker role receives its execution privilege. No direct table rights
are needed by the runtime login. The application adapter now requires an explicit
expected login and executes the existing strict principal audit on each
transaction. The source/consent locks returned by the resume command remain held
through the single bounded transport callback. Unknown sends are not retried.

New focused PostgreSQL file
`early-bird-final-call-worker-capability.integration.test.ts`: **1/1 passed on
invocation 1/3**, using a real restricted login. It exercised scan, enqueue,
claim, once-only dispatch, current recipient snapshot, finish, engagement and
exclusion; direct SELECT was denied, and adding SELECT caused the role audit to
reject further use. The fixture uses actual queue/authority/capability SQL but
synthetic qualification/consent helper data. Aggregate actual-migration role
verification remains a separate release gate. No production change.

Root review ruling tightened click authority after the initial worker capability
run. Invocation 2/3 of the new isolated-role test passed: the worker's removed
`engage` command raises P0001, direct execution of the API helper is denied with
42501, and the actual API-owner port records the engagement. Delivery receipts
remain a trusted fixed-origin bounded Telegram transport boundary; SQL does not
claim cryptographic verification of Telegram message IDs. The final worker SQL
SHA256 is `871a87332c382e4a81323d9620d0cafd16ba1321cd93793228b2fa0470e460fe`.
