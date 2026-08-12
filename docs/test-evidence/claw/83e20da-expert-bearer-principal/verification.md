# Expert Bearer principal boundary: Claw verification

## Identity and scope

- Branch base: `83e20da49de061f278f6a3f9d42920b4cf34d5bc`.
- Task 1 commit: `8efb458 feat: add expert bearer principal resolver`.
- Exact fresh tested source commit:
  `93334aa487572f305fd612cc4e1eaaa93703bb74` (`test: verify expert identity outage semantics`).
- Exact resolved `ii-tonya-test` image tag:
  `7d71646347d560ff2b5d8ebc4c0aad5b48230254`.
- Tests ran only in the authorized `ii-tonya-test` profile on Claw. The Claw
  `/home/pall/app-stack/docker-compose.yml` limits that service to 1 CPU and 1 GiB.
- `--entrypoint sh` intentionally bypassed the profile's broad default wrapper.

## RED evidence

Task 1 copied only the new resolver test. The focused command exited 1 at collection
because `./expert-principal-resolver.js` did not exist. Vitest selected one file and ran
no tests (`Test Files 1 failed`; `Tests no tests`).

The Task 2 initial copy-only attempt likewise exited 1 at collection because the old
Claw source did not contain `./expert-principal-resolver.js`. It was restored immediately
and is environmental evidence, not a valid RED result. After temporarily synchronizing
only the Task 1 resolver, the valid Task 2 RED exited 1: 20/21 tests passed and the new
case failed with `expected 200 to be 500`, proving the unchanged helper ignored the
injected `principals` dependency.

## Final focused GREEN evidence

The final command was:

```text
II_TONYA_SOURCE_SHA="$tag" docker compose --profile test run --rm --no-deps --entrypoint sh ii-tonya-test -lc 'CI=true ./node_modules/.bin/vitest run apps/api/src/expert-principal-resolver.test.ts apps/api/src/app.test.ts --maxWorkers=1'
```

The initial Task 2 report did not retain the aggregate duration. To establish exact
evidence, the mounted test source was freshly synchronized with
`git archive 93334aa487572f305fd612cc4e1eaaa93703bb74` before one new invocation of the
command above. It exited 0 with the image tag recorded above: 2 files and 37 tests
passed, `expert-principal-resolver.test.ts` 16/16 in 17ms and `app.test.ts` 21/21 in
1028ms; Vitest duration was 5.00s (transform 1.11s, collect 3.03s, tests 1.04s,
environment 1ms, prepare 320ms). Task 1's separate resolver-only GREEN run was 1 file,
16/16 tests, 717ms total.

## Static verification

- ESLint: Task 1's four resolver-related files passed; Task 2's `app.test.ts` passed.
- TypeScript: `pnpm exec tsc --noEmit -p apps/api/tsconfig.json` was not runnable:
  TS5058 because `apps/api/tsconfig.json` is absent. No substitute typecheck was claimed.
- Prettier: Task 1's four files passed after formatting the existing route file. Task 2's
  `pnpm exec prettier --check apps/api/src/app.test.ts` exited 1 under Prettier 3.9.6;
  checking the identical unchanged `HEAD` content also exited 1. It is inherited
  whole-file formatting debt, and no broad historical reformat was added.
- `git diff --check`: passed for each implementation task before commit.

The 37-test focused run covers ERR-AUTH-007 lookup-failure handling through the composed
API 500 test.

ERR-AUTH-008 was verified separately after controller publication. The mounted source was
synchronized from exact branch commit
`b1777bd8e54fa86c54615b5f50157f7e9a48d34c` and the same resolved image tag
`7d71646347d560ff2b5d8ebc4c0aad5b48230254` was used for one focused invocation:

```text
II_TONYA_SOURCE_SHA="$tag" docker compose --profile test run --rm --no-deps --entrypoint sh ii-tonya-test -lc 'CI=true ./node_modules/.bin/vitest run packages/observability/src/logger.test.ts --maxWorkers=1'
```

Result: exit 0; `packages/observability/src/logger.test.ts` passed 2/2 in one file,
719ms total (tests 53ms). The test serializes a real Pino log entry containing an
authorization credential and asserts that the credential is absent from the emitted log.
Mandatory hosted CI/security regression remains required; this focused evidence does not
replace it.

The Task 3 documentation rerun also passed ESLint for all five touched API files and
`git diff --check`. It reproduced TS5058 for the absent API tsconfig. Its combined
Prettier command exited 1 and named `apps/api/src/app.test.ts` plus this pre-existing
traceability file; the new handoff and Claw evidence file were not named as failures.
No broad formatting rewrite was added to an evidence-only increment.

## Restoration and cleanup

After each exact-SHA run, including the ERR-AUTH-008 logger run, the source mounted into Claw was restored to base
`83e20da49de061f278f6a3f9d42920b4cf34d5bc`. A post-restore remote check returned:

```text
test_containers=0
focused_processes=0
```

No production, Compose, Billing, database, session-provider, or live composition change
was made. Hosted CI and Billing/Actions execution remain release boundaries; this evidence
does not authorize publication, deployment, feature activation, or production use.

## Final three-run branch gate

The repeat policy was reduced from 20 to a hard maximum of three in every environment.
`scripts/repeat-vitest.mjs` rejects larger counts and every Database Gate invocation now
uses `pnpm test:repeat -- 3 ...`. All verification below ran only on Claw.

Exact tested source: `ce72fa3d21f5a913ff06f1f8afa0eb883e89fb13`; test image:
`7d71646347d560ff2b5d8ebc4c0aad5b48230254`; Node `24.18.0`; pnpm `11.9.0`;
1 CPU; 1 GiB RAM. Frozen install, build, format check, deploy contract, ESLint,
workspace typecheck and production dependency audit all exited 0. The audit reported no
known vulnerabilities.

The complete Vitest corpus ran exactly three times with `--maxWorkers=1`:

| Run | Files | Tests | Duration | Exit |
| --- | ---: | ---: | ---: | ---: |
| 1 | 120/120 | 983/983 | 310.94s | 0 |
| 2 | 120/120 | 983/983 | 316.30s | 0 |
| 3 | 120/120 | 983/983 | 314.17s | 0 |

The already completed packaged-image smoke remained a single production-like run, as
required by the policy excluding production smoke from repetition. No production code
changed afterward; the final changes are test policy, tests and database-test cleanup.
Raw logs and SHA-256 checksums remain on Claw under
`/home/pall/app-stack/ii-tonya-test-workspace/results/ce72fa3d21f5a913ff06f1f8afa0eb883e89fb13-three-pass/`.
After verification, the mounted source was restored to
`83e20da49de061f278f6a3f9d42920b4cf34d5bc`; cleanup proved zero test containers and
zero Vitest/repeat processes.
