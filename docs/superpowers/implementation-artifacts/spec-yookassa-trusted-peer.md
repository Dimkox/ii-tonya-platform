---
title: Trusted local proxy boundary for YooKassa notifications
type: feature
created: 2026-10-12
status: in-progress
baseline_commit: 690797db64fd80aa1aeccea8003543de470d8c16
context: []
---

## Intent

Implement the missing effectivePeerAddress dependency for the existing YooKassa
webhook route behind the dedicated nginx deployment. Owner explicitly requested
implementation after the bounded design was presented. Technical choices are
delegated; this does not fabricate approval of receipt policy or unpaid access.
The full objective remains a working commercial deployment on ii-tonya.ru.

## Boundaries

Own only new apps/api/src/yookassa-peer.ts, its adjacent new .test.ts and
docs/test-evidence/yookassa-trusted-peer-2026-10-12.md. Preserve dirty worktree.
No other implementer active. No nested agents, remote calls, secrets, dependencies,
old tests, full suite, provider calls, commit, push or activation. Existing webhook
allowlist/verification remains unchanged. This helper is a composition prerequisite,
not permission to enable a stub or claim a production payment flow works.

## Code Map

- apps/api/src/routes/yookassa-webhook.ts: effectivePeerAddress(FastifyRequest)
  feeds the existing allowlist before inbox claim and authoritative provider GET.
- deploy/nginx/ii-tonya: X-Real-IP is overwritten with remote_addr; forwarded-for
  is not authoritative. API is bound to private loopback in native deployment.
- apps/api/src/server.ts: ordinary provider composition is still downstream;
  do not modify its capability flags or construct placeholder capabilities.

## Tasks and Acceptance

- [ ] Export a FastifyRequest-compatible effective-peer function in new helper.
  Require immediate raw socket remoteAddress to be exactly 127.0.0.1 or ::1,
  including valid IPv4-mapped loopback normalization. Do not trust request.ip,
  request.ips or arbitrary loopback aliases without an explicit contract.
- [ ] Require exactly one case-insensitive X-Real-IP occurrence in rawHeaders.
  Reject duplicate headers even if normalized headers conceal them. Reject missing,
  array, comma-separated, whitespace-wrapped, port-bearing, zone-qualified or
  invalid IP values. Reject malformed raw header pairing. Return empty string on
  denial so existing route emits403; do not throw or reflect supplied values.
- [ ] Return a validated normalized IP for trusted nginx. Support IPv4 and IPv6,
  including IPv4-mapped IPv6; use node:net rather than permissive number parsing.
  Ignore Forwarded and X-Forwarded-For completely. Do not enable trustProxy.
- [ ] Test both parser boundaries and real Fastify route integration with the
  existing yookassaWebhookRoutes. Use synthetic local requests and counting
  dependencies, no provider network. Denied requests must produce403 with zero
  inbox/verify/deliver calls; accepted provider IP reaches the existing handler.

Given a public socket and forged provider headers, when the helper runs, then it
denies. Given trusted nginx with exactly one valid header, then it returns the IP.
Given duplicate raw headers or malformed values, then it denies regardless of
normalized headers. Given unrelated forwarded headers, then they cannot change
the decision. Given a valid non-provider IP, then the existing allowlist denies.

## Verification and handoff

Read repository contract and run development preflight before changes. Follow
TDD: write tests first, use a minimal compilable scaffold for behavioral RED.
New focused test file has three executions total: author RED1 and GREEN2;
coordinator reserves3 after independent review. Record each execution immediately,
including failed collection; do not silently retry. No multi-path or old suite.
Read test-driven-development/writing-good-tests guidance. Run API/tests typechecks,
scoped ESLint, formatting and git diff --check; avoid builds concurrent with types.
Report changed files, exact results, outstanding risks, and stable handoff.
Do not edit shared AGENT-STATUS or this spec. No epic story key; sprint sync skipped.

## Design Notes

Trust is the explicitly configured local nginx boundary, not authentication of
arbitrary local processes. This helper does not replace provider GET verification.
Unpaid-but-active scope is awaiting owner clarification; no payment states change.
