# TASK-FIN-029: Подключить qualified referral count к расчёту партнёрской полосы

> For agentic workers: исполнять по superpowers:subagent-driven-development или superpowers:executing-plans после закрытия зависимостей.

**Goal:** Котировка получает фактическое число подтверждённых квалифицированных рефералов, а не литерал 0.

**Architecture:** Следовать существующим границам пакетов на SHA `18af66fef61c33d21216c3b24f935cb1fe3d7b2d` и [контракту исполнения](../execution-contract.md).

**Tech Stack:** TypeScript, Node 24, pnpm 11.9.0, PostgreSQL; для design/content — форматы из критериев задачи.

**Spec:** [SPEC.md](../SPEC.md), [requirements.md](../requirements.md).

## Статус и область

- State: `planned`; readiness: `ready`.
- Тип: implementation; исполнитель: backend; приоритет: P1.
- Depends on: нет.
- Решения: `DEC-FIN-012`.
- Вопросы: нет.
- Статус live: ничего не включено и не активировано; внешние флаги остаются `false`, опубликованные тексты не меняются (DEC-PLT-007).

## Что уже есть

Порог не исполняется: единственная production-цепочка котировки жёстко передаёт qualifiedExpertCount: 0 (partner-commerce-repository.ts:101, проверено 2026-09-21), поэтому все shadow-котировки попадают в STANDARD. Тесты полос покрывают только 0/6/10, границ 4/5/9 нет.

## Файлы

**Прочитать:**

- [partner-pricing.ts](../../../../packages/domain/src/partner-pricing.ts)
- [partner-pricing.test.ts](../../../../packages/domain/src/partner-pricing.test.ts)
- [partner-commerce-repository.ts](../../../../packages/db/src/repositories/partner-commerce-repository.ts)
- [partner-commerce.ts](../../../../packages/db/src/schema/partner-commerce.ts)


**Получить от зависимых задач (файлы ещё предстоит создать):**

Нет.


**Изменить:**

- [partner-commerce-repository.ts](../../../../packages/db/src/repositories/partner-commerce-repository.ts)


**Создать:**

- [partner-tier-wiring.test.ts](../../../../tests/repo/partner-tier-wiring.test.ts)


**Проверки:**

- [partner-tier-wiring.test.ts](../../../../tests/repo/partner-tier-wiring.test.ts)


## Пункты задачи

- [ ] Котировка получает фактическое число подтверждённых квалифицированных рефералов, а не литерал 0.
- [ ] Boundary-тесты на 4/5/6/9/10 подтверждают: 5 ⇒ STANDARD, 6 ⇒ REFERRED_6_9, 10 ⇒ REFERRED_10_PLUS без ретро-смены.


## Шаги

- [ ] Взять источник qualified count из действующего движка квалификации (оплаченное/подтверждённое участие), не из числа регистраций.
- [ ] Не менять пороги DEC-FIN-012 (>=6 и >=10) и не трогать conservation-тесты полос.


## Критерии приёмки

- [ ] Ни одна новая котировка не сохраняется в STANDARD при >=6 подтверждённых рефералах (тест).
- [ ] Поведение существующих строк не меняется задним числом: пересчёт только для новых котировок.


## Команды проверки

```bash
pnpm exec vitest run tests/repo/partner-tier-wiring.test.ts
```


## Evidence и завершение

- [ ] Результаты проверок сохранены под `docs/test-evidence/` с точным коммитом и датой прогона.
- [ ] Независимый review пройден; live-активация по локальному тесту не объявляется.
- [ ] Миграции — только вручную (`drizzle-kit generate` запрещён AGENTS.md).
