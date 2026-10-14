# Целостность данных и миграций

| Метрика                                                    | Значение (проверено на `origin/main`)                                        |
| ---------------------------------------------------------- | ---------------------------------------------------------------------------- |
| Записей в `packages/db/migrations/meta/_journal.json`      | 39 (`0000`…`0038`)                                                           |
| Файлов `meta/NNNN_snapshot.json`                           | 19 (`0000`–`0013`, `0015`–`0018`, `0021`)                                    |
| Отсутствует снапшотов                                      | **20**: `0014`, `0019`, `0020`, `0022`…`0038`                                |
| Парность journal ↔ `.sql`                                  | ровная: 39 записей, 39 файлов, `idx` непрерывен                              |
| `drizzle-kit check`                                        | проходит зелёным ("Everything's fine")                                       |
| `drizzle-kit up`                                           | проходит зелёным, снапшоты не воссоздаёт (19 → 19)                           |
| `drizzle-kit generate`                                     | падает: `TypeError: Do not know how to serialize a BigInt`                   |
| Причина падения                                            | `packages/db/src/schema/integration.ts:478` — `bigint(...).default(0n)`      |
| Generate после обхода BigInt (в копии)                     | выдаёт `0039_*.sql` на 215 инструкций, пересоздавая объекты из `0022`–`0038` |
| Ручной прогон `0000→0038` через psql на чистом Postgres 16 | **без ошибок**: 98 таблиц, 12 enum                                           |

Читается так: сам SQL-исторический ряд консистентен и cold-deploy на уровне схемы воспроизводится, но
метаданные drizzle оборваны на 0021 (`0019` и `0020` отсутствуют при наличии `0021`, то есть дыра не только в хвосте). Любой последующий `drizzle-kit generate` либо упрётся в
BigInt-краш, либо выдаст миграцию-дубль. При этом `check`, `up` и `tests/repo/db-schema-parity.test.ts`
(он сверяет текст конкретных `.sql`) ничего не замечают, а шаг `Validate Drizzle metadata` в
Database Gate зелёный.

Подробности, воспроизведение и три варианта лечения:
[#60](https://github.com/Dimkox/ii-tonya-platform/issues/60).

Заморожено guard-тестом `tests/repo/migration-history-integrity.test.ts` (PR [#64](https://github.com/Dimkox/ii-tonya-platform/pull/64)):
6 проверок зелёные, три негативные мутации (новая запись journal без снапшота, несжатый baseline,
второй BigInt-дефолт) краснеют; `vitest run tests/repo` после сборки — 47 файлов / 349 тестов.

← [Home](Home.md) · [Состав](Composition-and-Flags.md)
