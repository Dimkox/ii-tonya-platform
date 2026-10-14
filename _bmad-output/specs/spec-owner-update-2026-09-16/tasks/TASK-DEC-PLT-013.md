# TASK-DEC-PLT-013: Решить: Канал подписи и участие Telegram в обработке спецданных

> For agentic workers: исполнять по superpowers:subagent-driven-development или superpowers:executing-plans после закрытия зависимостей.

**Goal:** Запись решения DEC-PLT-013: выбранное правило, основание, дата, ответственный, судьба interim-режима DEC-PLT-004.

**Architecture:** Следовать существующим границам пакетов на SHA `18af66fef61c33d21216c3b24f935cb1fe3d7b2d` и [контракту исполнения](../execution-contract.md).

**Tech Stack:** TypeScript, Node 24, pnpm 11.9.0, PostgreSQL; для design/content — форматы из критериев задачи.

**Spec:** [SPEC.md](../SPEC.md), [requirements.md](../requirements.md).

## Статус и область

- State: `planned`; readiness: `blocked_by_decision`.
- Тип: decision; исполнитель: product-owner; приоритет: P0.
- Depends on: `TASK-DEC-PLT-011`.
- Решает: `DEC-PLT-013` — Канал подписи и участие Telegram в обработке спецданных (открыто вердиктом владельца Б от 2026-09-21, reopen инварианта §2 `DEC-PLT-004`).
- Вопросы: нет.
- Статус live: ничего не включено и не активировано; внешние флаги остаются `false`, опубликованные тексты не меняются (DEC-PLT-007).

## Что уже есть

Открыто вердиктом владельца Б от 2026-09-21 (reopen инварианта DEC-PLT-004 под подробный режим); ни один вариант не утверждён.

**Варианты из разбора (выбрать один, второй записать с отказом):**

**1.** Только защищённая веб-страница оператора, Telegram вне контура спецданных.
**2.** Допустить Telegram после документированного аудита его участия и ревизии §4.
**3.** Не выбирать канал до DEC-PLT-011.

## Файлы

**Прочитать:**

- [decision-register.md](../../../../_bmad-output/specs/spec-owner-update-2026-09-16/decision-register.md)


**Получить от зависимых задач (файлы ещё предстоит создать):**

- `_bmad-output/specs/spec-owner-update-2026-09-16/evidence/DEC-PLT-011-rule.md` (от `TASK-DEC-PLT-011`)


**Изменить:**

- [decision-register.md](../../../../_bmad-output/specs/spec-owner-update-2026-09-16/decision-register.md)


**Создать:**

- [DEC-PLT-013-rule.md](../../../../_bmad-output/specs/spec-owner-update-2026-09-16/evidence/DEC-PLT-013-rule.md)


**Проверки:**

Нет.


## Пункты задачи

- [ ] Запись решения DEC-PLT-013: выбранное правило, основание, дата, ответственный, судьба interim-режима DEC-PLT-004.


## Шаги

- [ ] Где подписывается письменное согласие и допускается ли подробный режим в Telegram, с какой ревизией §4 правила DEC-PLT-004?


## Критерии приёмки

- [ ] Точное правило с границами и бинарными проверками в evidence/DEC-PLT-013-rule.md; статус accepted в decision-register.md; связанные задачи переведены из blocked_by_decision.


## Команды проверки

```bash
python3 _bmad-output/specs/spec-owner-update-2026-09-16/validate_backlog.py --repo-root .
```


## Evidence и завершение

- [ ] Результаты проверок сохранены под `docs/test-evidence/` с точным коммитом и датой прогона.
- [ ] Независимый review пройден; live-активация по локальному тесту не объявляется.
- [ ] После принятия `DEC-PLT-013`: статус в `decision-register.md` → `accepted`, правило — `evidence/DEC-PLT-013-rule.md`, связанные задачи переведены из `blocked_by_decision`, запись в `.memlog.md` через `memlog.py append --type decision --by user`.
