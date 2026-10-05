# Client web account implementation plan

Spec: `docs/superpowers/implementation-artifacts/spec-client-web-account.md`.
Baseline: `e364b1ea1fc611d5042b22c154ce01f1d314b438`.

The approved spec and its context are loaded. This implementation stays in the
assigned checkout; the main agent owns commits, release checks, and deployment.

- [ ] Bind consent presentations to exact approved documents; reject stale,
      cross-purpose, cross-subject, reused, or mismatched-version decisions and prevent
      denial from replacing revocation. Test with isolated PostgreSQL.
- [ ] Verify Telegram Mini App and widget proofs, then resolve only one active
      identity transactionally. Compose the default lifecycle with server credentials.
      Test signatures, freshness, shape, ambiguity, concurrency, and replay.
- [ ] Add a finite browser privacy bridge with secure cookies, session-bound CSRF,
      exact Origin checks, login rate limits, session probe, and logout. Keep strict
      bearer routes separate. Leave erasure uncomposed and report it unavailable.
- [ ] Build the explicit login and document/decision/withdrawal flow, independent
      purposes, truthful partial failures, document and subject downloads, and public
      entry links. Test behavior before changing the UI.
- [ ] Run focused tests, relevant builds/typechecks/lint and whitespace checks;
      record evidence and deployment requirements in the spec. Main owns independent
      review and full/exact-SHA release verification.

Review focus: duplicate proof fields; identity races with other writers; stale
documents during a decision; an active grant receiving a denial; cross-origin
login/logout; missing/expired sessions; partial all-withdraw failure; unavailable
erasure. No real subjects or external providers are used in tests.
