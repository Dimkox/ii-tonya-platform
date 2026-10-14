# TASK-FIN-019: Выбрать promo maturity for bonus spend

> For agentic workers: исполнять по superpowers:subagent-driven-development или superpowers:executing-plans после закрытия зависимостей.

**Goal:** Chosen maturity by policy/category and required new versioned migration boundary.

**Architecture:** Следовать существующим границам пакетов на SHA `18af66fef61c33d21216c3b24f935cb1fe3d7b2d` и [контракту исполнения](../execution-contract.md).

**Tech Stack:** TypeScript, Node 24, pnpm 11.9.0, PostgreSQL; для design/content — форматы из критериев задачи.

**Spec:** [SPEC.md](../SPEC.md), [requirements.md](../requirements.md).

## Статус и область

- State: `planned`; readiness: `pending_dependencies`.
- Тип: decision; исполнитель: product-owner; приоритет: P0.
- Depends on: [TASK-FIN-010](TASK-FIN-010.md).
- Решения: DEC-FIN-016.
- Вопросы: Q-200.

## Что уже есть

A2 schema hard-codes matures_at=settled_at+30 days; source requests three months after Energy Start.

## Файлы

**Прочитать:**

- [packages/db/migrations/0033_expert_referral_maturity_a2.sql](../../../../packages/db/migrations/0033_expert_referral_maturity_a2.sql)
- [packages/domain/src/expert-referral.ts](../../../../packages/domain/src/expert-referral.ts)

**Получить от зависимых задач (файлы ещё предстоит создать):**

Нет.

**Изменить:**

Нет.

**Создать:**

- [docs/superpowers/implementation-artifacts/fin-promo-bonus-maturity.md](../../../../docs/superpowers/implementation-artifacts/fin-promo-bonus-maturity.md)

**Проверки:**

Нет.

## Пункты задачи

- [ ] **REQ-FIN-017.01** — Для участника Energy Start расход бонусов запрещён до окончания акционного периода; альтернативные сроки — 3 месяца либо уже существующая зрелость 30 дней. При полной цене расход доступен сразу.
  - Проверка: Тест до и после утверждённого срока блокирует/разрешает spend независимо от наличия баланса.

## Шаги

- [ ] Choose DEC-FIN-016.
- [ ] Determine whether maturity differs from grant maturity or spend eligibility.

## Критерии приёмки

- [ ] No historical A2 settlement changes semantics; chosen boundary is testable.

## Команды проверки

Проверка решений/контента по критериям выше; запуск приложения не является доказательством принятого решения.

## Evidence и завершение

- [ ] Сохранить результаты проверок и связь с пунктами исходника.
- [ ] Закрыть связанные DEC/Q или явно оставить задачу blocked.
- [ ] Пройти независимый review; не объявлять live-активацию по результату локального теста.
