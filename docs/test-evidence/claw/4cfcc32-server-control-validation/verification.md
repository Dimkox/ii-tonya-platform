# Server-control workflow validation

Date: 2026-08-12

Base source: `4cfcc328db527424761c4bf4a9d1b0c0ee1b3cdf`

Scope: server-control workflow, command script, semantic tests, scope allowlist, and
actionlint configuration.

## Root-cause reproduction

The required GitHub Actions validator reproduced the zero-job failure locally:

```text
.github/workflows/server-control.yml:25:85: could not parse as YAML:
mapping values are not allowed in this context
```

The colon in `control-event-ack: $GITHUB_RUN_ID` occurred inside a YAML plain scalar even
though shell quotes appeared later on the same line. GitHub therefore could not parse the
workflow on branch pushes.

After converting the command to a YAML block scalar, actionlint exposed two secondary
static findings: the repository-specific self-hosted runner label was undeclared and the
expression-derived propagation step could pass an unchecked string to `exit`.

## Fix

- Remove issue-driven control entirely; only explicit manual `workflow_dispatch` remains.
- Keep token permissions at `contents: read` and publish safe exit/run metadata only to
  the GitHub step summary.
- Declare `ii-tonya-server` in `.github/actionlint.yaml`.
- Return the captured process status directly from the execute step and remove the
  redundant expression-derived propagation step.
- Never publish or commit raw command output.
- Remove `$BASH_COMMAND` from the error trap and suppress the secret-bearing PostgreSQL
  password command output on failure.

## Static GREEN

```bash
bash C:/Users/Dmitry/.codex/skills/github-actions-validator/scripts/validate_workflow.sh \
  --lint-only .github/workflows/server-control.yml
```

Result:

```text
actionlint validation passed
All validations passed
```

Direct actionlint over every tracked `.github/workflows/*.yml` file also exited `0` with
the repository config.

## Focused Claw GREEN

The existing `ii-tonya-test` profile is configured for 1 CPU and 1 GiB. The final
focused command bypassed its broad default verification entrypoint with
`--entrypoint sh` and reported:

```text
Test Files  2 passed (2)
Tests       110 passed (110)
Duration    4.41s
```

Command:

```bash
CI=true ./node_modules/.bin/vitest run \
  tests/repo/workflow-semantics.test.ts \
  tests/repo/scope-boundary.test.ts --maxWorkers=1
```

The 7 workflow tests include the manual-only trigger, read-only permission, nonzero
command propagation, always-run safe summary, and absence of raw output or
`$BASH_COMMAND`. The 103 scope tests confirm the reviewed native automation hashes and
recursive production-artifact boundary.

One earlier container invocation was stopped before the requested focused command because
the profile's default entrypoint began its own broad build/verification sequence against
an incomplete test workspace. It is not GREEN evidence. No repeat loop was used. The
workspace was restored from base source after the final run; zero test containers and zero
focused Vitest processes remained.

After merging current `main`, one focused RED identified a stale pre-fix
`ops/server-command.sh` in the mounted test workspace. Synchronizing that fixture produced
the final 110/110 result above; no production service or Compose definition was changed.

## External hosted-job boundary

Exact current CI and Database Gate annotations state that the jobs were not started
because recent account payments failed or the Actions spending limit needs to be
increased. This repository change does not alter Billing and cannot serve as hosted PASS
evidence until that separate account control is resolved.
