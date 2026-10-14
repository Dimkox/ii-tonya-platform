# Локальный прогон всей лестницы

Это же ответ на вопрос «как проверить main без Claw и без hosted CI» — то, чего не хватает в
[#51](https://github.com/Dimkox/ii-tonya-platform/issues/51) и что делает возможным возврат гейта на main
([#47](https://github.com/Dimkox/ii-tonya-platform/issues/47)).

## Требования

| Что    | Значение                                                                                     |
| ------ | -------------------------------------------------------------------------------------------- |
| Node   | `>=24 <25` (проверено на v24.21.0)                                                           |
| pnpm   | 11.9.0 из `packageManager`; если его нет в PATH: `corepack enable --install-directory ~/bin` |
| Docker | нужен для интеграционного яруса (testcontainers или внешний Postgres)                        |
| Сеть   | нужна на `--frozen-lockfile` и `pnpm audit --prod`                                           |

Важно: `corepack pnpm build` не работает как есть — скрипты внутри дёргают `pnpm` по PATH, поэтому
нужен именно shim от corepack, а не вызов через `corepack pnpm`.

## Postgres-профиль

Часть «unit»-тестов на main на самом деле требует БД: `packages/sandbox-payments/{adapter,repository,
verifier,workflow}.test.ts` падают с `II_TONYA_TEST_POSTGRES_ADMIN_URL is required by the Claw
PostgreSQL profile`, если переменная не задана. То есть `pnpm test:unit` без БД красный — 4 файла из 155.

Минимальный контейнер:

```bash
docker run -d --name ii-tonya-test-pg -e POSTGRES_PASSWORD=test -p 55432:5432 postgres:16-alpine
export II_TONYA_TEST_POSTGRES_ADMIN_URL='postgresql://postgres:test@localhost:55432/postgres'
```

Дефолтного `max_connections = 100` не хватает: у `pnpm test:integration` на main нет явного лимита
воркеров, поэтому Vitest берёт «ядра − 1» (21 на этом хосте), каждая сюита создаёт свою БД и держит пул,
и на этом лимите до 25 файлов падают с `Failed query: …` и `Test timed out` — **хотя поодиночке и малыми
батчами проходят полностью**. Перед прогоном:

```bash
docker exec ii-tonya-test-pg psql -U postgres \
  -c "alter system set max_connections = 500"
docker restart ii-tonya-test-pg
```

Единицы измерения в `alter system` требуют кавычек: `shared_buffers=256MB` без кавычек даёт
`ERROR: trailing junk after numeric literal at or near "256MB"`, и `psql` с несколькими `-c` возвращает
при этом 0 — команда выглядит применённой, а значение остаётся заводским. Результат ниже получен
**только** за счёт `max_connections`, `shared_buffers` не менялся.

## Порядок и результат

```bash
pnpm install --frozen-lockfile
pnpm build
pnpm typecheck
pnpm test:unit          # 155 файлов
pnpm test:property      # 2
pnpm test:contract      # 4
pnpm test:security      # 5
pnpm test:integration
pnpm test:e2e           # 6
```

Прогон выполнен 10–11.09.2026 на этом хосте: Node v24.21.0, pnpm 11.9.0 (shim из `corepack enable`),
Docker 29.8.0, `postgres:16-alpine`, checkout `origin/main`.

| Шаг                                                     | Результат                                                                                                                                                                                                                      |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `pnpm install --frozen-lockfile`                        | ok                                                                                                                                                                                                                             |
| `pnpm build`                                            | ok — 13 каталогов `dist`, 24 строки «Build success»                                                                                                                                                                            |
| `pnpm typecheck`                                        | **ok**, exit 0 (включая `tsc -p tsconfig.tests.json`)                                                                                                                                                                          |
| `pnpm test:unit`                                        | **155/155 файлов** — но только с заданным `II_TONYA_TEST_POSTGRES_ADMIN_URL`; без него 4 файла (`packages/sandbox-payments/{adapter,repository,verifier,workflow}.test.ts`) падают с «required by the Claw PostgreSQL profile» |
| `pnpm test:property`                                    | ok (2 файла)                                                                                                                                                                                                                   |
| `pnpm test:contract`                                    | ok (4 файла)                                                                                                                                                                                                                   |
| `pnpm test:security`                                    | ok (5 файлов)                                                                                                                                                                                                                  |
| `pnpm test:e2e`                                         | ok (7 файлов после #65)                                                                                                                                                                                                        |
| `pnpm test:integration`                                 | см. профиль ниже                                                                                                                                                                                                               |
| прогон `migrations/0000→0038` через `psql` на чистой БД | **без ошибок**: 98 таблиц, 12 enum                                                                                                                                                                                             |

## Профиль `test:integration` (117 файлов)

На main скрипт — `vitest run tests/integration tests/support tests/repo` **без** `--maxWorkers`: лимита
воркеров в репозитории нет, работает дефолт Vitest (число ядер − 1 = 21 на этом хосте). Ограничение
`--maxWorkers=4` существовало только в старой ветке `codex/task25-expert-referral-design`.

| Вариант                               | wall                                            | провалено утверждений   | `Hook timed out` по прогонам                |
| ------------------------------------- | ----------------------------------------------- | ----------------------- | ------------------------------------------- |
| default (21 воркера), тихая машина    | 84.7 / 87.5 / 91.2 s                            | 0                       | 0, 0, 0                                     |
| default, хост под фоновой нагрузкой   | 112.1 / 112.7 / 125.3 / 126.0 / 135.9 / 180.8 s | 0                       | 1, 3, 7, 7                                  |
| `--maxWorkers=8`                      | 147.1 s и 275.6 s                               | 0                       | 0 (во втором прогоне — 2× `Test timed out`) |
| `--maxWorkers=12`                     | 192.4 / 194.3 s                                 | 0, но 15 FAIL во втором | 1, плюс 2–4× `Test timed out`               |
| `max_connections=100` (дефолт образа) | —                                               | 0                       | до 25 файлов FAIL за прогон                 |

Суммарное время тестов при wall ≈85 s — ≈1550 s, то есть распараллеливание уже ≈18× на 22 ядрах.
Уменьшение числа воркеров платится временем почти трёхкратно (275.6 s против 87.5 s) без выигрыша в
чистоте; полный лог из 16 прогонов и разбор — в [#71](https://github.com/Dimkox/ii-tonya-platform/issues/71).

## Что проверено и не помогло

- **Меньше воркеров** (`--maxWorkers=8`) — медленнее (147 s против 85–91 s) и не чище.
- **Шаблонная БД вместо реплея миграций на сюиту** (`CREATE DATABASE … TEMPLATE` после одного `migrate`,
  advisory-лок между 21 процессом, digest миграций в имени шаблона) — **замедлила** до 127.8 s
  (тёплый) / 137.5 s (холодный) и **увеличила** число падений до 10–15, а фаза `collect` удвоилась
  (122 s → 238 s). Провалилось по двум причинам. Первая — механика клона: физическое копирование с
  эксклюзивным локом на шаблон, 21 воркер сериализуются, и стоимость клона выше стоимости реплея
  39 файлов миграций. Вторая — дефект самой схемы готовности: маркер готовности я положил таблицей
  `ii_tonya_test_template_ready` внутри шаблона, клон дублировал её в каждую базу, и закреплённый
  `tests/integration/schema.test.ts` список таблиц расходился (98 против 97) — единственные
  `AssertionError` за все 16 прогонов. Служебные объекты в шаблонах недопустимы: маркер должен жить
  вне клонируемой БД. Ветка удалена, не влита.
- **`DROP DATABASE … WITH (FORCE)`** в `packages/db/src/testkit/external-postgres.ts` — механизм
  правдоподобен (обычный drop ждёт дренажа всех бэкендов, что и выглядит как `afterAll`-таймаут), но на
  данных не подтвердился: `Hook timed out` по 5 прогонам на main = 3, 7, 1, 0, 0; по 4 прогонам с FORCE =
  0, 0, 2, 0. Осиротевших баз не наблюдалось ни в одной ветке (пока прогон не убьёшь вручную). Не влито:
  недоказанная правка в слое, где цена ошибки — молча удерживаемые тестовые БД.

Главная переменная — не конфигурация тестов, а соседние нагрузки на хосте (`app-stack-*`, `n8n-core`,
`drive-sync`, чужие Postgres): в тихие окна тот же код зелёный за ≈85 s, в нагруженные появляются
таймауты. Зафиксировано в [#71](https://github.com/Dimkox/ii-tonya-platform/issues/71).

## Вывод для #47 и #51

Код main проходит собственные проверки. «Красный» результат даёт окружение прогона: БД нужна даже
unit-ярусу, в одном ярусе сосуществуют два способа поднять Postgres (40 файлов через
testcontainers, 17 — через внешний профиль), дефолтный лимит соединений недостаточен, а стабильность
зависит от фоновой загрузки машины. Гейт, который этого не фиксирует, будет давать ложные падения — и,
как показывает практика этой недели, их дают и текущие локальные прогоны.

Вывод: продуктовый код на main проходит собственные проверки; «красный» прогон получается из-за
недокументированных требований к окружению (БД даже для unit-яруса и лимит соединений). Их стоит
зафиксировать вместе с возвращаемым гейтом.

← [Home](Home.md) · [Верификация](Verification-Claw.md)
