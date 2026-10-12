# Web candidate build — 2026-10-12

Baseline690797db64fd80aa1aeccea8003543de470d8c16 with current uncommitted candidate
changes, branch codex/planerka-api. Not an exact-SHA release or deployed artifact.

Session63648 ran pnpm --filter @ii-tonya/web build followed by the web typecheck.
Vite7.3.6 transformed26 modules and completed in509ms; TypeScript emitted no errors;
process exited0. Outputs: index.html1.73kB, CSS22.98kB and JS184.70kB before gzip.
Generated dist remains ignored and is not staged. No test execution consumed.

This proves current web source compiles, not authentication, payment, Telegram,
booking integration or human acceptance. Earlier browser failures and pending
extra-run approvals remain recorded separately. No production files were changed.
The expert account still explicitly reports payment/tariff management unavailable;
this build is not evidence that the customer can complete a purchase.

During bound-worker implementation, pinned SSH read-only check chunk b0ae54
exited0 and confirmed current
43a93e2131cde6bb09a6825fc5b83dfbf91fc600. API, worker and nginx active; local
/health/ready returned ready with postgres/migrations/workerLease/adapters=true.
This is existing-release health only, not activation of this candidate.
