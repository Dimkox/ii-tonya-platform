# Native Cutover Recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Deploy the reviewed commercial release without premature startup or destructive failed recovery.

**Architecture:** One locked remote cutover stages and validates, quiesces applications, selects the candidate, migrates with explicit deadlines, then starts and verifies. Failures preserve artifacts and an incident marker until verified recovery. Database rollback is not inferred from application rollback.

**Tech Stack:** Bash, systemd, Node24, PostgreSQL, Vitest command shims, pnpm11.9.0.

**Spec:** `docs/superpowers/implementation-artifacts/spec-native-cutover-recovery.md`

## Global Constraints

- No production mutation, provider calls or secret output during implementation.
- Node24 and pnpm11.9.0; existing locked dependencies only.
- Keep payment implementer files untouched; implementation begins only after its stable handoff.
- Two new test files each author RED1/GREEN2, coordinator final3 after independent review. No old exhausted/full/multi-path tests.
- Use existing restricted sudo install/systemctl/rm, never privileged shell or invented permissions.
- Preserve failed release and incoming artifacts, including failures during rollback itself.

## Review Focus

- API stop succeeds but worker stop fails before any unit/link switch.
- Controller disconnect or migration timeout leaves an unknown database state.
- Old symlink restoration fails; selected candidate must remain on disk.
- Worker is active but heartbeat belongs to an old PID or has stopped advancing.
- Connection URL or inherited PGOPTIONS attempts to override explicit migration bounds.

## Task 1: Bounded cutover and recovery

**Files:** `scripts/deploy-native-remote.sh`, `scripts/migrate-native.mjs`, `deploy/systemd/ii-tonya-migrate.service`, optional typed connection settings in `packages/db/src/client.ts`. New tests: `tests/repo/native-cutover-recovery.test.ts`, `tests/repo/migrate-native-timeouts.test.ts`. Evidence: `docs/test-evidence/native-cutover-recovery-2026-10-13.md`.

**Interfaces:** Keep validate/deploy/rollback actions and existing release input names. Define any new compatibility-evidence input in the implementation before use, bind it to old SHA, candidate SHA and migration-manifest digest, and do not accept a naked success flag. Preserve createDb(connectionString) behavior for all non-migration callers; optional timeout settings apply only when explicitly supplied.

- [ ] Add shim-driven tests that execute actual remote shell bodies for every spec matrix row. Assert event ordering, selected paths, retained artifacts, exit statuses and incident marker. Add migration-timeout input and cleanup tests under the existing Vitest include glob.
- [ ] Run each new focused file separately once (RED1), recording command/session/results immediately.
- [ ] Implement unique upload directories, remote flock/incident marker, meaningful target validation, partial-stop recovery, bounded migration and verification. Apply all reviewed operational decisions from the spec; no success from process-active alone.
- [ ] Implement migration-only connection bounds and service timeout. Reject conflicting URL/env configuration. Ensure pool close on failure; no database credentials in errors.
- [ ] Run scoped syntax/types/lint/format; run each new file separately once (GREEN2). Reconcile old static fixture expectations without execution or weakening security assertions.
- [ ] Report stable source hashes, tests and open compatibility evidence. Independent review then coordinator final3; no self-approval, push or deployment.

## Preflight decisions

All runtime sequence changes form one reviewable transaction-like cutover task.
Review-focus cases map to explicit fault tests, not string-only assertions.
The existing deployment has an old release; first-install failure handling remains
covered to avoid breaking the script's existing capability. Application recovery
requires independently supplied schema compatibility evidence; constructing that
evidence and publishing the final artifact are subsequent release actions.
