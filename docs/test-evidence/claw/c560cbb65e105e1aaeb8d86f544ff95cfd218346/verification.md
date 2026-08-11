# Focused Claw verification for `c560cbb65e105e1aaeb8d86f544ff95cfd218346`

- Branch: `codex/task25-expert-referral-implementation`
- Test host: Claw `192.168.0.229`
- Finished: `2026-08-11T21:23:40Z`
- Result: focused real-PostgreSQL E2E passed; process exit code `0`
- GitHub Actions: not invoked
- Raw log SHA-256: `4fe8a3d0b494f079c7442e110c4f47bd612bba52be001d522b037c9acd95a9e9`
- Dependency image ID: `sha256:a8f8d4bb072b4ef94f5cdf36a077a3be158bc314282c37fe026ffbe468746cb8`

## Scope and result

The current source tree was overlaid into an isolated Node 24 container whose frozen
dependency graph is identical to the current lockfile. The eight workspace library
packages required by this E2E were built in dependency order with the pinned `tsup`
tool, without running a repeat gate. The API and worker application bundles were not
part of this focused check. Vitest then ran exactly one focused file:

```text
tests/e2e/expert-residency-referral.test.ts (1 test) PASS
Test Files  1 passed (1)
Tests       1 passed (1)
Duration    7.23s
```

The scenario covers the disabled-boundary expert referral financial lifecycle and
asserts zero live-provider artifacts. No `test:repeat` command was run; 20x gates remain
CI-only.

## Runtime contract and cleanup

- CPU limit: 1 core
- Memory limit: 1 GiB
- Linux capabilities: all dropped
- Security option: `no-new-privileges:true`
- Test process user: `node`
- Node: `24.18.0`
- pnpm/dependency image: `11.9.0`
- Existing isolated test PostgreSQL was used through the committed test harness.
- Temporary databases matching `ii_tonya_test_%` after the run: `0`
- Remaining temporary focused-test containers after the run: `0`
- Source checkout remained clean at the exact tested SHA.

The raw log remains on Claw at `/tmp/ii-tonya-focused-packages-c560.log`; only its
digest and sanitized result summary are committed.
