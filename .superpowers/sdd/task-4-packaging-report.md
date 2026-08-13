# Task 4 packaging remediation report

## Status

PASS. The sandbox-only hybrid bundle compiles and its built executable reaches the
sanitized fail-closed startup path on Claw.

## Root cause and narrow design

The previous all-in-one ESM bundle embedded third-party CommonJS dynamic requires.
Externalizing every dependency initially exposed an incomplete sandbox package closure.
The remediation bundles workspace-owned `@ii-tonya/*` source into the sandbox artifact,
externalizes third-party packages for Node to load normally, and declares every external
runtime import directly in `@ii-tonya/sandbox-api`. This changes no DB migration,
production manifest, production composition, or API behavior.

## TDD and verification evidence on Claw

- Causal RED: isolation passed 4/5 and failed only on the old build contract.
- Focused GREEN: 3 files / 41 tests passed.
- DB and sandbox-payments prerequisite ESM/DTS builds passed.
- Sandbox API hybrid ESM/DTS build passed; `dist/server.js` was 136.41 KB.
- `node dist/server.js` exited nonzero and emitted exactly `sandbox_startup_failed`.
- Prettier, ESLint, `git diff --check`, and cleanup checks passed; remaining test
  containers were zero.

All executable work used the constrained `ii-tonya-test` Claw profile (1 CPU, 1 GiB),
with no production smoke, provider call, credential use, deployment, or push.

## Changed boundary

- Add `apps/sandbox-api/tsup.config.ts`.
- Point the sandbox package build script to that config.
- Add direct sandbox runtime dependencies and matching lockfile importer entries.
- Add a repository isolation assertion pinning workspace bundling and third-party
  externalization.
