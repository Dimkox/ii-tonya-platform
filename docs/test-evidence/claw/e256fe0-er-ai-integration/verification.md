# ER-AI-001 integration verification

- Integration base: `a0bf07ccc96d4cd67001ff4b05d4f1ad3810653f`
- Verified branch revision: `e256fe0d5ab61665ca701c8f5a1fbe29bfe85d90`
- Environment: retained `ii-tonya-test-yookassa` container on Claw
- Production, GitHub Actions, image build and prune: not used

The previously green ER-AI core suites were not repeated. Reconciliation focused
only on configuration, application composition and scope/architecture boundaries.

## Results

- configuration integration: 15 passed;
- expert AI architecture boundary: 1 passed;
- reconciled expert capability scope: 10 passed;
- API application composition/lifecycle: 25 passed.

Total newly verified integration assertions: **51 passed**. The disposable archive
required reconstruction of pnpm package links before `app.test.ts`; dependency-link
startup failures before that reconstruction are fixture preparation failures, not
passing test runs. Already-green files were not repeated after success.

The reconciliation preserves both `EXPERT_TELEGRAM_FINANCIAL_VIEWS_ENABLED` and
`EXPERT_AI_INGRESS_ENABLED`, keeps their runtime capability checks independent,
and leaves `apps/api/src/routes/telegram-webhook.ts` identical to the integration
base. The exact scope registry now includes both flags and all provider migrations,
relations and routes already accepted by the base.

## Review boundary

The independent conflict review found one Important omission: the ER-TG financial
flag was absent from the exact scope registry/classifier. Commit `8f25b91` fixes
the registry and extends classification to expert Telegram and AI flags. A final
independent confirmation of that narrow fix is still required before merge.

Human AI spot-check remains **BLOCKED**. Live model/provider composition, staging,
merge and production activation remain absent and unauthorized.
