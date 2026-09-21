# TASK-PLT-017: Реализовать выдачу, просмотр и отзыв согласий (grant-механизм)

> For agentic workers: исполнять по superpowers:subagent-driven-development или superpowers:executing-plans после закрытия зависимостей.

**Goal:** Миграция packages/db/migrations/0039_consent_grant_audit.sql: audit-колонки §3 (text_hash, scope_fields, recipient_id, evidence_uri, reservation_id) и словарь целей включая отсутствующие.

**Architecture:** Следовать существующим границам пакетов на SHA `18af66fef61c33d21216c3b24f935cb1fe3d7b2d` и [контракту исполнения](../execution-contract.md).

**Tech Stack:** TypeScript, Node 24, pnpm 11.9.0, PostgreSQL; для design/content — форматы из критериев задачи.

**Spec:** [SPEC.md](../SPEC.md), [requirements.md](../requirements.md).

## Статус и область

- State: `planned`; readiness: `ready`.
- Тип: implementation; исполнитель: backend; приоритет: P0.
- Depends on: нет.
- Решения: `DEC-PLT-004`.
- Вопросы: нет.
- Статус live: ничего не включено и не активировано; внешние флаги остаются `false`, опубликованные тексты не меняются (DEC-PLT-007).

## Что уже есть

Цикл согласий замкнут наполовину (проверено 2026-09-21 на e195029b): insert into consents только в withdrawConsentAtomically и только с decision='denied' (privacy-repository.ts:169,220); HTTP-роута выдачи нет; privacyService=disabledService (apps/api/src/server.ts:337); audit-полей §3 (text_hash, scope_fields, recipient_id, evidence_uri, reservation_id) нет до ручной миграции 0039.

## Файлы

**Прочитать:**

- [owner-update-data-matrix.md](../../../../docs/operations/owner-update-data-matrix.md)
- [consent.ts](../../../../packages/domain/src/consent.ts)
- [privacy-repository.ts](../../../../packages/db/src/repositories/privacy-repository.ts)
- [server.ts](../../../../apps/api/src/server.ts)


**Получить от зависимых задач (файлы ещё предстоит создать):**

Нет.


**Изменить:**

- [consent.ts](../../../../packages/domain/src/consent.ts)
- [privacy-repository.ts](../../../../packages/db/src/repositories/privacy-repository.ts)
- [server.ts](../../../../apps/api/src/server.ts)


**Создать:**

- [0039_consent_grant_audit.sql](../../../../packages/db/migrations/0039_consent_grant_audit.sql)
- [consent-grant.test.ts](../../../../tests/repo/consent-grant.test.ts)


**Проверки:**

- [consent-grant.test.ts](../../../../tests/repo/consent-grant.test.ts)


## Пункты задачи

- [ ] Миграция packages/db/migrations/0039_consent_grant_audit.sql: audit-колонки §3 (text_hash, scope_fields, recipient_id, evidence_uri, reservation_id) и словарь целей включая отсутствующие.
- [ ] Сервисный путь grant: append-only запись decision='granted' с policy_version только по действию клиента; перенос privacyService из disabledService в реальный ингресс.
- [ ] API и экран клиента: просмотр действующих согласий, выдача цели, отзыв цели с остановкой отложенных заданий и поздних ответов.
- [ ] Регресс-тесты tests/repo/consent-grant.test.ts (grant→read-gate открывается, withdraw→закрывается, повторное нажатие идемпотентно).


## Шаги

- [ ] Спроектировать одну транзакцию grant по образцу withdrawConsentAtomically (serializable + advisory lock) и зафиксировать, что внешняя модель/промпт не имеют пути записи.
- [ ] Поднять privacy-ингресс (apps/api/src/server.ts:337) за default-off флагом клиентского контура; включить его без релиза нельзя.
- [ ] Согласие на подбор НЕ создавать: основание подбора — договор (DEC-PLT-004 §1), UI показывает acknowledgement без consent-записи.
- [ ] Миграцию выполнить вручную (drizzle-kit generate запрещён AGENTS.md) и проверить совпадение SQL с живой БД до применения.


## Критерии приёмки

- [ ] Ни одна спецкатегория не персистится: interim-правило DEC-PLT-004 §2 соблюдено, запрещённых колонок 0.
- [ ] grant возможен только через верифицированный UI клиента; тест-контроль: путь записи недоступен сервису внешней модели.
- [ ] CAP-5/6/7 ТЗ становятся исполнимыми: разрешение связано с экспертом/встречей/версией состава (аудит-колонки заполнены).
- [ ] Публичные тексты не изменены (DEC-PLT-007); live-активация не объявлена.


## Команды проверки

```bash
pnpm install --frozen-lockfile && pnpm exec vitest run tests/repo/consent-grant.test.ts
```


## Evidence и завершение

- [ ] Результаты проверок сохранены под `docs/test-evidence/` с точным коммитом и датой прогона.
- [ ] Независимый review пройден; live-активация по локальному тесту не объявляется.
- [ ] interim-правило `DEC-PLT-004` (§1–§9) соблюдается: спецданные и ПД третьих лиц не персистятся и не передаются, подробный режим закрыт.
