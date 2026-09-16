# Agent status — owner-spec 2026-09-16

Updated: 2026-09-16. This is the live continuation file. Read it before
`AGENTS.md` extras, the spec README, or any TASK card. Do not treat older
handoffs (`docs/handoffs/2026-08-*`) as current for this branch.

**Do not print, commit, or paste `.env` values.** Names of variables only.

## Where you are

| Item | Value |
|---|---|
| Worktree | `/home/pall/projects/ii-tonya-base/work/ii-tonya-platform/.worktrees/owner-spec-2026-09-16` |
| Branch | `codex/owner-spec-2026-09-16` (ahead of origin by 4 commits at last write) |
| Copy-guard implementation HEAD | `b6215e8` (status docs land after it on this branch) |
| Base | `18af66fe` / `origin/main` |
| Spec package | `_bmad-output/specs/spec-owner-update-2026-09-16/` |
| Local secrets | `/home/pall/projects/ii-tonya-base/work/ii-tonya-platform/.env` — **not** in this worktree, mode `0600`, gitignored |

## What is done

### TASK-EXP-001 copy guard (code)

State on the card: `implemented_pending_review`. Live activation is **not** in scope.

- `guardClientCopy` in `packages/domain/src/safety.ts`.
- Wired in `conversation-service.ts` (`kind === "answer"`) and in `decodeProviderTextProposal` (`selarti_response_copy_prohibited` → `rejected` before `proposals.accept`).
- Public brand markup is `<span>ии-</span>Тоня` with `.brand { gap: 0 }` in landing and legal views.
- Commits: `5eab17e` (guard), `0bae85a` (brand + provider ingress + negation/brand/normalize), `b6215e8` (word forms).

Focused tests after `b6215e8`: prompt-safety 121, selarti-response-service 17, client-copy-guard + web 35, conversation-service 66, domain 67.

Independent re-review after `b6215e8`: **no remaining Critical**. Card checkbox «Пройти независимый review» is still unchecked. Remaining Warning (do not reopen as Critical unless the owner expands the card):

- 4-token after-window: «Поставлю диагноз вам точно не сразу» still accepted.
- Inflections/prefixes: наилучший, скидочный, выгоднейший, сэкономите, успевайте, порекомендуем, перебью, оформи сегодня.
- Format chars beyond ZWSP/soft-hyphen: U+200E LTR, bidi overrides.
- Homoglyphs (`лyчшие`) and landing «диагностика» were left on purpose.

Rebuild domain dist with tsup before tests that import `@ii-tonya/domain` (vitest does not alias it to source).

### Selarti credentials (local env only)

Auth against `POST https://selarti.com/api/1.1/wf/auth` with `{"key":"<SELARTI_API_KEY>"}` now works (earlier the key was accidentally equal to `SELARTI_COMPANY_ID` and failed `NO_EMAIL`).

Set in the **main-checkout** `.env` (not this worktree):

| Variable | State |
|---|---|
| `SELARTI_API_KEY` | set (50 chars, not a Bubble id) |
| `SELARTI_COMPANY_ID` | set |
| `SELARTI_TASK_ID` | set — task name `test expert`, type Telegram, status in progress |
| `SELARTI_AI_ID` | set — **new** agent created via `POST /api/1.1/wf/create_ai`, name `ии-Тоня`, version `gpt-4o`, work option `incoming and outgoing communication` |
| `SELARTI_ENABLED` | **false** |
| `SELARTI_WEBHOOK_SECRET` | placeholder |

`create_ai` docs: [Selarti public API](https://docs.selarti.com/), body fields `company_id`, `name`, `start_message`, `version`, `work_option`, `instruction`. Meta: `GET https://selarti.com/api/1.1/meta`.

The task `test expert` still points at the older agent `41nano` (`gpt-4.1-nano`). The new `ии-Тоня` agent is **not** bound to that task. Do not call `update_task` or enable flags without an explicit owner ask.

## What is blocked / not done

1. Formal close of TASK-EXP-001 review checkbox; optional Warning pass.
2. Bind `ии-Тоня` AI to a task if that is wanted (currently `test expert` → `41nano`).
3. Selarti live path: webhook URL + `SELARTI_WEBHOOK_SECRET`, channel mapping, `SELARTI_RESPONSE_INGRESS_*` (absent from the working `.env`; only in `.env.example`), cost admission, `selarti_ai_processing` consent. Keep `SELARTI_ENABLED=false` until that is asked.
4. Push of the 4 local commits.
5. Owner DEC pack (23 P0 cards) still holds FIN/PLT implementation. Decision sheet: `/home/pall/projects/ii-tonya-base/outputs/owner-decision-sheet-2026-09-16.md`.
6. Planerka / Make / Sheets still placeholders. Telegram bot tokens exist; webhook/HMAC/admin chat ids do not. YooKassa key exists; `PAYMENTS_ENABLED=false`.

## Next actions (pick one, do not mix)

- **Copy-guard:** mark TASK-EXP-001 review closed on the card *or* fix remaining Warnings with new RED tests, rebuild domain dist, re-review exact HEAD.
- **Selarti wiring:** bind AI to task / add webhook secret and receiver — only if the owner asks; do not flip `SELARTI_ENABLED`.
- **Owner decisions:** walk the 23 DEC cards; do not invent variants.
- **Publish:** push `codex/owner-spec-2026-09-16` when asked.

## Standing rules for this branch

- Node 24, pnpm 11.9.0, `pnpm install --frozen-lockfile`, no `drizzle-kit generate`.
- External capabilities default-off. This branch does not authorize deploy, production enablement, or secret rotation into git.
- After editing `packages/domain/src/**`, run tsup on that package before focused vitest of `@ii-tonya/domain` importers.
- Spec contract: `_bmad-output/specs/spec-owner-update-2026-09-16/execution-contract.md`.
