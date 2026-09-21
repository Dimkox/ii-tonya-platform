# TASK-FIN-030: Движок расхода партнёрских полос и записи посещаемости группы

> For agentic workers: исполнять по superpowers:subagent-driven-development или superpowers:executing-plans после закрытия зависимостей.

**Goal:** Учёт расхода полос: одно событие не может расходовать корзину большей полосы и не может быть засчитано дважды.

**Architecture:** Следовать существующим границам пакетов на SHA `18af66fef61c33d21216c3b24f935cb1fe3d7b2d` и [контракту исполнения](../execution-contract.md).

**Tech Stack:** TypeScript, Node 24, pnpm 11.9.0, PostgreSQL; для design/content — форматы из критериев задачи.

**Spec:** [SPEC.md](../SPEC.md), [requirements.md](../requirements.md).

## Статус и область

- State: `planned`; readiness: `pending_dependencies`.
- Тип: implementation; исполнитель: backend; приоритет: P1.
- Depends on: `TASK-FIN-029`.
- Решения: `DEC-FIN-012`, `DEC-FIN-013`.
- Вопросы: нет.
- Статус live: ничего не включено и не активировано; внешние флаги остаются `false`, опубликованные тексты не меняются (DEC-PLT-007).

## Что уже есть

Strict-band consumption описан в артефактах, но не реализован: eventEntitlements участвует только в валидации формы и в выводе котировки (partner-pricing.ts:73-74, :84), таблиц расхода/entitlement-лимита нет (проверено 2026-09-21), полей вместимости и посещаемости в expert-residency.ts нет.

## Файлы

**Прочитать:**

- [partner-pricing.ts](../../../../packages/domain/src/partner-pricing.ts)
- [partner-commerce.ts](../../../../packages/db/src/schema/partner-commerce.ts)


**Получить от зависимых задач (файлы ещё предстоит создать):**

- `tests/repo/partner-tier-wiring.test.ts` (от `TASK-FIN-029`)


**Изменить:**

- [partner-pricing.ts](../../../../packages/domain/src/partner-pricing.ts)


**Создать:**

- [0039_partner_band_consumption.sql](../../../../packages/db/migrations/0039_partner_band_consumption.sql)
- [partner-band-consumption.test.ts](../../../../tests/repo/partner-band-consumption.test.ts)


**Проверки:**

- [partner-band-consumption.test.ts](../../../../tests/repo/partner-band-consumption.test.ts)


## Пункты задачи

- [ ] Учёт расхода полос: одно событие не может расходовать корзину большей полосы и не может быть засчитано дважды.
- [ ] Запись посещаемости включённой группы (до 20 человек по REQ-FIN-013.01) как основание распределения 30/70.


## Шаги

- [ ] Реализовать ledger расхода поверх существующей versioned policy, без дублирования полос в коде.
- [ ] Держать миграцию ручной (drizzle-kit generate запрещён) и проверить SQL-совпадение с живой БД до применения.


## Критерии приёмки

- [ ] Тест: второе событие сверх лимита полосы отклоняется или тарифицируется как дополнительная группа (10%/15%).
- [ ] Тест: сумма deposit+remainder conservation 30/70 сохраняется при любом числе участников до 20.


## Команды проверки

```bash
pnpm exec vitest run tests/repo/partner-band-consumption.test.ts
```


## Evidence и завершение

- [ ] Результаты проверок сохранены под `docs/test-evidence/` с точным коммитом и датой прогона.
- [ ] Независимый review пройден; live-активация по локальному тесту не объявляется.
- [ ] Миграции — только вручную (`drizzle-kit generate` запрещён AGENTS.md).
