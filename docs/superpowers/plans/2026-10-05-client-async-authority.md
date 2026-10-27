# Client Async Authority Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans and test-driven-development; only one writer.

**Goal:** Original authority, not a later grant, controls each client asynchronous effect.
**Spec:** docs/superpowers/implementation-artifacts/spec-client-async-authority.md
**Architecture:** Strict original stamp in existing JSONB; sole journal oracle + exact revision; common subject lock serializes withdrawal, durable start and response acceptance.
**Stack:** Existing PostgreSQL17.5, Node24, pnpm11.9.0, Vitest.

## Task 1: Original stamp and producers

**Files:** packages/contracts/src/client-consent-authority.ts and exports; packages/db/src/repositories/consent-current.ts, client-consent-authority.ts, hybrid-message-repository.ts, test-expert-telegram-repository.ts.
**Interfaces:** A strict server-authored original-authority stamp, capture/validate helpers using the sole consent oracle and stable subject-first locking. Return a discriminated denial instead of upgrading historical payloads.
**Review focus:** No bigint narrowing; document digest is not message digest; optional purposes must not be added implicitly; source ownership and active subject are mandatory.

- [ ] Read real flows and add behavioral no-regrant-revival RED.
- [ ] Shared strict contract; capture under subject lock in Hybrid/trial producers.
- [ ] Use decimal revision strings, preserve hashes/identities and original stamp on derived jobs.
- [ ] Deny unknown/unstamped/ambiguous/foreign/inactive sources without restamping.

## Task 2: Durable dispatch admission

**Files:** packages/db/src/repositories/outbox-repository.ts and privacy-repository.ts; packages/worker/src/outbox-runner.ts, telegram-send-text-dispatcher.ts and focused tests.
**Interfaces:** Exact durable one-attempt admission returned from recordAttemptStarted; runner passes it to the matching dispatcher. Atomic start and withdrawal share subject advisory lock, but network is outside the transaction. Preserve existing topics' APIs where possible.
**Review focus:** Both claim variants; lease/token binding; same-attempt replay; crash before HTTP is uncertain, not proof of no effect; stale ordered jobs cannot deadlock newer valid messages.

- [ ] Controlled-race tests before repository/runner changes.
- [ ] Unify lock order, atomically record one started attempt only after original-authority validation.
- [ ] Runner/dispatch consume exact durable admission; stale unstarted work terminalizes without blocking ordered successors.
- [ ] Preserve uncertain external effects, unrelated topics and reconciliation.

## Task 3: Late responses and composition

**Files:** packages/db/src/repositories/selarti-proposal-repository.ts; Selarti request dispatcher/registry; apps/worker/src/main.ts and composition tests.
**Interfaces:** Resolve the durable original request before locking proposal rows; verify original authority and database time after lock wait; accepted response inherits the original stamp unchanged. Register the fenced implementation only with a complete dependency set and existing default-off flags.
**Review focus:** Rejected content must not become provider-not-applied evidence; never release uncertain reserved units or erase provider application evidence; no persistence of rejected response text.

- [ ] Resolve original request, subject-lock recheck, DB-time deadline before storing response.
- [ ] Reject stale response body/delivery while preserving authoritative finance outcomes separately.
- [ ] Wire default-off fenced path into actual production composition; missing dependencies refuse readiness.

## Task 4: Evidence

**Files:** tests/integration/client-consent-async-fencing.test.ts; necessary existing focused unit fixtures; docs/operations/client-async-authority.md; this plan and its spec.
**Interfaces:** Controlled test barriers for race orderings, using II_TONYA_TEST_POSTGRES_ADMIN_URL on the existing explicit local PostgreSQL17.5 fixture. Test execution counters are part of the handoff.
**Review focus:** Test actual durable state and network-call counts rather than only helper return values; production default flags remain off; no claims about unrun whole-suite or external Trust CI.

- [ ] Individual unit/PG files, <=3PG/concurrency runs per file, no full/multipath suite.
- [ ] Relevant typechecks/build/lint/format/diff.
- [ ] Record exact races, limitations and commands; in-review, Suggested Review Order, freeze all writes.
- [ ] Main owns independent review, RC and release. No provider activation.

## Execution ledger — 2026-10-05

### Latest focused verification — 15:00 UTC

The owner authorized one separate additional invocation. Main ran only the outbox
file at15:00:26 UTC: exit0,34/34,23.69s. The six fixture-blocked post-claim contention
cases now passed; original convoy, limited-batch recovery, started uncertainty and
financial/residual checks remain green in that same invocation. No source/test
changes occurred this turn. See the spec and `owner-exception-3-final.log`.
All six logical invocations are consumed (original3 + exception2 + exception1);
other budgets are unchanged. The local verification stop below is resolved, while
release-evidence closure remains separate. No push, deployment or activation occurred.

### Previous verification stop — 14:53 UTC

Main's final authorized outbox invocation exited1,28/34. The original convoy,
small-limit backlog recovery, started-uncertainty preservation and earlier financial/
residual scenarios passed. Six post-claim contention cases failed during synthetic
fixture setup (same-bot duplicate updateId1), before lock assertions. The fixture-only
correction preserves production idempotency and remains unverified. See the spec's
current stop and `owner-exception-2-final.log` in the existing ignored task directory.
Independent static closure allowed final execution, not release. All five logical
outbox runs (original3/3 + exception2/2) are consumed; no further PG, renamed case or
inline substitute without explicit authority. No commit, push or deployment occurred.

### Earlier pre-final-run ledger (historical)

Tasks 1–3 have local code in the existing isolated branch, not completion approval.
Task 4 is blocked pending convoy GREEN: latest outbox PG evidence is 23/24 from
main's owner-authorized exception 1 (logical run 4). The current-stop and closure-continuation
sections in the spec supersede the initial Results evidence. Release remains
main-owned; this plan does not claim a verified or deployable patch.

Meaningful RED: revoke→regrant revived an old queued job. Later RED checks exposed
missing runtime readiness, a missing Selarti metric topic, fractional revision parsing,
redacted duplicate replay, and the trial producer's pre-existing NUL lock parameter.
Initial focused runs were green before review patches. Original outbox run 3 failed
three fixture setups; main's exception 1 verified that correction and all three
financial/residual scenarios. Only the actual dispatch convoy remained RED.
No full/multipath suite, commit, push, deploy, activation, schema/dependency edit or
second writer occurred.

Rulings: unsupported nonempty/expiry-bearing scope denies; the baseline had no Selarti
outbox dispatcher, so its new wrapper requires an explicit trusted transport and
defaults to unavailable. No external mapping/evidence was invented.

Current freeze contract: stop all repository writes after the bounded local closure
round, leaving the spec `in-progress`, not done or verified. Main owns independent
review and the remaining explicit test-budget exception. The implementer may not run
PG/concurrency tests, including files with unused historical capacity. Outbox used
the original 3/3 plus exception 1/2; only ONE main-operated invocation remains.
Egress, B2, async fencing,
trial, privacy, navigation, catalogue and backup PG files are each 3/3 exhausted;
B1/B3/API-B1 remain 1/3. The inherited aggregate remains interrupted, not green.

Closure continuation: final usage/trial nonapplication uses terminal reconciliation,
not the retryable transport string. Client-only runtime recovery is owned by the
configured filtered runner; unrelated bounded jobs and no-runner fallback remain.
Convoy correction is authored, not PG-verified: exclude cleanup-busy IDs in both
claims and bound actual admission waits. Roll back before exact-claim release;
restore a claim-only attempt only without current facts or unresolved prior starts.
If the source row is also busy, scoped expiry recovery restores unstarted work without
unknown/provider facts. Started work retains uncertainty. Runner reports a no-op.
Eight further same-file cases await main's final run: six real post-claim lock cases
(subject/authority/outbox × plain/metrics) and two started-uncertainty recovery cases.
No source/readiness/completion claim substitutes for that PG evidence.
