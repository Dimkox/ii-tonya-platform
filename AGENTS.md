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

If optional global skills exist, useful modules include `bmad-spec`, `writing-plans`,
`test-driven-development`, `systematic-debugging`, `verification-before-completion`,
`requesting-code-review`, and relevant GitHub Actions/Docker validators. The project must
remain operable without them; this file and `docs/agents` are the portable fallback.

## Current continuation point

Tasks 1–9 of the expert residency referral plan are complete. Continue at Task 10:
expert API, Telegram views and callback binding, prompt-safe typed proposals, and the
five malicious prompt fixtures. Tasks 11 and 12 remain afterward. Confirm the current
PR head and checks live; do not rely on a stale SHA copied from documentation.
