# Task 8 report — disabled expert residency services

## Status

IMPLEMENTED_AWAITING_REVIEW from base
`dfc69354f55f1391105beae319980c5e724fcf3b` in the commit named
`feat: add disabled expert residency services`.

The framework-free application boundaries, default-off environment ceilings,
fresh durable command controls, strict HMAC key resolver, and startup keyring
validation are implemented. No live payment provider, SDK, network route,
credential, secret value, or activation was added.

## Implementation

- Added `ExpertReferralService` and `ExpertResidencyService` behind narrow local
  ports. Every owner read or new command reauthorizes the complete expert,
  user, provider, and external identity. Summary and committed checkout results
  fail closed on an unexpected owner.
- Redemption, quote, and checkout require their environment ceiling and a
  fresh durable `new_commands_enabled` read. The PostgreSQL residency quote and
  checkout transactions also lock and enforce the durable switch, so the
  authoritative check covers the financial mutation instead of relying on the
  application read alone.
- Existing verified settlement, refund, reconciliation, expiry/release,
  reversal, debt, and held-reward replay operations bypass both new-command
  ceilings. The existing repository-owned, transaction-time
  `reward_grants_enabled` behavior remains unchanged and uncached.
- Checkout first commits the local order, verifies its owner, and derives the
  provider-neutral payment command only from the committed order's cash,
  currency, and deadline fields. No client-provided amount is accepted.
- Added default-off `EXPERT_REFERRAL_ENABLED` and
  `EXPERT_RESIDENCY_BILLING_ENABLED`. Enabled referral configuration requires a
  safe `vN` current version and the exact
  `env://EXPERT_REFERRAL_HMAC_KEYS_JSON` reference. Unknown legacy expert
  commercial flags fail closed.
- Disabled configuration selects only known non-secret fields and never reads,
  parses, copies, or exposes the HMAC JSON value. Runtime config returns only
  safe feature state and version/reference metadata.
- Added a strict environment resolver for a version-to-canonical-base64url map.
  Every key must decode to at least 32 bytes; current and active issued-code
  versions must all exist. Returned keys are disposable copies, partial decoded
  state is zeroed on failure, and errors expose only fixed reason codes plus
  valid version labels.
- Added fresh PostgreSQL `readForCommand()` and the narrow distinct
  active-issued-code version query. API dependency composition reads those
  versions and constructs `ExpertCodeCrypto` before listening only when the
  referral ceiling is enabled.
- Updated the checked-in environment examples, Compose defaults, release
  validator, and exact scope hashes. The examples contain only disabled flags,
  the `v1` marker, the reviewed reference, and an instruction that secret
  material is intentionally absent.

## Strict RED/GREEN evidence

First service/config slice:

```text
corepack pnpm vitest run packages/application/src/expert-referral-service.test.ts packages/application/src/expert-residency-service.test.ts packages/config/src/env.test.ts
RED — both service modules were absent and four configuration expectations failed
GREEN — 3 files, 25/25 tests passed
```

Secret resolver:

```text
focused resolver invocation
RED — resolver module absent
GREEN — 12/12 tests passed

invalid requested-version redaction mutation
RED — unsafe invalid label was retained in the error versions field
GREEN — 13/13 tests passed with sanitized labels only
```

Durable controls and transaction ceilings:

```text
focused PostgreSQL repository invocation
RED — readForCommand and activeIssuedCodeKeyVersions were absent; disabled
      quote/checkout reached tariff handling instead of failing closed
GREEN — 14/14 focused repository/integration tests passed
```

Startup composition and environment artifacts:

```text
apps/api/src/server.test.ts
RED — 2/6 failed because enabled startup did not query versions or resolve keys
GREEN — 6/6 passed

tests/repo/env-policy.test.ts
RED — 2/3 failed before the flags/reference/validator changes
GREEN — 3/3 passed
```

Ownership mutations were also exercised as independent RED/GREEN slices:
summary initially returned another owner's result, and checkout initially sent
payment after receiving another owner's committed order. Both now fail closed
before disclosure or payment.

## Final verification

```text
Task 8 focused gate:
7 files, 57/57 tests passed

scope, dependency, release-asset, and referral guards:
4 files, 167/167 tests passed

impacted Task 4–7 provider-neutral regressions:
61/61 tests passed after adding the now-required durable-control setup to the
checkout concurrency and deadline fixtures

corepack pnpm -r --sort run typecheck
exit 0 — all 10 workspace projects passed

corepack pnpm --workspace-concurrency=1 -r --sort run build
exit 0 — all 10 workspace projects passed, including declaration builds

exact changed-TypeScript ESLint
exit 0

exact changed-TypeScript/YAML Prettier check
exit 0

bash -n scripts/validate-runtime-env.sh
exit 0

git diff --check dfc69354f55f1391105beae319980c5e724fcf3b
exit 0
```

The initial broad regression run exposed only two test fixtures that still
assumed the pre-Task-8 implicit enabled state. Production correctly failed
closed. The fixtures now explicitly enable the durable command switch, and the
targeted rerun passed 3/3.

## Self-review and concerns

- Confirmed application modules have no Fastify, Drizzle, runtime-environment,
  provider SDK, or network imports.
- Confirmed the disabled lifecycle does not query active versions or invoke the
  secret resolver, and no committed example assigns
  `EXPERT_REFERRAL_HMAC_KEYS_JSON`.
- Confirmed safe errors contain no raw JSON, encoded key, decoded key, code,
  payment identifier, or secret environment value.
- Confirmed durable controls are not cached and existing-state processing has
  no application precheck that could bypass the existing locked reward-control
  transaction.
- Confirmed only the Task 8 files are selected for the commit; unrelated dirty
  and untracked artifacts remain untouched.
- No known failing Task 8 check or implementation concern remains. Independent
  review is the remaining completion gate; both commercial ceilings remain
  disabled and this commit contains no staging or production activation.
