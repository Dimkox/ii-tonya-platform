# TASK-PLT-020: Контур УЗ и доказательство РФ-региона для персиста спецданных

> For agentic workers: исполнять по superpowers:subagent-driven-development или superpowers:executing-plans после закрытия зависимостей.

**Goal:** docs/security/uz-detailed-mode-measures.md: комплект мер по выбранному классу УЗ (DEC-PLT-012) с владельцем каждой меры.

**Architecture:** Следовать существующим границам пакетов на SHA `18af66fef61c33d21216c3b24f935cb1fe3d7b2d` и [контракту исполнения](../execution-contract.md).

**Tech Stack:** TypeScript, Node 24, pnpm 11.9.0, PostgreSQL; для design/content — форматы из критериев задачи.

**Spec:** [SPEC.md](../SPEC.md), [requirements.md](../requirements.md).

## Статус и область

- State: `planned`; readiness: `blocked_by_decision`.
- Тип: integration; исполнитель: ops; приоритет: P1.
- Depends on: `TASK-DEC-PLT-012`, `TASK-PLT-019`.
- Решения: `DEC-PLT-012`.
- Вопросы: нет.
- Статус live: ничего не включено и не активировано; внешние флаги остаются `false`, опубликованные тексты не меняются (DEC-PLT-007).

## Что уже есть

Класс УЗ-2 выбирался под «спецданные не храним»; персист спецкатегорий меняет класс. Доказательство РФ-региона хостинга в go-live-evidence отсутствует (зафиксировано как незакрытый гейт в DEC-PLT-004 §9).

## Файлы

**Прочитать:**

- [go-live-evidence.md](../../../../docs/runbooks/go-live-evidence.md)
- [threat-model-and-go-live-gates.md](../../../../docs/security/threat-model-and-go-live-gates.md)


**Получить от зависимых задач (файлы ещё предстоит создать):**

- `_bmad-output/specs/spec-owner-update-2026-09-16/evidence/DEC-PLT-012-rule.md` (от `TASK-DEC-PLT-012`)
- `packages/db/migrations/0040_consent_evidence.sql` (от `TASK-PLT-019`)
- `docs/security/detailed-mode-signature.md` (от `TASK-PLT-019`)
- `tests/repo/consent-evidence.test.ts` (от `TASK-PLT-019`)


**Изменить:**

- [go-live-evidence.md](../../../../docs/runbooks/go-live-evidence.md)


**Создать:**

- [uz-detailed-mode-measures.md](../../../../docs/security/uz-detailed-mode-measures.md)


**Проверки:**

Нет.


## Пункты задачи

- [ ] docs/security/uz-detailed-mode-measures.md: комплект мер по выбранному классу УЗ (DEC-PLT-012) с владельцем каждой меры.
- [ ] Записи доказательств РФ-региона хостинга в docs/runbooks/go-live-evidence.md с точным коммитом и датой.
- [ ] Свидетельства под docs/test-evidence/ на каждую меру.


## Шаги

- [ ] Не начинать до принятия DEC-PLT-012.
- [ ] Согласовать меры с текущим threat-model (docs/security/threat-model-and-go-live-gates.md) и не ослаблять существующие гейты.
- [ ] Реестр гейтов включения подробного режима: физическая невозможность включить без доказанного региона.


## Критерии приёмки

- [ ] Каждая мера DEC-PLT-012 имеет свидетельство с точным коммитом.
- [ ] Без доказательства РФ-региона подробный режим не включается конструкцией, а не договорённостью.
- [ ] Действующие гейты прода (default-off, redaction) не ослаблены.


## Команды проверки

```bash
python3 _bmad-output/specs/spec-owner-update-2026-09-16/validate_backlog.py --repo-root .
```


## Evidence и завершение

- [ ] Результаты проверок сохранены под `docs/test-evidence/` с точным коммитом и датой прогона.
- [ ] Независимый review пройден; live-активация по локальному тесту не объявляется.
- [ ] interim-правило `DEC-PLT-004` (§1–§9) соблюдается: спецданные и ПД третьих лиц не персистятся и не передаются, подробный режим закрыт.
