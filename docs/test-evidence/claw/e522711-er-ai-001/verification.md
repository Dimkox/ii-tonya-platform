# ER-AI-001 Claw verification

- Tested revision: `e522711d6cbc17b40589e4e4e6a247873ec61914`
- Environment: retained `ii-tonya-test-yookassa` container on Claw
- Live model/provider: absent
- GitHub Actions: not used
- Image build/prune: not performed
- Production: not accessed

## Green evidence

The first focused run completed 46 tests successfully across:

- `expert-ai-ingress-service.test.ts` — 11;
- `expert-ai-proposal-eval.test.ts` — 2;
- `expert-prompt-context.test.ts` — 18;
- `env.test.ts` — 14;
- `expert-ai-ingress-boundaries.test.ts` — 1.

The application and config ESM builds also succeeded in the isolated snapshot.
Successful files were not repeated.

## Verification boundary

`prompt-safety.test.ts` and `app.test.ts` could not start because the disposable
archive did not reproduce pnpm workspace package links for `@ii-tonya/domain` and
`@ii-tonya/application`. `expert-referral-scope-guards.test.ts` exposed an existing
baseline mismatch: `origin/main` already allows migrations `0023` and `0024`, while
that test's expected list ends at `0022`. These are not recorded as passing.

The integrated cherry-pick must verify the application startup invariant and the
updated scope flag against its canonical workspace dependencies. Per the single-run
policy, already-green focused files were not rerun.

## Review and approval

- Independent Critical/Important review: **APPROVED** after the authoritative
  tariff-context equality fix.
- Human AI spot-check owner: **BLOCKED — not assigned**
- Human AI spot-check date/result: **BLOCKED — not performed**
- Live source, staging, merge and production activation: **NOT AUTHORIZED**
