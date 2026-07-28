# Task completion gate

A coding task is complete only after fresh evidence for every applicable command:

1. `pnpm format:check`
2. `pnpm lint`
3. `pnpm typecheck`
4. `pnpm test`
5. `pnpm test:integration` for persistence/adapters/migrations
6. `pnpm build`
7. `pnpm audit --audit-level=high` or documented equivalent
8. `git diff --check`
9. Secret scan over tracked files
10. For live integration changes, staging `pnpm smoke:integrations` with synthetic identities and readback/reconciliation.

Before completion, reconcile implementation against the normalized spec and verify no production clients, balances, bookings, webhooks, or messages were mutated outside an explicitly approved go-live gate.