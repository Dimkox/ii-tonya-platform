# Task 5 remediation report

## Root causes fixed

- PostgreSQL returns `bigint`/aggregate values as strings through the raw Drizzle executor. All tariff, grant, order, allocation, balance, and quote money inputs are now normalized to `bigint` before domain arithmetic.
- Idempotent replay previously recomputed the effective deadline from the new request, so two different provider deadlines clamped by the same grant expiry appeared identical. Migration `0019` durably stores the original immutable `provider_deadline`; replay compares it directly.
- The balance view can retain expired grant value until expiry processing. `balance()` now projects live grants at `transaction_timestamp()`, excludes expiry equality, respects ledger allocations/reservations and debt, and does not require a worker run.
- Quote previously combined independent reads. It now uses one repeatable-read transaction and one database transaction instant.
- Tariff commands now reject non-bigint, non-positive, over-limit money; unsafe/fractional/NaN durations; and empty/oversized names and keys before SQL execution.

## Tests added or strengthened

- 13 invalid tariff boundary cases plus money/deadline serialization baseline.
- Conflicting original provider deadlines that clamp to the same grant expiry.
- Same-time FIFO ordering with a deterministic UUID tie-break.
- Expired-at-equality balance exclusion without worker processing.
- Deadline equality with real reserved credit, exactly one inverse release/allocation across two calls, and restored spendable balance.
- Migration is upgrade-compatible: nullable add, old-row backfill from effective deadline, then NOT NULL; a compatibility trigger supplies the old direct-insert contract.

## Verification

- `pnpm vitest run packages/db/src/repositories/expert-residency-repository.test.ts tests/repo/db-schema-parity.test.ts`: PASS, 23/23.
- `pnpm --filter @ii-tonya/db typecheck`: PASS.
- `pnpm --filter @ii-tonya/db build`: PASS including DTS.
- Focused ESLint: PASS.
- `git diff --check`: PASS.
- PostgreSQL suites: locally blocked before tests by `Could not find a working container runtime strategy`; exact Claw rerun remains the root-owned verification gate.

No deploy, staging, production, provider SDK, or feature activation was performed.

## Final re-review loop

- Normalized the raw active-tariff `price_minor` before checkout arithmetic and reused the normalized bigint for quote calculation, order insertion, and output.
- Declared raw reservation amounts as `bigint | string` and normalized them before computing the positive release amount.
- Added the database and Drizzle invariant `payment_deadline <= provider_deadline`, with the upgrade-safe migration order preserved.
- Added focused string-bigint regression coverage and updated schema-parity expectations.
- Final static verification: 24/24 focused tests, typecheck, build/DTS, ESLint, and diff check all pass.
