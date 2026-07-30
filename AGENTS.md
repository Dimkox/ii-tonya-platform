# ии-Тоня Repository Instructions

## Scope

- Work only in this repository unless the current user explicitly expands the
  scope.
- Treat `docs/spec/normalized-requirements.md` as the implementation contract
  and preserve the source snapshot named in `README.md` for traceability.
- Change specifications incrementally. A cross-cutting change to terminology,
  contracts or document structure requires an impact inventory before code is
  changed.
- Preserve unrelated working-tree changes and use a `codex/` branch for
  governance or implementation work.

## Safety and permissions

Allowed without additional authority:

- read repository files and Git metadata;
- edit code, tests, specifications and CI on an isolated branch or worktree;
- run bounded local tests, linters, builds and static scanners;
- use test-only PostgreSQL containers created by the test suite.

Requires explicit current user authority:

- deployment or mutation of any production service;
- sending real client or expert messages;
- payment, booking, balance or consent mutations outside deterministic tests;
- database migrations against a shared or production database;
- secret rotation, disclosure or repository-setting changes.

Forbidden:

- production secrets in pull-request workflows;
- bypassing a failed required stage;
- treating Make, Google Sheets or a prompt as the source of truth for
  transactional state;
- committing credentials, generated private signing keys or captured personal
  data.

## Architecture boundaries

- Version schemas and service contracts; keep adapters weakly coupled to the
  application and domain packages.
- Validate all external input at a typed boundary.
- Keep booking, billing, consent, safety and audit behavior deterministic and
  covered by contract or integration tests.
- A Markdown contract change is complete only after its dependent code, tests
  and traceability references are updated.

## Verification

```powershell
pnpm install --frozen-lockfile
pnpm exec prettier --check .
pnpm lint
pnpm typecheck
pnpm exec vitest run packages/contracts packages/domain packages/config packages/application packages/integrations packages/worker tests/repo tests/support
pnpm exec vitest run packages/db tests/integration
pnpm exec vitest run tests/contract
pnpm build
pnpm test:pnpm-launcher
git diff --check
```

Generated GitHub Actions workflows must also pass actionlint and the central
governance validator.

## Definition of done

- All applicable commands in `.codex/ci-contract.json` pass.
- `Governance CI / required` is green from the exact commit under review.
- Contract changes are versioned and covered by relevant tests.
- The immutable artifact is addressed by full commit SHA and has a verified
  SHA-256 checksum.
- No production action was performed unless it was separately authorized and
  evidenced.
