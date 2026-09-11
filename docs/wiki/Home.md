# ии-Тоня · карта проекта

Wiki-репозиторий GitHub для приватных репозиториев на этом тарифе недоступен из API, поэтому карта
живёт в репозитории: `docs/wiki/`. Она же дублируется в GitHub как milestones `S1…S10`, issue-бэклог
и единая мета-карта [https://github.com/Dimkox/ii-tonya-platform/issues/62](https://github.com/Dimkox/ii-tonya-platform/issues/62).

**Что это.** Продукт «ии-Тоня»: Telegram-ассистент с подбором экспертов и записью + экспертная
резидентура с реферальной программой. Монорепо pnpm, TypeScript, Node 24, Fastify, Drizzle, PostgreSQL.
Продакшен: `https://ii-tonya.ru` (native systemd, без контейнеров).

## Текущий вердикт

| Вердикт               | Значение                                            | Где зафиксирован                                                                                                                                 |
| --------------------- | --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Релиз                 | **NO-GO**                                           | [`docs/runbooks/go-live-evidence.md`](https://github.com/Dimkox/ii-tonya-platform/blob/main/docs/runbooks/go-live-evidence.md)                   |
| Provider staging      | **BLOCKED**                                         | [`docs/runbooks/provider-staging-evidence.md`](https://github.com/Dimkox/ii-tonya-platform/blob/main/docs/runbooks/provider-staging-evidence.md) |
| Live-трафик           | **NO-GO**                                           | [`docs/integrations/live-readiness.md`](https://github.com/Dimkox/ii-tonya-platform/blob/main/docs/integrations/live-readiness.md)               |
| Активация провайдеров | запрещена, кроме платежей (`assertDisabled`)        | [`apps/api/src/app.ts`](https://github.com/Dimkox/ii-tonya-platform/blob/main/apps/api/src/app.ts)                                               |
| Боевая точка сборки   | 4 сервиса подставлены заглушкой `disabledService()` | [`apps/api/src/server.ts`](https://github.com/Dimkox/ii-tonya-platform/blob/main/apps/api/src/server.ts)                                         |

Эти строки вычитываются текстовыми тестами, поэтому «починить релиз» правкой документации нельзя.

## Навигация

- [Этапы S1–S10](Stages.md) · [бэклог открытых вопросов](Backlog.md)
- [Production-контур](Production.md) · [Верификация и Claw](Verification-Claw.md)
- [Состав, флаги и точка сборки](Composition-and-Flags.md)
- [Гейты go-live](Release-Gates.md) · [Словарь нумерации](Numbering.md)
- [Целостность миграций](Data-and-Migrations.md) · [Локальный прогон](Local-Verification.md)

## Этапы

| Этап  | Milestone                                                      | Статус                                                                                                    | PR  | Открытые issues                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ----- | -------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- | --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `S1`  | [1](https://github.com/Dimkox/ii-tonya-platform/milestone/1)   | ЗАВЕРШЁН                                                                                                  | 3   | —                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `S10` | [10](https://github.com/Dimkox/ii-tonya-platform/milestone/10) | АКТИВЕН · NO-GO                                                                                           | 0   | [#45](https://github.com/Dimkox/ii-tonya-platform/issues/45), [#53](https://github.com/Dimkox/ii-tonya-platform/issues/53), [#62](https://github.com/Dimkox/ii-tonya-platform/issues/62)                                                                                                                                                                                                                                                       |
| `S2`  | [2](https://github.com/Dimkox/ii-tonya-platform/milestone/2)   | ЗАВЕРШЁН как disabled candidate; остаток — перенос линейки на актуальный main (см. issue «rebase task25») | 9   | [#52](https://github.com/Dimkox/ii-tonya-platform/issues/52)                                                                                                                                                                                                                                                                                                                                                                                   |
| `S3`  | [3](https://github.com/Dimkox/ii-tonya-platform/milestone/3)   | АКТИВЕН                                                                                                   | 9   | [#6](https://github.com/Dimkox/ii-tonya-platform/issues/6), [#47](https://github.com/Dimkox/ii-tonya-platform/issues/47), [#48](https://github.com/Dimkox/ii-tonya-platform/issues/48), [#49](https://github.com/Dimkox/ii-tonya-platform/issues/49), [#51](https://github.com/Dimkox/ii-tonya-platform/issues/51), [#58](https://github.com/Dimkox/ii-tonya-platform/issues/58), [#71](https://github.com/Dimkox/ii-tonya-platform/issues/71) |
| `S4`  | [4](https://github.com/Dimkox/ii-tonya-platform/milestone/4)   | ЗАВЕРШЁН как default-off; активация заблокирована                                                         | 6   | [#55](https://github.com/Dimkox/ii-tonya-platform/issues/55)                                                                                                                                                                                                                                                                                                                                                                                   |
| `S5`  | [5](https://github.com/Dimkox/ii-tonya-platform/milestone/5)   | ЗАВЕРШЁН как default-off                                                                                  | 9   | [#56](https://github.com/Dimkox/ii-tonya-platform/issues/56)                                                                                                                                                                                                                                                                                                                                                                                   |
| `S6`  | [6](https://github.com/Dimkox/ii-tonya-platform/milestone/6)   | ЗАВЕРШЁН                                                                                                  | 6   | —                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `S7`  | [7](https://github.com/Dimkox/ii-tonya-platform/milestone/7)   | В РАБОТЕ (PR #38 CONFLICTING)                                                                             | 3   | [#57](https://github.com/Dimkox/ii-tonya-platform/issues/57)                                                                                                                                                                                                                                                                                                                                                                                   |
| `S8`  | [8](https://github.com/Dimkox/ii-tonya-platform/milestone/8)   | В РАБОТЕ (#42 draft, #30 draft CONFLICTING)                                                               | 4   | [#59](https://github.com/Dimkox/ii-tonya-platform/issues/59)                                                                                                                                                                                                                                                                                                                                                                                   |
| `S9`  | [9](https://github.com/Dimkox/ii-tonya-platform/milestone/9)   | В РАБОТЕ (#36 открыт)                                                                                     | 1   | [#61](https://github.com/Dimkox/ii-tonya-platform/issues/61)                                                                                                                                                                                                                                                                                                                                                                                   |

## Что крутится прямо сейчас

Единственный production-деплой: `233f3cf72e45e47117948ad5615b603252801e40` (14.08.2026), релиз
[`prod-233f3cf`](https://github.com/Dimkox/ii-tonya-platform/releases/tag/prod-233f3cf). Проверено 10.09.2026: `/health/live` = `live`,
`/health/ready` = `postgres/migrations/workerLease/adapters` — все `true`, экспертные маршруты `404`.

`origin/main` на 33 коммита впереди прода — см. [issue #48](https://github.com/Dimkox/ii-tonya-platform/issues/48).

## Правила связности

1. Один этап = один milestone с ключом `S1…S10` в заголовке.
2. Каждый PR обязан иметь milestone этапа и label `stage:*`.
3. Каждая задача = issue с label `stage:*`, milestone и блоком «Done when».
4. Статусы гейтов живут только в `docs/runbooks/` и `docs/contracts/`; здесь на них ссылки.
5. Деплой = tag + release на конкретный SHA + запись `docs/test-evidence/production/<sha>/deployment.md`.
