# Agent status — owner-spec 2026-09-16

Updated: 2026-09-21 — owner verdict **Б** on the consent ТЗ review: DEC-PLT-004
partially reopened, gate cards DEC-PLT-011…014 and TASK-PLT-017…021 created (see
the 2026-09-21 section below). This is the live continuation file. Read
it before `AGENTS.md` extras, the spec README, or any TASK card. Do not treat
older handoffs (`docs/handoffs/2026-08-*`) as current.

**Do not print, commit, or paste `.env` values.** Names of variables only.

## Where you are

| Item | Value |
|---|---|
| Canonical checkout | `/home/pall/projects/ii-tonya-base/work/ii-tonya-platform` on `codex/fin-001-client-access-policy` (from `origin/main` @ `cb07bd1`) |
| `main` SHA | `cb07bd18` — live in production since 2026-09-18 (contains PR #97 `f6b0c296` expert_handoff read-path). This branch `codex/fin-001-client-access-policy` @ `e195029b` is 16 commits ahead of `origin/main` and has **no PR yet** |
| Decision register (2026-09-21) | 43 DEC cards: 39 `accepted` + 4 `open` (`DEC-PLT-011…014`, opened by verdict Б). `backlog.json`: 93 tasks — readiness `ready` 34 / `pending_dependencies` 51 / `blocked_by_decision` 8; state merged 25 / implemented_pending_review 8 / planned 60. `validate_backlog.py --repo-root .` → `ok: true` |
| Feature branch | `codex/owner-spec-2026-09-16` still exists locally in `.worktrees/owner-spec-2026-09-16` (not deleted; `main` was already checked out in the primary worktree) |
| Copy-guard follow-up | PR [#89](https://github.com/Dimkox/ii-tonya-platform/pull/89) squash-merged to `main` as `b2b7af9c`; branch `codex/copy-guard-warnings-2026-09-16` deleted (local and remote) |
| PLT-013 follow-up | PR [#90](https://github.com/Dimkox/ii-tonya-platform/pull/90) squash-merged to `main` as `6ec3f505` (`botKey` log redaction + review close); branch `codex/plt-013-botkey-redaction` deleted (local and remote) |
| Copy-guard pre-squash tip | `b6215e8` (history rewritten by squash; use `92993646` on main) |
| Spec package | `_bmad-output/specs/spec-owner-update-2026-09-16/` |
| Local secrets | `/home/pall/projects/ii-tonya-base/work/ii-tonya-platform/.env`, mode `0600`, gitignored |

Continue product work from **`main` at `cb07bd1`** (AGENT-STATUS after PR #97). Factory/Superpowers/Spec Kit install is a **separate** branch `codex/install-adaptive-factory-2.0.18` — do not mix it into this FIN-001 change.

## 2026-09-21 — вердикт владельца Б: reopen DEC-PLT-004 под «подробный режим»

Владелец по §8 рецензии на ТЗ «понятное согласие на данные в клиентской ветке»
(архив `ii-tonya-base/outputs/tz-client-consent-2026-09-21.md`, рецензия
`…-review.md`) выбрал **вариант Б**, а не рекомендованный А. Записано в
`.memlog.md` (запись 699, `--type decision --by user`).

Что это значит для исполнителя:

- Инвариант `DEC-PLT-004` §2 («специальные категории 152-ФЗ и ПД третьих лиц не
  хранятся никогда») **пересматривается**: целевая модель — добровольный
  подробный режим со спецданными по отдельному письменному согласию (ст. 9/10
  № 152-ФЗ) с надлежащей ЭП (CAP-3 ТЗ).
- **Interim-режим до закрытия `DEC-PLT-011…014` = действующее правило §1–§9 без
  изменений.** Подробный режим закрыт, спецданные не персистятся и не
  передаются, подбор остаётся договорным основанием (п.5 ч.1 ст.6) **без
  consent-записи**, одно согласие = одна цель, согласие выдаёт только клиент
  через верифицированный UI, публикация текстов по-прежнему под `DEC-PLT-007`
  до `TASK-PLT-012`. Reopen **не** разрешает хранить спецданные — он открывает
  работу по их допустимому хранению.
- Новые открытые карточки гейтов: `DEC-PLT-011` (способ ЭП, идентификация,
  доказательства), `DEC-PLT-012` (класс УЗ и доказательство РФ-региона для
  персиста спецданных), `DEC-PLT-013` (канал подписи и участие Telegram),
  `DEC-PLT-014` (правовая основа входного потока при незапрошенных спецданных и
  ПД третьих лиц). Вопросы `Q-001`, `Q-117`, `Q-144` возвращены в `open` — их
  единственный носитель `TASK-PLT-008`.
- Новые задачи: `TASK-PLT-017` **grant-механизм согласий** (readiness `ready`,
  независима от reopen — без неё CAP-5/6/7 неработоспособны: в проде `insert
  into consents` только с `decision='denied'` в `privacy-repository.ts:169,220`,
  роута выдачи нет, `privacyService = disabledService` — `apps/api/src/server.ts:337`);
  `TASK-PLT-018` карантин входящего текста (CAP-4 сегодня **нарушается**:
  `dialogue_inbound.text` хранит сырой текст 30 дней —
  `hybrid-message-repository.ts:105-107`); `TASK-PLT-019…021` — подпись/УЗ/канал,
  все `blocked_by_decision`.
- Незакрытый дефект реестра: 4 задачи висели `blocked_by_decision` при всех
  принятых DEC (`TASK-FIN-022`, `TASK-EXP-003`, `TASK-EXP-014`, `TASK-EXP-020`) —
  переведены в `pending_dependencies`. Поле `readiness` в этом пакете **кураторское**:
  единого дериватора нет, `open_question_ids` на него не влияет (замеры 21.09 —
  12 расхождений при деривации «DEC accepted + deps merged + oq empty», 8 при
  «DEC + deps»). Менять массово не стали.
- `validate_backlog.py` **не** сломан — вызывается из корня репозитория:
  `python3 _bmad-output/specs/spec-owner-update-2026-09-16/validate_backlog.py --repo-root .`
  (прогон 2026-09-21: `ok: true`, 93 задачи / 43 решения).
- Приложения 1–4 к ТЗ на машину не переносились: `CAP-9` остаётся
  непроверяемым, юридические ссылки ТЗ документами в пакете не подтверждены.

**Сдвиг релиза клиентского контура принят владельцем вместе с Б.**

### Независимый review FIN-артефактов (2026-09-21)

Review 7 артефактов `docs/superpowers/implementation-artifacts/fin-*.md` против принятых DEC и
против кода. Итог: **подпись ревьювера закрывает только TASK-FIN-001**; FIN-007 и FIN-014 —
после документабельных правок (исполнены этим прогоном); FIN-002 — нужен вердикт владельца по
Q-169 (часовой пояс/опорный timestamp) и сверка 30 vs 60 дней; FIN-012/013/015 упираются в код,
которого нет. Что исправлено и заведено:

- Исправлены ложные утверждения о текущем коде: `fin-expert-code-lifecycle.md` (колонок `visibleAt`
  нет, «один резидент — один активный код» схемой не обеспечено, клиентских coupon-таблиц нет,
  коды чеканятся батчем, а не при регистрации резидента), `fin-center-policy.md` и
  `fin-organizer-policy.md` (цены полос взяты из тест-фикстуры `partner-commerce-repository.test.ts:24`,
  действующих `approved` строк `partner_tariff_policy_versions` в дереве нет; production-путь
  котировки жёстко передаёт `qualifiedExpertCount: 0` — `partner-commerce-repository.ts:101`),
  `fin-expert-pricing-policy.md` (PRO `group_event_limit=3` вместо «per V2 row» + порядок скидок
  DEC-FIN-011), `fin-client-package-policy.md` (30 дней в `admin-repository.ts:369` против принятых
  60; убрана ссылка на значения локального `.env` под заголовком «Продакшен»),
  `fin-group-event-settlement.md` (вместимость 20 человек из REQ-FIN-013.01 + пример 30/70).
- Убрано преждевременное `status: "approved"` во всех 7 артефактах → `pending_review`
  (ревью ещё не подписано).
- `DEC-FIN-012` получил эрратум: скобка «5 ⇒ 12000; 15000 — с 6» была взаимоисключающей;
  операционное правило `>=6`/`>=10` и код (`partner-pricing.ts:77`) не менялись.
- `DEC-FIN-003` дополнен записью ранее данного вердикта владельца о ценах (`.memlog.md` 694,
  коммит `de0656f`) — гейт «до прайса владельца» закрыт.
- Новые открытые решения: `DEC-FIN-029` (многоразовость эксперского кода) и `DEC-FIN-030`
  (абсолютные цены партнёрских полос). Новые задачи: `TASK-FIN-029` (подключить qualified count к
  полосе + boundary-тесты, `ready`), `TASK-FIN-030` (движок расхода полос и посещаемости),
  `TASK-FIN-031` (видимость кода и один активный код), `TASK-FIN-032` (сид approved политик),
  плюс `TASK-DEC-FIN-029/030`.
- Карточки `tasks/*.md` синхронизированы с `backlog.json` по заголовкам State/readiness
  (59 карточек отставали; JSON — авторитет, валидатор их не проверяет).


**TASK-FIN-001 (this branch):** DEC-FIN-001 variant B already accepted. Wrote
`docs/superpowers/implementation-artifacts/fin-client-access-policy.md` — cohort
matrix + rollback without silent reassignment. Card
`implemented_pending_review`. Q-016 closed here; Q-169 stays on FIN-002. New
`free_client_v2` admission remains forbidden; `CLIENT_FREE_ACCESS_V2_ENABLED`
stays false. Independent review of the artifact is still open (checkbox on the
card). Live activation is not declared.

**PLT-008** substrate + expert_handoff read-path are on `main` (`f6b0c29` / #97);
card still `implemented_pending_review`. Deferred: reservation-binding migration
and Q-031 principal model (PLT-016/PLT-013).

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
step (no derive script in this checkout; do not hand-edit SPEC). DEC pack: 36/39 accepted (11 individually ruled + 25 по консервативному/без-ретро/keep-current варианту через делегацию «а дальше делай» 2026-09-17, суть в decision-register.md). OPEN: DEC-FIN-009 (Эксклюзив threshold), DEC-EXP-005 (палитра), DEC-EXP-006 (клинический ритм отзыв/пауза/чекап). Package prices owner-set 2026-09-17: 4999/5999/7999/10990 ₽.
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
5. Owner DEC pack: **39/39 accepted** (last three conservative 2026-09-17). Hard
   remaining owner input for SKU **prices is closed** (4999/5999/7999/10990 ₽).
   FIN-021 still needs the versioned paid policy in code. Live production
   runtime.env is unchanged. EXP-007 still has Q-055/056/057; EXP-013 still
   has six copy questions. Production cutover: NO-GO
   (`docs/runbooks/production-cutover-status.md`). Host identity and
   BatchMode `ii_tonya` SSH: PASS 2026-09-17
   (`docs/test-evidence/production/host-identity-2026-09-17.md`). Live SHA
   `cb07bd18` deployed 2026-09-18
   (`docs/test-evidence/production/cb07bd18-deploy-2026-09-18.md`); previous
   `7498ce65`. Local payments flags were not copied to runtime.env.
6. Planerka / Make / Sheets still placeholders. Telegram bot tokens exist; webhook/HMAC/admin chat ids do not. Local `.env` (gitignored): owner supplied YooKassa `shopId`; `PAYMENTS_ENABLED=true`, `YOOKASSA_ENABLED=true`, `PAYMENT_PROVIDER=yookassa`, `YOOKASSA_MODE=live`. `loadEnv` accepts. Production `/etc/ii-tonya/runtime.env` still has `PAYMENTS_ENABLED=false`; only the migration approval SHA and file mode were changed for this deploy. SKU prices recorded 4999/5999/7999/10990.

## Next actions (pick one, do not mix)

- **This branch:** remaining DEC pack closed conservatively; partner/expert/client
  policy artifacts written. RF legal-agent gate: `docs/legal/owner-update-legal-review.md`
  (legal PASS after owner attested RKN art.22 notice). `/privacy` and `/oferta`
  no longer treat use/accept as 152-FZ consent (156-FZ). See
  `docs/runbooks/production-cutover-status.md`.
  Production native SHA is live (`cb07bd18`); payments/providers remain **NO-GO**.
  Rollback drill: Claw rehearsal PASS
  (`docs/test-evidence/rollback-drill-2026-09-17.md`); host SSH PASS
  (`docs/test-evidence/production/host-identity-2026-09-17.md`); live rollback
  not executed.
- **SKU prices:** 4999 / 5999 / 7999 / 10990 ₽ recorded. Next code: TASK-FIN-021
  versioned paid policy. Local payments flags already on; production runtime.env
  is not.
- **FIN-001/007/012–015 review** then merge this branch.
- **PLT-008 close:** independent review of #97.
- **Selarti / YooKassa / Planerka:** do not flip `*_ENABLED`.
- **Factory tooling PR:** `codex/install-adaptive-factory-2.0.18` separately.

## Standing rules for this branch

- Node 24, pnpm 11.9.0, `pnpm install --frozen-lockfile`, no `drizzle-kit generate`.
- External capabilities default-off. This branch does not authorize deploy, production enablement, or secret rotation into git.
- After editing `packages/domain/src/**`, run tsup on that package before focused vitest of `@ii-tonya/domain` importers.
- Spec contract: `_bmad-output/specs/spec-owner-update-2026-09-16/execution-contract.md`.
