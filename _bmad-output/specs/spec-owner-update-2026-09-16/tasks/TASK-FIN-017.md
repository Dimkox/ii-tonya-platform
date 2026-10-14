# TASK-FIN-017: Специфицировать bonus ledger и годовой expiry

> For agentic workers: исполнять по superpowers:subagent-driven-development или superpowers:executing-plans после закрытия зависимостей.

**Goal:** 365-day/calendar rule, FIFO ordering, notifications and balance invariant.

**Architecture:** Следовать существующим границам пакетов на SHA `18af66fef61c33d21216c3b24f935cb1fe3d7b2d` и [контракту исполнения](../execution-contract.md).

**Tech Stack:** TypeScript, Node 24, pnpm 11.9.0, PostgreSQL; для design/content — форматы из критериев задачи.

**Spec:** [SPEC.md](../SPEC.md), [requirements.md](../requirements.md).

## Статус и область

- State: `planned`; readiness: `pending_dependencies`.
- Тип: design; исполнитель: backend; приоритет: P1.
- Depends on: [TASK-FIN-016](TASK-FIN-016.md), [TASK-DEC-FIN-018](TASK-DEC-FIN-018.md).
- Решения: DEC-FIN-018.
- Вопросы: Q-053, Q-054, Q-131, Q-154, Q-171.

## Что уже есть

Referral ledger supports existing V2 maturity; annual expiry reminders/FIFO policy not confirmed.

## Файлы

**Прочитать:**

- [packages/domain/src/expert-referral.ts](../../../../packages/domain/src/expert-referral.ts)
- [packages/db/src/repositories/expert-referral-repository.ts](../../../../packages/db/src/repositories/expert-referral-repository.ts)
- [packages/db/src/schema/expert-residency.ts](../../../../packages/db/src/schema/expert-residency.ts)

**Получить от зависимых задач (файлы ещё предстоит создать):**

Нет.

**Изменить:**

Нет.

**Создать:**

- [docs/superpowers/implementation-artifacts/fin-bonus-ledger-design.md](../../../../docs/superpowers/implementation-artifacts/fin-bonus-ledger-design.md)

**Проверки:**

- [packages/domain/src/expert-referral.test.ts](../../../../packages/domain/src/expert-referral.test.ts)
- [packages/domain/src/expert-referral.property.test.ts](../../../../packages/domain/src/expert-referral.property.test.ts)

## Пункты задачи

- [ ] **REQ-FIN-016.01** — Бонусы резидентов действуют один год/365 дней от определённого события, не являются деньгами, не выводятся и не передаются; внутренний ledger поддерживает накопление, FIFO/утверждённый порядок списания, баланс по запросу и уведомления истечения за 14 и 7 дней. Внутренний курс1 бонус=1₽, расход только на резидентство/утверждённый пакет категории, не на услуги эксперта клиенту. Списание автоматически лишь с сохранённым согласием либо по письменному запросу; отзыв согласия блокирует последующее автоматическое списание.
  - Проверка: Boundary expiry и порядок списания проверены; баланс равен сумме неизменяемых grants/reversals/spends.

## Шаги

- [ ] Choose DEC-FIN-018.
- [ ] Define grant/spend/reversal immutable records and balance projection.

## Критерии приёмки

- [ ] Expired bonus cannot spend; 14/7 day notices are deduplicated; ledger reconciles.

## Команды проверки

```bash
pnpm exec vitest run packages/domain/src/expert-referral.test.ts packages/domain/src/expert-referral.property.test.ts
```

## Evidence и завершение

- [ ] Сохранить результаты проверок и связь с пунктами исходника.
- [ ] Закрыть связанные DEC/Q или явно оставить задачу blocked.
- [ ] Пройти независимый review; не объявлять live-активацию по результату локального теста.
