# TASK-DEC-PLT-012: Решить: Класс защищённости УЗ и доказательство РФ-региона для персиста спецданных

> For agentic workers: исполнять по superpowers:subagent-driven-development или superpowers:executing-plans после закрытия зависимостей.

**Goal:** Запись решения DEC-PLT-012: выбранное правило, основание, дата, ответственный, судьба interim-режима DEC-PLT-004.

**Architecture:** Следовать существующим границам пакетов на SHA `18af66fef61c33d21216c3b24f935cb1fe3d7b2d` и [контракту исполнения](../execution-contract.md).

**Tech Stack:** TypeScript, Node 24, pnpm 11.9.0, PostgreSQL; для design/content — форматы из критериев задачи.

**Spec:** [SPEC.md](../SPEC.md), [requirements.md](../requirements.md).

## Статус и область

- State: `planned`; readiness: `blocked_by_decision`.
- Тип: decision; исполнитель: product-owner; приоритет: P0.
- Depends on: нет.
- Решает: `DEC-PLT-012` — Класс защищённости УЗ и доказательство РФ-региона для персиста спецданных (открыто вердиктом владельца Б от 2026-09-21, reopen инварианта §2 `DEC-PLT-004`).
- Вопросы: нет.
- Статус live: ничего не включено и не активировано; внешние флаги остаются `false`, опубликованные тексты не меняются (DEC-PLT-007).

## Что уже есть

Открыто вердиктом владельца Б от 2026-09-21 (reopen инварианта DEC-PLT-004 под подробный режим); ни один вариант не утверждён.

**Варианты из разбора (выбрать один, второй записать с отказом):**

**1.** Общий контур как УЗ-1 с полным комплектом мер и подтверждением региона до включения режима.
**2.** Выделенная изолированная подсистема подробного режима класса УЗ-1.
**3.** Не открывать режим до готовности мер УЗ-1.

## Файлы

**Прочитать:**

- [decision-register.md](../../../../_bmad-output/specs/spec-owner-update-2026-09-16/decision-register.md)


**Получить от зависимых задач (файлы ещё предстоит создать):**

Нет.


**Изменить:**

- [decision-register.md](../../../../_bmad-output/specs/spec-owner-update-2026-09-16/decision-register.md)


**Создать:**

- [DEC-PLT-012-rule.md](../../../../_bmad-output/specs/spec-owner-update-2026-09-16/evidence/DEC-PLT-012-rule.md)


**Проверки:**

Нет.


## Пункты задачи

- [ ] Запись решения DEC-PLT-012: выбранное правило, основание, дата, ответственный, судьба interim-режима DEC-PLT-004.


## Шаги

- [ ] Какой класс УЗ и комплект мер по приказу ФСТЭК № 21 применяются к контуру хранения спецкатегорий и как документируется РФ-регион хостинга?


## Критерии приёмки

- [ ] Точное правило с границами и бинарными проверками в evidence/DEC-PLT-012-rule.md; статус accepted в decision-register.md; связанные задачи переведены из blocked_by_decision.


## Команды проверки

```bash
python3 _bmad-output/specs/spec-owner-update-2026-09-16/validate_backlog.py --repo-root .
```


## Evidence и завершение

- [ ] Результаты проверок сохранены под `docs/test-evidence/` с точным коммитом и датой прогона.
- [ ] Независимый review пройден; live-активация по локальному тесту не объявляется.
- [ ] После принятия `DEC-PLT-012`: статус в `decision-register.md` → `accepted`, правило — `evidence/DEC-PLT-012-rule.md`, связанные задачи переведены из `blocked_by_decision`, запись в `.memlog.md` через `memlog.py append --type decision --by user`.
