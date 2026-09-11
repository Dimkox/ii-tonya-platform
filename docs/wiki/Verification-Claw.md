# Верификация: hosted CI, Claw и текстовые гейты

## Что есть на самом деле

| Механизм                      | Состояние 10.09.2026                                                                                                            |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `.github/workflows/*` на main | **отсутствуют** (удалены коммитом `f9b848e`, PR #14, 14.08)                                                                     |
| Последний прогон Actions      | Database Gate 27.08, `failure`                                                                                                  |
| Branch protection на main     | недоступна (тариф Free private → HTTP 403)                                                                                      |
| Текстовые гейты в тестах      | работают: `release-assets`, `workflow-semantics`, `env-policy`, `scope-boundary`, `architecture-boundaries`, `db-schema-parity` |
| Claw-ферма                    | активна: репозиторий `openclaw-airgap-farm`, пуши 10.09                                                                         |
| Каталог доказательств         | `docs/test-evidence/claw/*` (26 каталогов) + `docs/test-evidence/production/233f3cf…/deployment.md`                             |

Подробности и план: [https://github.com/Dimkox/ii-tonya-platform/issues/47](https://github.com/Dimkox/ii-tonya-platform/issues/47).

## Как устроены Claw-доказательства

Каждый прогон оставляет каталог по SHA исходника: отчёт режима (`ci.md`, `database.md`,
`release.md`, `client-booking.md`; у самодельных пакетов — `verification.md` с таблицей гейтов и
парами RED/GREEN), `environment-<mode>.txt` (версии node/pnpm, лимиты cgroup, `exit_code`),
`summary-<mode>.tsv` (статус и время каждого шага), `ARTIFACTS.sha256`, `remote-SHA256SUMS`.
Имена с суффиксом режима — с #81: раньше все режимы писали в общие `summary.tsv` и
`environment.txt` и обрезали их при каждом прогоне, поэтому release-прогон после ci стирал
доказательство ci. История не переименовывается — пакеты, записанные до #81, несут старые имена, и
`scripts/verify-claw-evidence.mjs` принимает и те, и другие. С #81 тот же скрипт считает ошибкой
пакет, в котором из шагов записана только установка зависимостей: такой пакет доказывает наличие
pnpm-store, а не прохождение гейта.

Записи честно помечают границу: «CODE CHECKPOINT PASS / … ACTIVATION BLOCKED», «No GitHub Actions,
image rebuild, production container, production SSH, merchant credential, or provider network call was
used», «This record permits code review and a default-off merge only».

## Слабое место

`environment.txt` привязан к конкретной машине и контейнеру (`ii-tonya-test-*`, PostgreSQL из
`/home/pall/app-stack`), hosted run ID нет. Независимый ревьюер не может ни пересобрать, ни даже
прочесть доказательство без доступа к этому хосту — [https://github.com/Dimkox/ii-tonya-platform/issues/51](https://github.com/Dimkox/ii-tonya-platform/issues/51).

## Трёхкратные повторы

`scripts/repeat-vitest.mjs` даёт `pnpm test:repeat -- 3 <пути>`; жёсткий максимум — три повтора, 20×
запрещён. Конкурентные сюиты (outbox, telegram-callback, expert-referral redemption/checkout/
settlement/deadline/hold-replay, message-ledger) гоняются именно так, последний коммит линейки —
`test: guard tracked three-run evidence`.

## Как прогнать локально

```bash
node --version          # требуется >=24 <25
pnpm install --frozen-lockfile
pnpm build              # пакеты публикуют только dist, typecheck идёт после build
pnpm test:unit && pnpm test:property && pnpm test:contract && pnpm test:security
# ниже нужен Docker (testcontainers тянет postgres:16-alpine):
pnpm test:integration && pnpm test:e2e
pnpm verify             # полная лестница + pnpm audit --prod (нужна сеть)
```

← [Home](Home.md) · [Состав](Composition-and-Flags.md)
