# TASK-DEC-FIN-031: Решить: Модель аффилиации партнёра с экспертами для расчёта полосы

> For agentic workers: исполнять по superpowers:subagent-driven-development или superpowers:executing-plans после закрытия зависимостей.

**Goal:** Запись решения DEC-FIN-031: что считается приведёнными экспертами для партнёра, из какой таблицы и с каким статусом подтверждения.

**Architecture:** Следовать существующим границам пакетов на SHA `18af66fef61c33d21216c3b24f935cb1fe3d7b2d` и [контракту исполнения](../execution-contract.md).

**Tech Stack:** TypeScript, Node 24, pnpm 11.9.0, PostgreSQL; для design/content — форматы из критериев задачи.

**Spec:** [SPEC.md](../SPEC.md), [requirements.md](../requirements.md).

## Статус и область

- State: `planned`; readiness: `blocked_by_decision`.
- Тип: decision; исполнитель: product-owner; приоритет: P1.
- Depends on: нет.
- Решает: `DEC-FIN-031` — Модель аффилиации партнёра с экспертами для расчёта полосы.
- Носитель: независимый review FIN-артефактов и попытка исполнения 2026-09-21.
- Статус live: ничего не включается; внешние флаги остаются `false`.

## Что уже есть

Открыто 2026-09-21 при попытке исполнить TASK-FIN-029: связи commercial_participants (CENTER/ORGANIZER) с экспертами в схеме нет, production-котировка передаёт qualifiedExpertCount: 0 (partner-commerce-repository.ts:101).

**Варианты из разбора:**

**1.** Новая таблица аффилиации participant↔expert с датой подтверждения.
**2.** Переиспользовать expert→expert referral graph через новый внешний ключ к organization_profiles.
**3.** Признать правило неактивным: shadow-котировки остаются STANDARD, перенос на будущий виток.

## Файлы

**Прочитать:**

- [decision-register.md](../../../../_bmad-output/specs/spec-owner-update-2026-09-16/decision-register.md)
- [partner-commerce.ts](../../../../packages/db/src/schema/partner-commerce.ts)
- [expert-residency.ts](../../../../packages/db/src/schema/expert-residency.ts)


**Получить от зависимых задач (файлы ещё предстоит создать):**

Нет.


**Изменить:**

- [decision-register.md](../../../../_bmad-output/specs/spec-owner-update-2026-09-16/decision-register.md)


**Создать:**

Нет.


**Проверки:**

Нет.


## Пункты задачи

- [ ] Запись решения DEC-FIN-031: что считается приведёнными экспертами для партнёра, из какой таблицы и с каким статусом подтверждения.


## Шаги

- [ ] Выбрать модель аффилиации (новая таблица связи / расширенный referral graph / признать правило неактивным) и зафиксировать её с числами и границами.


## Критерии приёмки

- [ ] Правило исполнимо без изобретения источника: после решения TASK-FIN-029 получает конкретный запрос подсчёта.
- [ ] Статус accepted в decision-register.md; связанные задачи переведены из blocked_by_decision.


## Команды проверки

```bash
python3 _bmad-output/specs/spec-owner-update-2026-09-16/validate_backlog.py --repo-root .
```


## Evidence и завершение

- [ ] Результаты проверок сохранены с точным коммитом.
- [ ] Независимый review пройден; live-активация не объявляется.
- [ ] Контрольный случай обязан перевернуться: тест, который не может стать красным, не является доказательством.
