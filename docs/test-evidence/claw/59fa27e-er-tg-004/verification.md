# ER-TG-004 Exact-SHA Claw Verification

Date: 2026-08-14

Status: GREEN for the focused ER-TG-004 scope. This is not production or staging
authorization.

## Candidate identity

- Branch: `codex/er-tg-004`
- Tested source SHA: `59fa27ef1e0f781cbb9e6adcf1f1f91353a284a1`
- Base SHA: `8b3c5c846f28451784c49c35ebd1e0606527db04`
- Source archive SHA-256:
  `63b0860552cbd3fc42b495db93b7d9faaa1a0f75d752e8e46776415b7560d6ad`
- Environment: retained read-only-rootfs Claw container, existing single PostgreSQL,
  direct `/seed` build/test binaries, no install or image operation.

## Build closure

Direct `tsup` ESM and declaration builds completed for config, application,
integrations, database, and API before the test invocation. One initial build-only
attempt stopped before Vitest because the restored shared source lacked `config/dist`;
the missing package was built explicitly. No test had run, so the focused Vitest
invocation below is the only test invocation.

## Focused test invocation

The one Vitest command selected:

- `packages/application/src/expert-residency-service.test.ts`
- `packages/db/src/repositories/expert-residency-repository.test.ts`
- `apps/api/src/routes/expert-referral.test.ts`
- `packages/integrations/src/telegram/expert-command-processor.test.ts`
- `packages/integrations/src/telegram/telegram-adapter.test.ts`
- `tests/integration/expert-residency-tariff-discovery.test.ts`
- `apps/api/src/server.test.ts`
- `tests/repo/expert-residency-release-readiness.test.ts`

Result: **8/8 files passed; 90/90 executed tests passed; 1 test skipped by the
explicit test-name filter; duration 16.71 seconds.**

The skipped test is the unrelated pre-existing `composes the expert residency worker
with a disabled provider reader` source-string assertion from `origin/main`. ER-TG-004
changes neither that test nor `apps/worker/src/main.ts`; it was excluded rather than
misrepresented as feature evidence.

The real-PostgreSQL discovery file passed **2/2**, including:

- 20-row current-window limit, deterministic `active_from` then UUID order, and exclusion
  of expired/future tariffs;
- denial after expert deactivation.

## Independent review

The first adversarial review found two Important issues: reused unique approval IDs in
the PostgreSQL fixture and a Telegram duration range narrower than the authoritative
database/admin contract. Both were fixed through a focused RED/GREEN cycle. The final
integration re-review at the tested SHA and current base reported **APPROVED**, with no
Critical or Important findings.

## Cleanup and boundary

After the gate, `/workspace/source` was restored from the exact base archive, ER-TG-004
added files and generated changed-package `dist` directories were removed, remote
archives were removed, the retained container remained running, and no Vitest process
remained. No `pnpm install`, repeat test invocation, GitHub Actions, image build, image
prune, provider call, live Telegram transport, staging, production, push, or merge was
performed.
