# TASK-DEC-FIN-029: Решить: Многоразовость эксперского referral-кода

> For agentic workers: исполнять по superpowers:subagent-driven-development или superpowers:executing-plans после закрытия зависимостей.

**Goal:** Запись решения DEC-FIN-029: выбранный вариант, основание, дата, ответственный.

**Architecture:** Следовать существующим границам пакетов на SHA `18af66fef61c33d21216c3b24f935cb1fe3d7b2d` и [контракту исполнения](../execution-contract.md).

**Tech Stack:** TypeScript, Node 24, pnpm 11.9.0, PostgreSQL; для design/content — форматы из критериев задачи.

**Spec:** [SPEC.md](../SPEC.md), [requirements.md](../requirements.md).

## Статус и область

- State: `planned`; readiness: `blocked_by_decision`.
- Тип: decision; исполнитель: product-owner; приоритет: P1.
- Depends on: нет.
- Решает: `DEC-FIN-029` — Многоразовость эксперского referral-кода.
- Вопросы: нет.
- Статус live: ничего не включено и не активировано; внешние флаги остаются `false`, опубликованные тексты не меняются (DEC-PLT-007).

## Что уже есть

Открыто независимым review FIN-артефактов 2026-09-21; ни один вариант не утверждён.

**Варианты из разбора:**

**1.** Код однократный: после redeem выпускается новый батч.
**2.** Код многоразовый в пределах периода с капитоном по политике.
**3.** Многоразовость только для резидента с первой успешной оплатой.

## Файлы

**Прочитать:**

- [decision-register.md](../../../../_bmad-output/specs/spec-owner-update-2026-09-16/decision-register.md)


**Получить от зависимых задач (файлы ещё предстоит создать):**

Нет.


**Изменить:**

- [decision-register.md](../../../../_bmad-output/specs/spec-owner-update-2026-09-16/decision-register.md)


**Создать:**

Нет.


**Проверки:**

Нет.


## Пункты задачи

- [ ] Запись решения DEC-FIN-029: выбранный вариант, основание, дата, ответственный.


## Шаги

- [ ] Один код расходуется однократно или резидент приводит нескольких коллег одним кодом?


## Критерии приёмки

- [ ] Правило зафиксировано в decision-register.md со статусом accepted; связанные задачи переведены из blocked_by_decision.


## Команды проверки

```bash
python3 _bmad-output/specs/spec-owner-update-2026-09-16/validate_backlog.py --repo-root .
```


## Evidence и завершение

- [ ] Результаты проверок сохранены под `docs/test-evidence/` с точным коммитом и датой прогона.
- [ ] Независимый review пройден; live-активация по локальному тесту не объявляется.
- [ ] Миграции — только вручную (`drizzle-kit generate` запрещён AGENTS.md).
