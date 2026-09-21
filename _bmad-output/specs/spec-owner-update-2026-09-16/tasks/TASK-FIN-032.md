# TASK-FIN-032: Опубликовать approved партнёрские тарифные строки (seed policy rows)

> For agentic workers: исполнять по superpowers:subagent-driven-development или superpowers:executing-plans после закрытия зависимостей.

**Goal:** Versioned approved строки политик для CENTER и ORGANIZER с числами из DEC-FIN-030 и effective_from.

**Architecture:** Следовать существующим границам пакетов на SHA `18af66fef61c33d21216c3b24f935cb1fe3d7b2d` и [контракту исполнения](../execution-contract.md).

**Tech Stack:** TypeScript, Node 24, pnpm 11.9.0, PostgreSQL; для design/content — форматы из критериев задачи.

**Spec:** [SPEC.md](../SPEC.md), [requirements.md](../requirements.md).

## Статус и область

- State: `planned`; readiness: `blocked_by_decision`.
- Тип: implementation; исполнитель: backend; приоритет: P1.
- Depends on: `TASK-DEC-FIN-030`, `TASK-FIN-029`.
- Решения: `DEC-FIN-030`.
- Вопросы: нет.
- Статус live: ничего не включено и не активировано; внешние флаги остаются `false`, опубликованные тексты не меняются (DEC-PLT-007).

## Что уже есть

Действующего тарифа нет: строк partner_tariff_policy_versions со статусом approved в дереве нет, а числа 15000/12000/8000 (центр) и 20000/15000/10000 (организатор) существуют только в тест-фикстуре partner-commerce-repository.test.ts:24 (проверено 2026-09-21). CHECK в 0037 закрепляет валюту, пороги полос и комиссии, но не абсолютные цены.

## Файлы

**Прочитать:**

- [partner-commerce.ts](../../../../packages/db/src/schema/partner-commerce.ts)
- [0037_partner_commerce_a.sql](../../../../packages/db/migrations/0037_partner_commerce_a.sql)


**Получить от зависимых задач (файлы ещё предстоит создать):**

- `tests/repo/partner-tier-wiring.test.ts` (от `TASK-FIN-029`)


**Изменить:**

- [partner-commerce.ts](../../../../packages/db/src/schema/partner-commerce.ts)


**Создать:**

- [0041_partner_tariff_policy_seed.sql](../../../../packages/db/migrations/0041_partner_tariff_policy_seed.sql)


**Проверки:**

Нет.


## Пункты задачи

- [ ] Versioned approved строки политик для CENTER и ORGANIZER с числами из DEC-FIN-030 и effective_from.
- [ ] Синхронизация артефактов fin-center-policy.md и fin-organizer-policy.md: ссылаться на опубликованную политику, а не на фикстуру.


## Шаги

- [ ] Сид — отдельная ручная миграция; в одном прогоне с ней не менять пороги полос.
- [ ] Тест-фикстура остаётся фикстурой и не должна использоваться как источник продуктового тарифа.


## Критерии приёмки

- [ ] После сида котировка читает approved-строку и считает полосу по DEC-FIN-012 (тест с реальной политикой).
- [ ] Ни одно публичное число тарифа не берётся из теста (проверяется grep-тестом по дереву).


## Команды проверки

```bash
python3 _bmad-output/specs/spec-owner-update-2026-09-16/validate_backlog.py --repo-root .
```


## Evidence и завершение

- [ ] Результаты проверок сохранены под `docs/test-evidence/` с точным коммитом и датой прогона.
- [ ] Независимый review пройден; live-активация по локальному тесту не объявляется.
- [ ] Миграции — только вручную (`drizzle-kit generate` запрещён AGENTS.md).
