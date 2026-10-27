# Expert campaign quote storage — Task1 handoff

Scope: Task1 of `docs/superpowers/plans/2026-10-12-expert-campaign-quotes.md` only.
Shared worktree, branch `codex/planerka-api`, base HEAD
`690797db64fd80aa1aeccea8003543de470d8c16` (uncommitted changes).
No public route, production activation, provider call, commit, push, deployment,
nested agent, or exhausted test execution. The frozen booking-handoff test and
coordinator-owned contracts/repository guards were not edited for this task.

## Bounded PostgreSQL ledger

Final coordinator verification: PG3 at19:14:30UTC,67/67PASS,19.10seconds,exit0.
Kant accepted the real-lock refinement before execution. RequireDocker preflight
and exact retained container/version170005 were rechecked immediately beforehand.
All three focused invocations are now consumed; no further PG run is authorized.
This supersedes pending-PG3 notes below, retained as the chronological handoff.
Both actual row-wait scenarios and the competing subject deactivation passed.
No production or provider operation was executed.
Post-run DB typecheck, shared test typecheck, scoped quote-file ESLint and
`git diff --check` also exited0 (coordinator session5449).

Only `tests/integration/expert-campaign-quotes.test.ts` was invoked:

| Invocation      | Start UTC, 2026-10-12 | Result                           | Interpretation                                                                                                                             |
| --------------- | --------------------- | -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| RED1            | 18:58:31              | 58 failed / 2 passed (60), exit1 | Compileable repository/table scaffolds; expected typed-result, missing arithmetic/source checks and append-only failures. Setup succeeded. |
| Intended GREEN2 | 19:04:29              | 65 passed / 1 failed (66), exit1 | Implementation passed all executed assertions except the last test's wait query, which failed before its later-stage assertions.           |
| PG3             | 19:14:30              | 67 passed, exit0                 | Coordinator final run after independent review of real-lock tests.                                                                         |

Both commands used `pnpm exec vitest run tests/integration/expert-campaign-quotes.test.ts`
with the synthetic `II_TONYA_TEST_POSTGRES_ADMIN_URL` supplied out of band. The
container `ii-tonya-notification-t2-20261012-postgres-1` was checked before tests:
running `postgres:17.5-bookworm`, IP `192.168.112.2`, actual server version170005.
The testkit created, migrated and removed isolated test databases; the shared
container was retained. Development preflight with `-RequireDocker` passed.

The run2 failure was test SQLSTATE22003: epoch milliseconds1791831888709 were
inferred as int4 by `$1 + 2` in the stage wait query. The adjacent, passing tariff
wait query already used `$1::numeric`. The initial post-run correction added the
same explicit `::numeric`; the review refinement below retains this cast in both
wait queries. **No subsequent PG execution:** the corrected/refined later-stage
assertion is not claimed green. No production clock injection or timeout change
exists.

Six cases added before run2 pin trailing-newline rejection, fractional tariff-end
flooring/final-stage lifetime, and three exact Start boundaries. These belong to
the same logical file and do not reset its invocation budget.

### Kant P2 refinement — source only, no further invocation

Verified the review finding: the run2 tests gated before SQL submission and
released the blocker before submitting `FOR SHARE`. They did **not** establish
real row-lock contention. Run2's65 passing cases must not be cited as proof of
post-row-lock clock behavior.

Only the existing quote test and this evidence were refined:

- The executor gate captures `pg_backend_pid()` and the real transaction start,
  then forwards the unchanged authority query after gate release.
- Both existing tariff cases hold real `FOR UPDATE` on the source row, release
  the gate to submit the consumer's actual `FOR SHARE`, and require observation
  of that consumer blocked on the exact blocker PID **before blocker commit**.
  A separate dedicated autocommit connection checks `pg_blocking_pids` and an
  ungranted `pg_locks` entry. No `pg_stat_activity` query-text polling or cached
  statistics snapshot is involved. The blocker stays held throughout the bounded
  observation.
- The retirement case changes the locked source's active end to a still-future
  PostgreSQL timestamp, crosses it while the consumer remains blocked, then
  commits. It requires `EXPERT_CAMPAIGN_TARIFF_INACTIVE` and zero anchors/quotes.
- The stage case first proves the row wait, seeds a **privileged historical
  fixture** with a boundary after that observation, waits across it, then commits
  the blocker. The result must retain that anchor and use30% Energy/10% Start,
  monthly629370, total1888110, with one anchor/quote and no financial effects.
  This anchor insert is deliberately not represented as a normal competing
  quote writer: normal writers serialize on the subject authority.
- One added case uses a competing document/subject-authority transaction to
  deactivate the user. It proves the consumer's actual advisory lock is blocked,
  commits deactivation, and requires `EXPERT_CAMPAIGN_USER_INACTIVE` with zero
  anchor/quote/order/ledger/outbox rows. It uses the real existing namespace.
- Cleanup rolls back the blocker before awaiting unfinished consumer work, so
  failed observation cannot strand a consumer behind the test's own lock.

The logical file now contains67 cases; this does not reset its budget. PG usage
remains2/3, with PG3 reserved for the coordinator after review. Repository, schema,
0047 SQL and generated metadata are unchanged by this refinement. All refined
contention assertions remain unexecuted until that authorized run.
Post-refinement tests typecheck, scoped ESLint, Prettier check and
`git diff --check` passed. An initial typecheck caught an unavailable root-level
`pg` type import; the observer now derives its query type from the existing
`DrizzleDb` client instead, with no dependency change.

## Implemented source contract

- Repository command accepts exactly user ID, tariff ID, numeric1/3 term and
  idempotency key. UUIDs are canonicalized lowercase before locking/comparison.
  Internal opaque keys allow1..200 characters; transport remains the coordinator's
  stricter8..128 contract. Caller clock/price/identity extras are rejected.
- READ COMMITTED transaction: document SHARE barrier → existing subject advisory
  namespace → active user SHARE lock → same-key replay/conflict → tariff SHARE
  lock → existing anchor → fresh millisecond `clock_timestamp()`.
- Replay checks active user but not current tariff applicability; expired/retired
  snapshots replay unchanged. New keys reuse the same user/rule anchor, including
  after expert-row creation. First successful anchor and quote are atomic.
- Reviewed `calculateExpertCampaignPrice` owns bigint arithmetic. Expiry is the
  minimum of15 minutes, floored tariff end and the next stage. Source endpoints
  use ceil comparisons at integer millisecond precision. Three months end at144h;
  quotes cannot have zero duration. Amounts leave the repository as decimal strings.
- SQL independently checks rule/currency/key/time precision/stages/term/duration,
  exact numeric half-up rounding, final monthly500000 floor, term multiplication,
  and total1..999999999999. The composite FK binds the exact immutable anchor.
- BEFORE INSERT source enforcement locks in the same authority order, binds a
  real active V2 tariff's base/display/entitlements and exact expiry, and rejects
  internally consistent forged prices. Two append-only triggers reject UPDATE/
  DELETE of anchors and quotes. Historical0032 and old tariff/order policies stay
  unchanged. Quotes do not write orders, credit, provider or outbox facts.
- Typed errors are content-free; unexpected driver/SQL errors are replaced with
  `EXPERT_CAMPAIGN_STORAGE`, without raw causes or command logging.

## Metadata and static verification

0047 was reserved after confirming the journal ended at0046. Hand-authored SQL was
replayed on an isolated **PG17.5** database, never16. Fresh-directory Drizzle
introspection was normalized through the existing migration-state helpers, with
exact SQL objects retained separately. No `drizzle-kit generate` was used.

- Journal:48 entries, indices0..47; final tag `0047_expert_campaign_quotes`.
- Snapshot:118 public tables, exactly two additions:
  `expert_campaign_anchors`, `expert_campaign_quotes`; previous snapshot ID links
  to0046.
- SQL supplement:37 functions,68 non-internal triggers. One added function:
  `enforce_expert_campaign_quote_source`; three added triggers:
  `expert_campaign_quote_source`, `expert_campaign_anchors_append_only`,
  `expert_campaign_quotes_append_only`.
- Extensions remain `btree_gist`1.7 and `pgcrypto`1.3.
- Every prior SQL hash matched0046's manifest before replay. All48 SQL hashes,
  snapshot hash, supplement hash and previous-snapshot linkage independently
  matched0047's manifest after reconstruction.
- DB typecheck, tests typecheck, scoped ESLint, scoped Prettier check and
  `git diff --check` passed. DB build passed ESM and DTS; build directory released.
  No broad suite, contracts suite or coordinator-owned repo guards were run.

Reconstruction helper is ignored local tooling at
`.cache/expert-campaign-quotes/reconstruct.ts`, adapted from the preceding
reconstruction procedure. It uses an isolated testkit database and a fresh OS
temporary introspection directory and removes both on completion. Its generated
artifacts, not the ignored helper or build output, form the handoff.

## Changed paths for this task

1. `packages/db/src/repositories/expert-campaign-quote-repository.ts`
2. `packages/db/src/schema/expert-campaign-quotes.ts`
3. `packages/db/src/index.ts` — quote exports only; other owners' exports preserved.
4. `packages/db/src/schema/index.ts` — quote schema export only.
5. `packages/db/migrations/0047_expert_campaign_quotes.sql`
6. `packages/db/migrations/meta/_journal.json` — appended0047 only.
7. `packages/db/migrations/meta/0047_snapshot.json`
8. `packages/db/migrations/state/0047_manifest.json`
9. `packages/db/migrations/state/0047_sql_objects.json`
10. `tests/integration/expert-campaign-quotes.test.ts`
11. `docs/test-evidence/expert-campaign-quotes-2026-10-12.md`

## Pending gates and actual integration gaps

Independent review (Kant) found two boundaries to record before PG3:

- The original wait tests did not prove real row-lock contention. The source-only
  P2 refinement above now requires blocked-backend observation before release;
  its runtime verification remains pending coordinator PG3.
- SQL validates supplied timestamp relationships, tariff snapshot and arithmetic,
  but does not prove issue/anchor timestamps came from a current server clock.
  Privileged direct SQL can insert fabricated future/historical facts. The public
  repository rejects caller clock fields and supplies its own fresh clock. Treat
  direct SQL write access as trusted financial authority; do not claim equivalent
  untrusted-writer clock protection from SQL checks alone. Historical fixtures use
  that privileged insertion ability and are not a separate production API.

Coordinator ruling: retain repository-owned server-clock authority for this
storage phase; no arbitrary tolerance window or backdating API is introduced.
This is narrower than a database-enforced current-clock provenance guarantee.
Before adding any alternate quote writer, enforce the same server-clock contract;
direct SQL import/backfill is not an authorized user-facing pricing route.
The cost of this boundary is that a compromised privileged writer can manufacture
timestamps; timestamp CHECK constraints alone must never be advertised otherwise.

Review of the P2 refinement and coordinator PG3 remain pending. Coordinator
reported history guard8/8 and state baseline11/11 after0047 metadata handoff;
the implementation agent did not execute those guards. This is a
source/metadata handoff, **not an all-green or release-complete claim**.

Task2a request schemas exist separately; storage is not yet composed into an
authenticated API/Telegram/promo flow. Quote-to-expert ownership, single quote
consumption, checkout expiry after locks, immutable campaign order financial
snapshots, credit reservation/conservation, monthly group-allowance accounting,
provider amount/duration and settlement/refund/replay behavior remain future
assignments. Existing v1/v2 settlement and referral markers must not be broadened
by this storage phase. Exact-candidate journey, release and rollback evidence are
still required before any separately authorized activation.
