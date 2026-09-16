# Agent status — owner-spec 2026-09-16

Updated: 2026-09-16 after squash-merge to main. This is the live continuation
file. Read it before `AGENTS.md` extras, the spec README, or any TASK card. Do
not treat older handoffs (`docs/handoffs/2026-08-*`) as current.

**Do not print, commit, or paste `.env` values.** Names of variables only.

## Where you are

| Item | Value |
|---|---|
| Canonical checkout | `/home/pall/projects/ii-tonya-base/work/ii-tonya-platform` on `main` |
| `main` SHA | `584dd10` (docs: DEC-FIN-017 accepted) ; last feature merge = `7777ae5` PR #94 (TASK-PLT-008 substrate). Accepted decisions: DEC-PLT-004 (#92/#93), DEC-FIN-017. On top of #91/#90/#89. |
| Feature branch | `codex/owner-spec-2026-09-16` still exists locally in `.worktrees/owner-spec-2026-09-16` (not deleted; `main` was already checked out in the primary worktree) |
| Copy-guard follow-up | PR [#89](https://github.com/Dimkox/ii-tonya-platform/pull/89) squash-merged to `main` as `b2b7af9c`; branch `codex/copy-guard-warnings-2026-09-16` deleted (local and remote) |
| PLT-013 follow-up | PR [#90](https://github.com/Dimkox/ii-tonya-platform/pull/90) squash-merged to `main` as `6ec3f505` (`botKey` log redaction + review close); branch `codex/plt-013-botkey-redaction` deleted (local and remote) |
| Copy-guard pre-squash tip | `b6215e8` (history rewritten by squash; use `92993646` on main) |
| Spec package | `_bmad-output/specs/spec-owner-update-2026-09-16/` |
| Local secrets | `/home/pall/projects/ii-tonya-base/work/ii-tonya-platform/.env`, mode `0600`, gitignored |

Continue new work from **`main` at `f1e0b4b`** (or later HEAD after DEC-FIN-003 record), not from the old feature-branch SHAs.

**DEC-PLT-004 accepted 2026-09-17** (PR #92; §4/#3 made explicit via PR #93): owner chose variant A and ruled every §8 red-line; the
профильная проверка was executed by a compliance agent → `evidence/DEC-PLT-004-rule.md`. Register
status `accepted`; `TASK-DEC-PLT-004` merged; `backlog.json` readiness re-derived
(EXP-006/PLT-008/PLT-010/PLT-016 → `pending_dependencies`). Key consequences: **owner-explicit rule
(§9, 2026-09-17): the operator's only PII store is PostgreSQL on RF servers** — Sheets/Make are *not* a
PII store (de-identified projections or off; an RF "table with a mandate" as a second store was NOT
chosen), Telegram is transport only, object_store/backups RF; region proof in `go-live-evidence.md`
still required before any enablement. A005
sensitive fields kept **only as ephemeral in-session presence/absence** — no persisted column, never
sent to expert (the §2 «zero forbidden columns» invariant stands, enforced by checks §7.1/§7.5);
Telegram stays a channel; Sheets/Make off; micro-check-ins in-session; 18+ self-declaration +
reactive ban; T0-B re-consent campaign 60 days; already-paid/active **grandfathered**. Next target:
keystone **PLT-008** (its legal Q-001/117/139/143/144 are answered by the rule; Q-031 technical).
Public-text propagation is **TASK-PLT-012**, left open on purpose. SPEC.md re-derive = bmad-spec/Claw
step (no derive script in this checkout; do not hand-edit SPEC). 28 owner decisions still open (accepted 11/39: DEC-PLT-004, DEC-FIN-017/001/002/003/011/012/005/016/010/020; 2026-09-17). Pending price data (DEC-FIN-003): absolute package prices not in source, carried as TASK-FIN-003 open questions.
accepting DEC-PLT-004 unblocked 0 tasks straight to `ready`.

Housekeeping (2026-09-16/17, no owner decision required): `backlog.json` per-task `state` reconciled —
EXP-001/PLT-013 now `merged` (`backlog.state` stays `planning_only`; delivery truth is AGENT-STATUS +
git). Local `codex/*` pruned 62 → **34** (28 removed: 5 ancestry-merged, then 23 with a verified PR
merged into `main` that were either fully synced to `origin` or whose remote was already deleted
post-merge). Kept deliberately: **10** worktree-locked (removing breaks a live worktree) and **24**
with no merged-into-`main` PR (content not provably in `main` — WIP or squash-merged under a renamed
head; a deeper pass needs per-PR/patch-id verification). Recovery log for the 23: `git branch <name> <sha>`
from this session's reflog. There is no unblocked engineering task left (verified: every remaining
card needs ≥1 of the 39 open `DEC` decisions or an open owner question).

## What is done

### TASK-EXP-001 copy guard (code)

State on the card: `implemented_pending_review`. Live activation is **not** in scope.

- `guardClientCopy` in `packages/domain/src/safety.ts`.
- Wired in `conversation-service.ts` (`kind === "answer"`) and in `decodeProviderTextProposal` (`selarti_response_copy_prohibited` → `rejected` before `proposals.accept`).
- Public brand markup is `<span>ии-</span>Тоня` with `.brand { gap: 0 }` in landing and legal views.
- Commits: `5eab17e` (guard), `0bae85a` (brand + provider ingress + negation/brand/normalize), `b6215e8` (word forms). Follow-up warning triage: `f7a899c` on `codex/copy-guard-warnings-2026-09-16`.

Focused tests after `b6215e8`: prompt-safety 121, selarti-response-service 17, client-copy-guard + web 35, conversation-service 66, domain 67.

Independent re-review after `b6215e8`: **no remaining Critical**. Follow-up `f7a899c` triages the
Warnings; a second independent review of that commit caught three false positives (`перебираю`
rejected, `оформляет … сегодня` rejected, the disclaimer word-order break) and those edits were
reverted / narrowed. Closed in `f7a899c`:

- Marketing word forms — наилучший, скидочный, выгоднейший, сэкономите, успевайте, порекомендуем —
  each as a targeted variant, no word boundary loosened.
- Format chars beyond ZWSP/soft-hyphen — LRM/RLM and the bidi embedding/override/isolate controls
  are stripped before matching.
- Pressure singular imperative «оформи сегодня» via whole-word `оформ(?:ите|и)`, so
  `оформляет`/`оформить`/`оформление` stay neutral.

Still open as accepted-by-design Warnings (a naive fix rejects approved copy — see commit body):

- Negation after-window: «Поставлю диагноз вам точно не сразу» still accepted — a distance rule
  cannot separate it from the protected «Диагноз по переписке не ставлю».
- «перебью» still accepted — widening `перебива*` also rejects «перебираю варианты/слоты».
- Homoglyphs (`лyчшие`) and landing «диагностика» were left on purpose.

Rebuild domain dist with tsup before tests that import `@ii-tonya/domain` (vitest does not alias it to source).

### TASK-PLT-013 secret surface (verification)

State on the card: `verified_pending_review`. An independent adversarial review of the merged
security surface closed the review checkbox; merged as PR [#90](https://github.com/Dimkox/ii-tonya-platform/pull/90)
(`6ec3f505`). It found no reachable credential→log leak in current paths. Live activation is not in scope.

- Redaction (`packages/observability/src/logger.ts`): the review then found one gap *in scope* —
  `botKey` / `CLIENT_TELEGRAM_BOT_KEY` was classified as a "bot identifier" and pinned visible by
  a test, but the client webhook authenticates it with `secureEqual` and it is the request path
  capability, i.e. a bearer secret. Fixed: `sensitiveKey` now matches `bot[-_]?key`; the test's
  wrong expectation is corrected; the inventory is reclassified. Log-time only, no functional impact.
- Recorded as SEPARATE follow-on findings (not in this fix, not blockers to closing PLT-013):
  - **F3 — observability defect (worth its own card).** `sanitizeTelemetry` uses `Object.entries`
    (drops prototype getters) and `sensitiveKey` has unanchored substrings `url|body|message|text|handle|proof|digest|cause`.
    Net effect: Fastify `req/res/err` serialize to near-nothing — `method`, client IP, and
    `statusCode` vanish from every access log, and the `server.ts` startup `fatal({err})` loses
    the boot-failure message. Not a leak; a debuggability regression.
  - **F2** `.child()` bindings bypass the `logMethod` hook (no `.child()` call exists in the repo today).
  - **F4** value-form gaps with no live log path: a `providerUrl` whose credential is a path segment
    (Make webhook), and `Buffer`/`Uint8Array` printed byte-by-byte.
  - Residual, by design: `integration_outbox.correlation_id` stores `telegram:<botKey>:<updateId>`
    (DB authority store, not log printing → outside REQ-PLT-004.07; the derivation is the idempotency
    key asserted in `telegram-client-b1.integration.test.ts`, so it is not changed here).

### TASK-EXP-019 design (partial — deterministic part merged)

Merged as PR [#91](https://github.com/Dimkox/ii-tonya-platform/pull/91) (`9437e727`). Only the
decision-free synthesis of `DET-159..182` was produced; the design finalization is deliberately
left open. No live activation.

- Done: `docs/design/ii-tonya-logo-character-brief.md` (REQ-EXP-019.01), `assets/brand/character/pose-inventory.json`
  (8 poses, DET-181 → REQ-EXP-019.02 inventory check), `docs/design/ii-tonya-sketch-review.md`
  (owner selection-record scaffold).
- Open, owner-gated: the final `assets/brand/logo.svg`, the 3–5 sketches + owner's pick (the card
  forbids a self-selected final variant), the rendered 8-pose set, and the palette — the palette is
  blocked on **`DEC-EXP-005`**, which also gates EXP-014/EXP-020/EXP-021.

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

1. ~~Formal close of TASK-EXP-001 review checkbox; optional Warning pass.~~ Done: safe Warnings
   fixed and review checkbox closed on `codex/copy-guard-warnings-2026-09-16`, squash-merged to
   `main` as `b2b7af9c` (PR #89). Two accepted-by-design Warnings remain (see copy-guard section).
2. Bind `ии-Тоня` AI to a task if that is wanted (currently `test expert` → `41nano`).
3. Selarti live path: webhook URL + `SELARTI_WEBHOOK_SECRET`, channel mapping, `SELARTI_RESPONSE_INGRESS_*` (absent from the working `.env`; only in `.env.example`), cost admission, `selarti_ai_processing` consent. Keep `SELARTI_ENABLED=false` until that is asked.
4. ~~Push of the local commits.~~ Done: PR #88 squash-merged to `main` as `92993646`.
5. Owner DEC pack (23 P0 cards) still holds FIN/PLT implementation. Decision sheet: `/home/pall/projects/ii-tonya-base/outputs/owner-decision-sheet-2026-09-16.md`. **After #89/#90/#91 (EXP-001, PLT-013, EXP-019 deterministic) there is no unblocked engineering task left**: every remaining card is `blocked_by_decision` (40 of 50 non-decision), gated by an open owner question that is commercial/legal rather than technical (EXP-007 stage semantics + selling funnel: Q-055/056/057; EXP-013: 6 Q's), or an owner sketch/palette pick (EXP-019 final render, `DEC-EXP-005`). Implementers must not invent these.
6. Planerka / Make / Sheets still placeholders. Telegram bot tokens exist; webhook/HMAC/admin chat ids do not. YooKassa key exists; `PAYMENTS_ENABLED=false`.

## Next actions (pick one, do not mix)

- **Copy-guard:** ~~fix remaining Warnings~~ done and merged (PR #89 → `b2b7af9c`). The two
  accepted-by-design Warnings above (negation timing-hedge, `перебью`) stay open unless the owner
  expands the card; a POS-style fix is the only safe way to close them.
- **Selarti wiring:** bind AI to task / add webhook secret and receiver — only if the owner asks; do not flip `SELARTI_ENABLED`.
- **Owner decisions:** this is now the **only** forward path for real feature work — walk the 23 DEC
  cards (`/home/pall/projects/ii-tonya-base/outputs/owner-decision-sheet-2026-09-16.md`, already
  prepared with verbatim variants + unblock-power ranking); record each via `_bmad/scripts/memlog.py`;
  do not invent variants. Once the top decisions land (DEC-PLT-004, DEC-FIN-017, DEC-FIN-005,
  DEC-FIN-026 each unblock 25–30 transitive tasks), re-derive readiness from `backlog.json`.
- **EXP-019 design final:** needs the designer's 3–5 sketches + the owner's recorded pick
  (`docs/design/ii-tonya-sketch-review.md`) and `DEC-EXP-005` (palette) before `logo.svg`/poses.
- **Publish:** no branch pending — #89/#90/#91 all merged to `main` (`9437e727`). Further work is a new `codex/*` branch from current `main`.

## Standing rules for this branch

- Node 24, pnpm 11.9.0, `pnpm install --frozen-lockfile`, no `drizzle-kit generate`.
- External capabilities default-off. This branch does not authorize deploy, production enablement, or secret rotation into git.
- After editing `packages/domain/src/**`, run tsup on that package before focused vitest of `@ii-tonya/domain` importers.
- Spec contract: `_bmad-output/specs/spec-owner-update-2026-09-16/execution-contract.md`.
