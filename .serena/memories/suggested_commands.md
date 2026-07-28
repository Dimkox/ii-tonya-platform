# Suggested commands (PowerShell)

From project root:

- Install: `pnpm install --frozen-lockfile`
- Dev API: `pnpm dev:api`
- Dev worker: `pnpm dev:worker`
- Unit tests: `pnpm test`
- DB integration tests: `pnpm test:integration`
- Full CI-equivalent verification: `pnpm verify`
- Lint: `pnpm lint`
- Typecheck: `pnpm typecheck`
- Format check: `pnpm format:check`
- Build: `pnpm build`
- Generate migrations: `pnpm db:generate`
- Apply migrations: `pnpm db:migrate`
- Live contract smoke tests: `pnpm smoke:integrations` (requires explicit staging credentials; never production clients by default).
- Fast file search on Windows: `rg --files`; text search: `rg -n 'pattern' path`.
- Project state: `git status -sb`; diff checks: `git diff --check`.