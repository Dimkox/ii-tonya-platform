# Receipt contact current authority — implementation evidence

Spec: `docs/superpowers/implementation-artifacts/spec-receipt-contact-authority-fix.md`.
Baseline: `690797db64fd80aa1aeccea8003543de470d8c16`, branch `codex/planerka-api`.
Existing unrelated worktree changes are preserved. Owned files are the receipt
authority repository, the new focused integration test, and this evidence file.

Status: implementation, independent source review and coordinator verification
complete. This is not payment activation or release evidence.

## Changes

- Select the newest contact for the resolved payer and configured purpose before
  validating bindings. Invalid, denied, revoked, or policy-mismatched evidence
  cannot expose an older contact.
- Require an active subject, matching original consent subject/purpose/policy/
  decision, a verified non-revoked contact, and linked consent at the latest
  purpose timestamp. Reuse `currentConsentGrantedSql` for the existing all-grants,
  matching-policy timestamp-tie rule. Regrant requires fresh linked contact.
- Resolve campaign payer from `campaign_quote_id` and immutable quote `user_id`.
  Check the saved order/quote snapshot tuple (including provider deadline);
  missing/mismatched quotes cannot fall back to mutable expert ownership.
- Normalize raw PostgreSQL timestamp strings as well as Date values, preserving
  the encrypted-only public result interface. The real baseline test exposed
  the former unconditional Date-method call as a runtime failure.

## Execution ledger

Allocation: three executions total for
`tests/integration/yookassa-receipt-current-authority.test.ts`.
Author owns RED1/GREEN2; coordinator owns run3 after independent review.

- RequireDocker preflight: PASS, Node 24.21.0, pnpm 11.9.0, Docker 29.9.0,
  Compose 5.6.0. Retained synthetic container
  `ii-tonya-notification-t2-20261012-postgres-1` reports server version 170005.
- Tests typecheck before RED: initial TS2556 tuple spread error corrected;
  `pnpm exec tsc --noEmit -p tsconfig.tests.json` then passed (session 29530).
  Neither typecheck consumed a test execution.
- RED1: session 71054, 21:53:49 UTC, exit1, 3.80s: **22 failed / 1 passed**
  against the unchanged reader. All 23 tests collected and fixtures executed.
  Twenty-one failures encountered the production timestamp conversion defect
  (`row.verifiedAt?.toISOString is not a function`), including corruption probes
  that reported it instead of their rollback sentinel. One assertion proved that
  the reader returned denied evidence instead of null. Withdrawal/payer mismatch
  assertions were masked by timestamp conversion: do not claim independent
  behavioral RED for those conditions. No fixture/collection failure occurred.
- GREEN2: session 31180, 21:55:23 UTC, exit0, 3.95s: **26/26 PASS**.
  Three positive controls were added after RED and before GREEN: same-time
  matching grants, source admission to the synthetic decryption boundary, and
  explicit legacy-v1 compatibility. Those controls have no baseline RED claim.
- Coordinator3: session89476, 22:01:31 UTC, exit0, 4.08s: **26/26 PASS**,
  including final exact-input validation changes after independent source review.

**3/3 executions consumed. No rerun remains without explicit owner permission.**

Focused command: `pnpm exec vitest run tests/integration/yookassa-receipt-current-authority.test.ts`.
The retained container connection is derived in memory without printing or saving
credentials. The existing testkit creates and drops a random isolated database,
replays the real migrations, and the test asserts PostgreSQL 17.5.

## Coverage and boundaries

Tests use the real authority reader and consent-bound receipt source. Denied cases
install a throwing decryptor boundary to prove decryption is never reached; no
real contact, key resolution, plaintext decryption, or provider is involved.
Malformed-input checks use a throwing SQL boundary to prove zero queries.
The historical happy path runs in a PostgreSQL read-only transaction.
Campaign reassignment checks compare complete order/quote snapshots before and
after disclosure checks. Missing/mismatched quote corruption is confined to
rolled-back transactions in the random test database; ordinary migration guards
prohibit these states. No production migration or snapshot changes are made.

The 26 passing cases cover later denial/revocation; mixed decision/policy ties;
policy supersession; revoke/regrant; unrelated purpose; matching all-grant ties;
four mismatched original bindings; absent/denied evidence; inactive subject;
revoked/denied newest contact; eligible/withdrawn/inactive original campaign payer
after expert reassignment; missing/mismatched campaign quote; V1 and V2 historical
happy paths; source admission without decrypting; and malformed-input zero SQL.

## Static verification and review handoff

- `pnpm --filter @ii-tonya/db build`: PASS, session 33715, ESM and declarations.
- `pnpm --filter @ii-tonya/db typecheck`: PASS, session 94454.
- `pnpm exec tsc --noEmit -p tsconfig.tests.json`: PASS, session 84844, final tests.
- Scoped ESLint on the owned repository and new test: PASS, session 64523.
- Scoped Prettier and `git diff --check`: PASS (final check below).

Implementation has no pending edits or background commands. Review the current
three owned files against this baseline; no commit was created. Review focus:
latest-contact selection before evidence filtering, single-oracle consent ties,
fresh grant linkage, original campaign payer under owner reassignment, quote
snapshot binding, and read-only/encrypted-only results. Independent review is
left to the coordinator because the spec explicitly prohibits nested agents.

## Remaining gates and limitations

### Main review correction — exact input validation

Applied the main review finding after GREEN2: all three arguments now require
`typeof value === "string"` and full regex-match equality before SQL. This rejects
terminal line endings and prevents implicit coercion of non-string inputs.
The existing malformed-input test now covers LF, CRLF, null, undefined, numbers,
booleans, symbols, arrays, and string-coercible objects in every argument position.
No core consent/payer SQL changes were made in this correction.

Kant's final independent source review accepted the correction with no remaining
scoped finding. Coordinator3 then passed26/26, including these added cases.
Post-correction DB/tests typechecks and scoped ESLint passed in session64039;
scoped Prettier passed. No commit, push, provider call, deployment, migration or
old test execution occurred. This verifies the reader, not outbound admission.
Historical non-campaign orders retain the existing current-expert-owner lookup;
they lack an immutable historical payer snapshot. This remains a legacy payment
activation limitation. Purpose/policy/key selection and payment activation are
outside this correction.
