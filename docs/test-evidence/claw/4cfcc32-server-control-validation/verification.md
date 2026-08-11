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

- Use a block scalar for the issue-comment command.
- Declare `ii-tonya-server` in `.github/actionlint.yaml`.
- Return the captured process status directly from the execute step.
- Remove the redundant expression-derived propagation step.
- Permit issue-driven control only for an edit of issue `#6` made by the repository
  owner on an issue also owned by that account; manual `workflow_dispatch` remains
  permitted.
- Isolate concurrency by issue number so unrelated issue events cannot cancel the
  trusted control run.
- Never publish raw command output to an issue. The result comment contains only exit
  status and the Actions run link.
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
Duration    4.46s
```

Command:

```bash
CI=true ./node_modules/.bin/vitest run \
  tests/repo/workflow-semantics.test.ts \
  tests/repo/scope-boundary.test.ts --maxWorkers=1
```

The 7 workflow tests include the trusted issue/manual trigger gate, isolated concurrency,
nonzero command propagation, always-run safe publication, and absence of raw output or
`$BASH_COMMAND`. The 103 scope tests confirm the reviewed native automation hashes and
recursive production-artifact boundary.

One earlier container invocation was stopped before the requested focused command because
the profile's default entrypoint began its own broad build/verification sequence against
an incomplete test workspace. It is not GREEN evidence. No repeat loop was used. The
workspace was restored from base source after the final run; zero test containers and zero
focused Vitest processes remained.

## External hosted-job boundary

Exact current CI and Database Gate annotations state that the jobs were not started
because recent account payments failed or the Actions spending limit needs to be
increased. This repository change does not alter Billing and cannot serve as hosted PASS
evidence until that separate account control is resolved.
