# Expert API test composition verification

Date: 2026-08-12

Base source: `3f8ed564cff7d284a74244ab64a1304419be5199`

Scope: uncommitted expert API composition delta

Environment: existing Claw `ii-tonya-test` Compose profile only

## Resource evidence

```text
memory_max=1073741824
cpu_max=100000 100000
```

This is a 1 CPU / 1 GiB isolated test container. No production service, deployment flag,
Compose definition, or database was changed by the verification.

## RED

Command inside the test container:

```bash
CI=true ./node_modules/.bin/vitest run apps/api/src/app.test.ts --maxWorkers=1
```

Result before implementation:

```text
Test Files  1 failed (1)
Tests       2 failed | 12 passed (14)
```

The initial composition case observed `404` instead of `200`, proving that the normal app
did not register the expert route. The missing-capability case also failed before the
bounded startup assertion existed.

Independent review then added a second focused RED cycle. It produced five expected
failures and fifteen passes: independent feature flags were not isolating route groups,
additional financial fields were stripped instead of rejected, payload-too-large became
409 instead of 413, and unexpected service faults became 409 instead of 500.

## GREEN

The same focused command was run after the minimal implementation:

```text
Test Files  1 passed (1)
Tests       20 passed (20)
Duration    4.59s
```

No repeat loop and no full test suite were run.

## Static verification

Commands inside the same constrained test profile:

```bash
CI=true ./node_modules/.bin/tsc --noEmit -p tsconfig.base.json
CI=true ./node_modules/.bin/eslint \
  apps/api/src/app.ts \
  apps/api/src/app.test.ts \
  apps/api/src/routes/expert-referral.ts
```

Both commands exited `0`. Local `git diff --check` also exited `0`.

## Release boundary

This evidence covers only the test composition increment. It is not full verification,
hosted CI, Database Gate, staging evidence, provider-contract evidence, or production
authorization. PR #4 remains Draft and all live expert/payment flags remain disabled.
