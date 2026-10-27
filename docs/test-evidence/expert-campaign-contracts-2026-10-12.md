# Expert campaign transport contracts — 2026-10-12

Scope: Task2a in `docs/superpowers/plans/2026-10-12-expert-campaign-quotes.md`.

Strict shared request schemas accept a tariff UUID, literal numeric term1/3 and
idempotency key for quotes; checkout accepts only quote UUID and key. UUIDs are
canonicalized to lowercase. Keys are not rewritten. Unknown authority fields,
numeric coercion, missing fields and trailing control characters are rejected.
The contracts barrel exports both schemas and inferred types.

Verification history:

- RED1 at18:52:54:44 tests,7 failed,37 passed against empty strict-object scaffolds.
  Negative cases passing that scaffold are not individually proven RED.
- Run2 was started before context recovery; its terminal output was not recovered.
  Count it as consumed, not as a pass.
- Independent source review by McClintock accepted implementation and identified
  missing isolated required-field cases. Added one test covering missing term and
  missing key independently in otherwise valid quote/checkout requests.
- Final focused run3 at18:59:27:48/48 PASS,608ms, exit0:
  `pnpm exec vitest run packages/contracts/src/expert-campaign-quotes.test.ts`.
  Three planned invocations consumed. No PostgreSQL or provider calls.
- Contracts ESM/DTS build, contracts typecheck, ESLint on both new files and the
  barrel, and `git diff --check`: command chain exit0 (session44543).

This proves shared parsing only. Runtime authentication, ownership, quote expiry,
order binding and payment activation are not covered and remain separate work.
Routes must not strip unknown properties before invoking these strict schemas.
No commit, push or production change.
