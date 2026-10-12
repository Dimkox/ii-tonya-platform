# Booking notification runner — local evidence

Candidate is uncommitted; no production activation or exact-RC claim.

Focused file packages/worker/src/booking-notification-runner.test.ts:

- Run1 17:47:46UTC:6 behavioral failures against inert scaffold.
- Run2 17:48:25UTC:6/6passed.
- Independent review found concurrent completion flush/evidence loss and new SQL
  after drain timeout. Regressions added before implementation corrections.
- Reviewer accepted source corrections; run3 17:51:04UTC:18/18passed. Budget3/3.

Implementation serializes active cycles and completion persistence, clears only the
saved pending object, and stops new repository calls after drain returns. Calls
already in progress are not forcibly cancelled. The transport owns its bounded
HTTP deadline. Receipt/outcome pending slot is memory only, not a durable spool.
Crash before persistence remains unknown/manual; no promise of guaranteed receipt.

Tests cover one claim/send, full4297200seconds/failed-pause/unknown-pause outcomes,
SQL throw/false and receipt-only retry, unexpected transport exception, denied or
failed admission, disabled sending with recovery, overlapping cycles/drains,
deadline then late HTTP completion, and stop during admission with not_applied.
Final claim interface also prevents admission without topic; only request topics
invoke callback issuance. Actual DB ports and worker runtime composition remain
separate, not proven by these doubles.

Worker typecheck, scoped ESLint and git diff --check passed after final changes.
Shared tests typecheck previously failed on concurrent DB test scaffolding; that
cross-workstream check must be rerun after DB handoff. No old suites rerun.
