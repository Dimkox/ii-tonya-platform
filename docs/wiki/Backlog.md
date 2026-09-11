# Бэклог открытых вопросов

Открытых issues: 19. Получены из разбора репозитория,
production-контура и документации 10.09.2026.

| #                                                            | Этап  | Заголовок                                                                                                      | Labels                                                                   |
| ------------------------------------------------------------ | ----- | -------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| [#45](https://github.com/Dimkox/ii-tonya-platform/issues/45) | `S10` | Точка сборки: 4 ingress-сервиса подставлены disabledService(), Telegram-границы захардкожены                   | `gate:no-go`, `type:product-gap`                                         |
| [#53](https://github.com/Dimkox/ii-tonya-platform/issues/53) | `S10` | 6 открытых PR в статусе CONFLICTING/DIRTY: #30 #31 #32 #34 #35 #38                                             | `gate:no-go`, `gate:pending`                                             |
| [#62](https://github.com/Dimkox/ii-tonya-platform/issues/62) | `S10` | Карта этапов S1–S10: milestone, PR, гейты и остаток                                                            | `documentation`, `gate:no-go`                                            |
| [#52](https://github.com/Dimkox/ii-tonya-platform/issues/52) | `S2`  | Перенести expert-referral линейку (task25) на актуальный main: ветка ни разу не синхронизировалась             | `stage:expert-residency`, `gate:pending`                                 |
| [#60](https://github.com/Dimkox/ii-tonya-platform/issues/60) | `S2`  | Миграции: 21 из 39 записей journal без снапшотов, drizzle-kit generate падает, ни одна проверка этого не ловит | `stage:expert-residency`, `type:ops`, `area:data`                        |
| [#6](https://github.com/Dimkox/ii-tonya-platform/issues/6)   | `S3`  | ops/server-control                                                                                             | `stage:release-eng`, `type:ops`                                          |
| [#47](https://github.com/Dimkox/ii-tonya-platform/issues/47) | `S3`  | На main нет ни одного workflow: hosted CI не запускался с 27 августа, merge в main ничем не проверяется        | `stage:release-eng`, `type:ops`                                          |
| [#48](https://github.com/Dimkox/ii-tonya-platform/issues/48) | `S3`  | Дрейф релиза: прод = 233f3cf (14 авг), main на 33 коммита впереди; деплой помечен not reproducible             | `stage:release-eng`, `gate:pending`, `type:ops`                          |
| [#49](https://github.com/Dimkox/ii-tonya-platform/issues/49) | `S3`  | Прод сохранён с PermitRootLogin yes и PasswordAuthentication yes (PR #15) — нужен план отключения              | `stage:release-eng`, `type:security`                                     |
| [#50](https://github.com/Dimkox/ii-tonya-platform/issues/50) | `S3`  | Deploy-обвязка, релизные артефакты и bootstrap-скрипты лежат вне VCS единственной копией                       | `stage:release-eng`, `type:ops`                                          |
| [#51](https://github.com/Dimkox/ii-tonya-platform/issues/51) | `S3`  | Claw-evidence воспроизводимо только на одном хосте (/home/pall/app-stack)                                      | `stage:release-eng`, `type:ops`, `evidence:claw`                         |
| [#58](https://github.com/Dimkox/ii-tonya-platform/issues/58) | `S3`  | Внедрить release-per-deployment: тегов было 0, первый release заведён вручную за 233f3cf                       | `stage:release-eng`, `type:ops`                                          |
| [#55](https://github.com/Dimkox/ii-tonya-platform/issues/55) | `S4`  | YooKassa: активация заблокирована — пустые кредеды, нет test-shop, фискализации и регистрации                  | `stage:payments`, `gate:no-go`, `area:payments`                          |
| [#56](https://github.com/Dimkox/ii-tonya-platform/issues/56) | `S5`  | Telegram: нет project-owned бота, токена, webhook и chat mapping; флаг заперт на уровне типа                   | `stage:expert-verticals`, `gate:no-go`, `evidence:claw`, `area:telegram` |
| [#46](https://github.com/Dimkox/ii-tonya-platform/issues/46) | `S6`  | Боевой createDefaultLifecycle не покрыт ни одним e2e: зелёный CI не доказывает прод-сборку                     | `stage:mvp-client`, `type:product-gap`                                   |
| [#54](https://github.com/Dimkox/ii-tonya-platform/issues/54) | `S7`  | A2.1: проверить фактическую проводку EXPERT_REFERRAL_MATURITY_WORKER_ENABLED на main                           | `stage:hybrid`, `gate:pending`                                           |
| [#57](https://github.com/Dimkox/ii-tonya-platform/issues/57) | `S7`  | Selarti B2: нет официального authenticated fixture и staging-реконсиляции unknown outcome                      | `stage:hybrid`, `gate:no-go`, `evidence:claw`                            |
| [#59](https://github.com/Dimkox/ii-tonya-platform/issues/59) | `S8`  | Веб-статика на проде новее API-релиза: index.html от 27 авг против API 233f3cf от 14 авг                       | `stage:web`, `type:ops`                                                  |
| [#61](https://github.com/Dimkox/ii-tonya-platform/issues/61) | `S9`  | Retention / legal / minor-data approval: blocked, independent reviewer unassigned                              | `stage:compliance`, `gate:no-go`                                         |

Используемые labels: `area:data`, `area:payments`, `area:telegram`, `documentation`, `evidence:claw`, `gate:no-go`, `gate:pending`, `stage:compliance`, `stage:expert-residency`, `stage:expert-verticals`, `stage:hybrid`, `stage:mvp-client`, `stage:payments`, `stage:release-eng`, `stage:web`, `type:ops`, `type:product-gap`, `type:security`

## Приоритет, который зафиксирован при разборе

1. [https://github.com/Dimkox/ii-tonya-platform/issues/45](https://github.com/Dimkox/ii-tonya-platform/issues/45) — composition root: ~25k строк проверенного кода упираются в `disabledService()`.
2. [https://github.com/Dimkox/ii-tonya-platform/issues/47](https://github.com/Dimkox/ii-tonya-platform/issues/47) — на main нет ни одного исполняемого гейта.
3. [https://github.com/Dimkox/ii-tonya-platform/issues/48](https://github.com/Dimkox/ii-tonya-platform/issues/48) — прод на 33 коммита позади main, деплой «not reproducible».
4. [https://github.com/Dimkox/ii-tonya-platform/issues/49](https://github.com/Dimkox/ii-tonya-platform/issues/49) — root-password доступ на проде.
5. [https://github.com/Dimkox/ii-tonya-platform/issues/52](https://github.com/Dimkox/ii-tonya-platform/issues/52) — expert-referral линейка не синхронизирована с main.

← [Home](Home.md) · [Этапы](Stages.md)
