# Repository agent contract

This file is the portable operating contract for human and AI contributors. It applies
to the entire repository and must be read before making changes.

## Establish identity first

Never assume a checkout path, branch, remote, or inherited machine configuration. Run:

```powershell
git status --short
git rev-parse --show-toplevel
git remote get-url origin
git branch --show-current
git rev-parse HEAD
```

The canonical remote is `https://github.com/Dimkox/ii-tonya-platform.git`. Development
must occur in this repository on a `codex/*` branch or an isolated worktree. Do not use
an Obsidian copy, memory repository, or `openclaw-airgap-farm` as source code or as a
place to modify this project's test workflow.

Read these files before continuing the expert residency referral extension:

- `README.md`
- `docs/handoffs/2026-08-04-expert-residency-referrals.md`
- `docs/handoffs/environment-manifest.md`
- `docs/agents/expert-residency-team.md`
- `docs/superpowers/specs/2026-08-02-expert-residency-referrals-design.md`
- `docs/superpowers/plans/2026-08-03-expert-residency-referrals.md`
- `.superpowers/sdd/progress.md`

## Environment and dependencies

- Required Node major: 24 (`.nvmrc`, `package.json#engines`).
- Required package manager: pnpm 11.9.0 (`package.json#packageManager`).
- Install only from the committed graph: `pnpm install --frozen-lockfile`.
- `pnpm-lock.yaml` is the authoritative complete dependency graph. Never commit
  `node_modules`, package-manager stores, generated `dist`/`build`, coverage, caches,
  `.env`, credentials, or local tool state.
- PostgreSQL integration and container evidence require Docker Compose. The local
  evidence database is PostgreSQL 17.5 as pinned in `compose.yaml`.
- Run `pwsh -File scripts/check-development-environment.ps1` before implementation and
  add `-RequireDocker` before container or PostgreSQL verification.

If the environment check fails, repair or isolate the environment. Do not weaken engine
constraints, lockfiles, tests, feature flags, or CI to fit the machine.

## Migration history is hand-authored

Migrations in `packages/db/migrations` are authored, reviewed, and applied as SQL. The Drizzle
snapshot chain stops at `0021`: journal entries `0014`, `0019`, `0020`, and `0022`-`0038` have SQL
but no `meta/NNNN_snapshot.json`.

- Do not run `drizzle-kit generate`. It diffs against the newest stored snapshot (`0021`) and
  therefore re-emits every object added afterwards - a 2026-09-10 probe produced a 215-statement
  `0039_*.sql` recreating existing tables. It also aborts before that on the BigInt default
  `bigint("next_delivery_sequence", { mode: "bigint" }).notNull().default(0n)` in
  `packages/db/src/schema/integration.ts`, with
  `TypeError: Do not know how to serialize a BigInt`.
- The history also carries 27 hand-authored functions, 33 triggers,
  1 view (`package_balances`) and 2 extensions
  (`btree_gist`, `pgcrypto`) that no Drizzle schema declaration represents. A schema-derived
  snapshot cannot contain them, so rebuilding the chain from `packages/db/src/schema` is not
  available: a full `generate` already fails with
  `ERROR: function expert_jsonb_has_exact_keys(jsonb, text[]) does not exist`, because the CHECK
  constraints that call these functions are emitted while the functions are not.
  `tests/repo/migration-history-integrity.test.ts` pins that exact set.

- Do not read `drizzle-kit check` or `drizzle-kit up` as a safety net here: both report
  `Everything's fine`, and neither restores the missing snapshots. The Database Gate step
  `Validate Drizzle metadata` is therefore green regardless.
- Add a migration by hand: the `.sql` file plus its `_journal.json` entry in the same change, with a
  contiguous `idx`, a matching `NNNN_tag`, and `breakpoints: true`.
- `tests/repo/migration-history-integrity.test.ts` freezes the grandfathered gap list and the
  bigint-default list. Closing a real gap is welcome - shrink that baseline in the same change; a new
  gap fails the guard.

Rebuilding the snapshot chain (the only way to make `generate` usable again) needs a state-based
snapshot for the newest migration; `drizzle-kit introspect` emits a Drizzle schema, not snapshot JSON,
so there is no tool-supported path. Track that in the migration-integrity issue before attempting it.

## Test execution rules

These rules override plan steps that ask an agent to burn time or tokens on repeated
local suites.

- Never run `pnpm test:repeat` with count greater than 3 in any environment.
- Never run the full suite or a multi-path Vitest command more than once per task unless
  the human explicitly asks.
- For concurrency or PostgreSQL tests, verification is at most 3 runs of the focused
  file. `.github/workflows/db-gate.yml` uses the same bounded depth.
- `scripts/repeat-vitest.mjs` refuses count greater than 3 in every environment; CI does
  not bypass the guard.
- Full `pnpm verify` is a branch-finish check or an explicit human request, not an inner
  development loop.

## Delivery workflow

For durable work follow:

`clarify -> specify -> plan -> tasks -> implement with tests -> verify -> review -> CI`

Requirements must stay linked to code, tests, release evidence, telemetry, and recovery.
Write failing tests first for behavior changes. A local green command is not release
evidence. Before marking a task complete require focused tests, relevant typechecks and
lint, `git diff --check`, independent adversarial review, and successful exact-SHA CI and
Database Gate runs.

Do not force-push or rewrite shared history. Preserve failed CI runs as diagnostic
evidence. Keep PR #4 Draft until Tasks 10–12 and their final checks are complete.

### Pre-push gate

There is no hosted CI: `.github/workflows` is empty by repository policy
(`tests/repo/workflow-semantics.test.ts` asserts it) and branch protection is unavailable on
the current plan, so a push is otherwise entirely unchecked. Install the gate once per clone
— the hook it writes lives outside the worktree and therefore covers every linked worktree:

`pnpm hooks:install`

It refuses a push when `tests/repo`, formatting, evidence integrity, whitespace checks, or the
syntax of any automation script fails, and it lints the files in the outgoing range.
`pnpm hooks:check` reports whether the gate is active; `pnpm verify:gate` runs the same checks
without pushing. A push targeting `main` additionally requires a clean working tree whose HEAD
is the commit being pushed, and also runs the tests typecheck. Bypass only deliberately with
`git push --no-verify`, and state the reason in the PR description.

## Authority and safety boundaries

- Client coupons and expert referral codes are separate products, tables, ledgers, code
  namespaces, and redemption paths.
- Prompts, Telegram, Make, and Google Sheets have no authority over balances, prices,
  credit, referral ownership, settlement, refunds, or provider facts.
- PostgreSQL transactions own financial and idempotency state.
- All external integrations and expert residency features remain fail-closed unless an
  explicitly reviewed environment enables them.
- Never store or print secrets. `.env.example` contains placeholders only.
- No staging or production mutation follows from development access. Staging still
  requires completed task gates and target evidence. Production requires a separate
  explicit command and release authorization.

## Agent coordination

Use the repository-contained roles in `docs/agents/expert-residency-team.md`. Every role
must have explicit inputs, owned files, outputs, and verification responsibility. Only
one implementer may edit a file set at a time. Reviewers do not silently fix their own
findings; they report exact files, lines, severity, and reproduction evidence.

The repository contains BMad Method 6.11.0 Core + BMM in `_bmad/` and its Codex skills
in `.agents/skills/`. Resolve BMad configuration through
`uv run _bmad/scripts/resolve_config.py --project-root .`; on Windows set
`PYTHONUTF8=1` so Unicode agent metadata is emitted reliably. Use BMad for the durable
story/sprint contract in `docs/superpowers/implementation-artifacts` and Superpowers
for the implementation plan, TDD execution, and independent review. Useful companion
skills include `writing-plans`,
`test-driven-development`, `systematic-debugging`, `verification-before-completion`,
`requesting-code-review`, and relevant GitHub Actions/Docker validators. The project
remains operable through this file and `docs/agents` if an IDE does not load skills.

## Current continuation point

Expert residency referral Tasks 1–12 are present on `main`; their live-provider and
release gates remain separate. The next approved product increment is Story 24.1,
expert Telegram `/schedule`, `/client`, and `/stats` queries, specified in
`docs/superpowers/specs/2026-08-13-expert-telegram-queries-design.md`. Confirm the active
branch, story status, PR head, and checks live; do not rely on a stale SHA copied from
documentation.
