# Release-control isolation verification

Date: 2026-08-12

Scope: refusal-only legacy server control, migration-approval binding, release credential
cleanup, and separation of the Claw test and release runner identities.

## TDD and focused gates

All executable verification ran on Claw in the constrained `ii-tonya-test` Compose
profile (1 CPU, 1 GiB). No `test:repeat` command was used.

- RED: `tests/repo/workflow-semantics.test.ts` produced three expected failures for the
  missing approval binding, reachable server-control command, and absent cleanup.
- GREEN: the same focused file passed 10/10.
- Expanded gate: `workflow-semantics.test.ts` plus `scope-boundary.test.ts` passed
  113/113.
- Prettier passed for all eleven changed workflow, test, and documentation files.
- Actionlint v1.7.12 was downloaded on Claw from the official release, verified against
  the published SHA-256 checksums, and passed all five workflow files.

One invalid runner invocation entered the profile's broad default wrapper and was stopped
after its existing release-asset gate passed; it is diagnostic only and is not counted as
focused evidence. A later expanded gate initially reported 111/113 because the remote
scope-pin source had not been synchronized; after exact-file synchronization, the final
113/113 gate passed.

## Live runner isolation

The repository runner API and host checks observed:

- `ii-tonya-claw`: online; labels `self-hosted,Linux,X64,claw,ii-tonya-test`.
- `ii-tonya-release-claw`: online; labels
  `self-hosted,Linux,X64,claw,ii-tonya-release`.
- Release service runs from `/home/ii_tonya_release/actions-runner` as the locked
  `ii_tonya_release` account.
- The release account is not in the Docker group, cannot read `/var/run/docker.sock`, and
  cannot write the test workspace.
- The release runner's `bin` and `externals` links resolve inside its own installation.

## Independent review and release boundary

Independent read-only re-review found no Critical or Important issue in this bounded
scope. It did not rerun tests and relied on the evidence above.

This evidence does not authorize deployment. Release remains NO-GO until the committed
exact SHA passes CI/Database Gate, the PR is merged to `main`, the exact structured
migration approval exists, staging evidence is approved, and a human explicitly
dispatches/approves production release.
