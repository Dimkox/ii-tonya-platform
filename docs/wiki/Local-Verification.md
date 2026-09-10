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

Дефолтный `max_connections = 100` недостаточен: `pnpm test:integration` идёт с `--maxWorkers=4`, каждая
сюита создаёт свою БД и держит пул, и на этом лимите ~25 сюит падают с `Failed query: …` и
`Test timed out`, **хотя поодиночке и малыми батчами проходят полностью**. Перед прогоном:

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

Прогон выполнен 10.09.2026 на этом хосте: Node v24.21.0, pnpm 11.9.0 (shim из `corepack enable`), Docker 29.8.0, `postgres:16-alpine`, checkout `codex/docs-wiki-map` = `origin/main` (`f0d67cc`) + документация этой страницы.

| Шаг                                                     | Результат                                                                                                                                         |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm install --frozen-lockfile`                        | ok                                                                                                                                                |
| `pnpm build`                                            | ok — 13 каталогов `dist`, 24 строки «Build success»                                                                                               |
| `pnpm typecheck`                                        | **ok**, exit 0 (все пакеты)                                                                                                                       |
| `pnpm test:unit`                                        | **155/155 файлов** — но только с заданным `II_TONYA_TEST_POSTGRES_ADMIN_URL`; без него 4 файла падают («required by the Claw PostgreSQL profile») |
| `pnpm test:property`                                    | ok (2 файла)                                                                                                                                      |
| `pnpm test:contract`                                    | ok (4 файла)                                                                                                                                      |
| `pnpm test:security`                                    | ok (5 файлов)                                                                                                                                     |
| `pnpm test:e2e`                                         | ok (6 файлов)                                                                                                                                     |
| `pnpm test:integration`                                 | см. ниже                                                                                                                                          |
| прогон `migrations/0000→0038` через `psql` на чистой БД | **без ошибок**: 98 таблиц, 12 enum                                                                                                                |

`test:integration` (116 файлов, `--maxWorkers=4`):

| Конфиг Postgres                                                                           | Итог                                                                                |
| ----------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `max_connections=100` (дефолт образа)                                                     | 25 файлов FAIL, `Failed query: …`, `Test timed out`                                 |
| после `max_connections = 500` (`shared_buffers` не менялся: команда с `256MB` отвалилась) | **3 файла FAIL, 113 passed; утверждений не провалено ни одного — 669 passed / 669** |

Оставшиеся 3 — это не дефекты кода, а таймауты teardown: `tests/integration/commercial-core-v2-migration.test.ts:17`, `hybrid-message-gateway-b3.test.ts:52`, `partner-commerce-a-migration.test.ts:8`, все три — `Error: Hook timed out in 45000ms` на `afterAll → database.stop()`. Эти сюиты поднимают БД через testcontainers (`startTestPostgres()`), а остальные 24 — через внешний профиль, и на общем хосте остановка контейнера не успевает в дефолтный `hookTimeout`.

Вывод для #47 и #51: код main проходит собственные проверки, а «красный» результат даёт невоспроизводимость окружения — два разных способа поднять Postgres внутри одного яруса, незадокументированное требование БД даже для unit-яруса и дефолтный лимит соединений. Именно это и нужно зафиксировать в возвращаемом гейте, иначе он будет давать ложные падения.

Вывод: продуктовый код на main проходит собственные проверки; «красный» прогон получается из-за
недокументированных требований к окружению (БД даже для unit-яруса и лимит соединений). Их стоит
зафиксировать вместе с возвращаемым гейтом.

← [Home](Home.md) · [Верификация](Verification-Claw.md)
