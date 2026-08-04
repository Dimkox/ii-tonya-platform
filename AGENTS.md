# Agent instructions (ii-tonya-platform)

## Test execution rules (mandatory)

These rules override plan steps that ask the agent to burn tokens on long local loops.

- **Never** run `pnpm test:repeat` with count **> 2** in an agent session.
- **Never** run the full suite or multi-path vitest more than once per task unless the human asks.
- For concurrency / PostgreSQL tests:
  - Local agent verification = **1–2 runs** of the single focused file:
    `pnpm exec vitest run path/to/file.test.ts`
  - The **20× stability gate** is enforced only by CI:
    `.github/workflows/db-gate.yml` → `pnpm test:repeat -- 20 ...`
- If a plan step says `pnpm test:repeat -- 20 ...`:
  - Run the focused file **once** (or twice if flaky).
  - Treat CI as the authority for the 20× gate.
  - Do **not** loop 20 times in the agent session.
- `scripts/repeat-vitest.mjs` refuses count > 2 unless `CI=true` / `GITHUB_ACTIONS=true`
  (or an explicit `AGENT_MAX_REPEAT` override). Do not bypass the guard.
- Full `pnpm verify` / full suite — only at branch finish or when explicitly asked.

## Prefer

- Targeted paths over workspace-wide runs.
- Cheap models for mechanical implementer tasks; stronger models for review.
- Plan-scoped SDD ledger; do not re-dispatch completed tasks.
