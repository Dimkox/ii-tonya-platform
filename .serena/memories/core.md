# ii-Tonya Platform

- Authoritative product source: `docs/source/ii-tonya-expert-full-source-2026-07-28.txt`, SHA-256 `0439AE1C645E6FDA46F013A66512401F251AA18D35520F5C9A7A3C7C59314EAF`.
- Business channels remain Selarti (client), Telegram (expert), Planerka (schedule), Make/Google Sheets (non-critical integrations/projections).
- PostgreSQL is the only source of truth for bookings, capacity, message packages, coupons, payments, consent, and audit state.
- LLM output is untrusted text or typed intent; it cannot directly mutate money, bookings, permissions, or crisis policy.
- Every inbound provider event is idempotent; every outbound side effect uses a transactional outbox.
- Production rollout is staging-first with synthetic users and a manual go-live gate.
- Architecture and resolved requirements: `mem:architecture/core` once authored; stack and tooling: `mem:tech_stack`; completion checks: `mem:task_completion`.