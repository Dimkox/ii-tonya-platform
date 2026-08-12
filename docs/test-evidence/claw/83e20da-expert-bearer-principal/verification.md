# Expert Bearer principal boundary: Claw verification

## Identity and scope

- Branch base: `83e20da49de061f278f6a3f9d42920b4cf34d5bc`.
- Task 1 commit: `8efb458 feat: add expert bearer principal resolver`.
- Task 2 commit: `93334aa test: verify expert identity outage semantics`.
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

Result: exit 0; 2 files and 37 tests passed: `expert-principal-resolver.test.ts` 16/16
and `app.test.ts` 21/21. The aggregate Vitest duration was not retained in the supplied
Task 2 report, therefore it is not fabricated here. Task 1's separate resolver-only
GREEN run was 1 file, 16/16 tests, 717ms total.

## Static verification

- ESLint: Task 1's four resolver-related files passed; Task 2's `app.test.ts` passed.
- TypeScript: `pnpm exec tsc --noEmit -p apps/api/tsconfig.json` was not runnable:
  TS5058 because `apps/api/tsconfig.json` is absent. No substitute typecheck was claimed.
- Prettier: Task 1's four files passed after formatting the existing route file. Task 2's
  `pnpm exec prettier --check apps/api/src/app.test.ts` exited 1 under Prettier 3.9.6;
  checking the identical unchanged `HEAD` content also exited 1. It is inherited
  whole-file formatting debt, and no broad historical reformat was added.
- `git diff --check`: passed for each implementation task before commit.

The Task 3 documentation rerun also passed ESLint for all five touched API files and
`git diff --check`. It reproduced TS5058 for the absent API tsconfig. Its combined
Prettier command exited 1 and named `apps/api/src/app.test.ts` plus this pre-existing
traceability file; the new handoff and Claw evidence file were not named as failures.
No broad formatting rewrite was added to an evidence-only increment.

## Restoration and cleanup

The source mounted into Claw was restored to pushed base
`83e20da49de061f278f6a3f9d42920b4cf34d5bc`. A post-restore remote check returned:

```text
test_containers=0
focused_processes=0
```

No production, Compose, Billing, database, session-provider, or live composition change
was made. Hosted CI and Billing/Actions execution remain release boundaries; this evidence
does not authorize publication, deployment, feature activation, or production use.
