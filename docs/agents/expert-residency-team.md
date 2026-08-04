# Expert residency referral agent team

These repository-contained roles provide a portable fallback when another machine does
not have the original Codex profiles, skills, agents, or memory. Roles are boundaries,
not permission to deploy or to access secrets.

## Coordinator and requirements owner

Inputs:

- current user request and approval boundary;
- design, implementation plan, progress ledger, handoff, and open PR state;
- current Git root, remote, branch, HEAD, and exact CI results.

Responsibilities:

- resolve conflicts between the request, specification, and current implementation;
- assign stable requirement IDs and acceptance tests;
- split work into non-overlapping file ownership;
- record human approval points and prevent implicit staging/production changes;
- stop repeated polling or review loops that do not add evidence.

Outputs:

- bounded task brief with objective, actors, data, non-functional requirements,
  dependencies, acceptance criteria, owner, and approval point;
- updated durable plan/progress/handoff when the state materially changes.

The coordinator does not claim implementation success without verifier evidence.

## Implementer

Inputs:

- one approved task from the versioned plan;
- exact base SHA and owned file list;
- existing architecture, contracts, and failing acceptance tests.

Responsibilities:

- work only in the canonical ii-tonya repository on the assigned branch/worktree;
- write or confirm RED tests before behavior changes;
- implement the smallest compatible change while preserving financial authority and
  fail-closed defaults;
- run focused tests, typecheck, lint, formatting, and diff checks;
- commit locally and report the exact SHA, changed files, tests, and known limitations.

The implementer does not push, merge, modify another repository, deploy, or change live
state unless the task explicitly grants that action.

## Adversarial reviewer

Inputs:

- exact implementation SHA and base SHA;
- requirement and threat-model links;
- implementer evidence.

Review lenses:

- authentication, authorization, ownership, replay, idempotency, concurrency, and
  transaction boundaries;
- money arithmetic, 50% cap, FIFO expiry, debt, settlement, refund, reversal, and
  immutable audit facts;
- prompt/adapter authority, enumeration, redaction, secrets, feature ceilings, and
  fail-closed behavior;
- migration compatibility, SQL NULL behavior, deadlocks, cleanup, and recovery.

Outputs:

- `PASS` with exact SHA and checks, or findings with severity, file/line, failure mode,
  and a concrete reproduction or missing test.

The reviewer must not approve their own unreviewed remediation.

## Verification and release-evidence owner

Inputs:

- reviewed exact SHA;
- required test matrix and release gates;
- GitHub CI, Database Gate, container, security, and provenance results.

Responsibilities:

- verify the worktree is clean and pushed HEAD matches the reviewed SHA;
- run the smallest relevant local checks, then require terminal exact-SHA CI evidence;
- distinguish skipped, cancelled, blocked, stale, and successful checks;
- record links and conclusions in `.superpowers/sdd/progress.md` and the handoff;
- confirm no unintended staging or production workflow ran;
- define rollback/recovery before marking release readiness.

No workflow file, historical green run, or local demo alone proves release readiness.

## Task 10 ownership package

Objective: expose safe expert referral/residency commands through authenticated HTTP and
Telegram adapters without granting financial authority to adapters or the LLM.

Expected files are listed in Task 10 of
`docs/superpowers/plans/2026-08-03-expert-residency-referrals.md`. Acceptance must cover:

- wrong-expert access denied without enumeration;
- client-supplied price/balance/credit/provider facts rejected;
- idempotency keys and server-issued tariff/order IDs enforced;
- callback claims bound to expert, operation, object, nonce, and expiry;
- server-derived masked summary and quote rendering;
- fixtures `llm-05` through `llm-09` rejected as unsupported intents.

Handoff output must name the exact SHA, RED and GREEN commands/results, changed files,
remaining risks, reviewer result, CI links, and the next task. Do not update the progress
row to complete until all of that evidence exists.
